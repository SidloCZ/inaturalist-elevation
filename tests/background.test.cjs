const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

function setup(handler, { decodeImage } = {}) {
  let listener;
  const requests = [];
  const context = vm.createContext({
    URL, AbortController, setTimeout, clearTimeout, Date,
    __elevationClientOptions: { batchWindowMs: 0, minIntervalMs: 0, decodeImage },
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      const res = await handler(String(url), options);
      return {
        ok: res?.ok !== undefined ? res.ok : true,
        status: res?.status || 200,
        tileData: res?.tileData,
        json: async () => res
      };
    },
    chrome: { runtime: { id: "test", onMessage: { addListener(fn) { listener = fn; } }, openOptionsPage: async () => {} } }
  });
  context.importScripts = (...filenames) => {
    for (const filename of filenames) {
      vm.runInContext(readFileSync(join(__dirname, "..", filename), "utf8"), context);
    }
  };
  vm.runInContext(readFileSync(join(__dirname, "../background.js"), "utf8"), context);
  return {
    requests,
    listener,
    send: message => new Promise(resolve => assert.equal(listener(message, { id: "test" }, resolve), true))
  };
}

test("background retrieves obscured public coordinates and OpenTopoData elevation without cookies or referrers", async () => {
  const app = setup(url => url.includes("inaturalist")
    ? { results: [{ obscured: true, geojson: { type: "Point", coordinates: [-70, 5] }, private_latitude: 8, private_longitude: 9 }] }
    : { status: "OK", results: [{ dataset: "mapzen", elevation: 0 }] });
  const coordinates = await app.send({ type: "getPublicObservationCoordinates", observationId: "123" });
  assert.equal(coordinates.latitude, 5);
  assert.equal(coordinates.approximate, true);
  const result = await app.send({ type: "getElevation", latitude: coordinates.latitude, longitude: coordinates.longitude });
  assert.equal(result.elevationMeters, 0);
  assert.equal(result.provider, "opentopodata");
  assert.equal(result.dataset, "mapzen");
  for (const request of app.requests) {
    assert.equal(request.options.credentials, "omit");
    assert.equal(request.options.referrerPolicy, "no-referrer");
  }
  assert.match(app.requests[0].url, /^https:\/\/api\.inaturalist\.org\/v2\/observations\?id=123&fields=/);
  assert.match(app.requests[1].url, /^https:\/\/api\.opentopodata\.org\/v1\/ned10m,eudem25m,nzdem8m,mapzen\?locations=5,-70/);
});

test("background supports Mapterhorn tiles and Open-Meteo source options", async () => {
  const tileData = { width: 2, height: 2, data: new Uint8ClampedArray([128, 25, 0, 255, 128, 25, 0, 255, 128, 25, 0, 255, 128, 25, 0, 255]) };
  const mapterhornApp = setup(
    () => ({ ok: true, status: 200, tileData }),
    { decodeImage: async res => res.tileData }
  );
  const mRes = await mapterhornApp.send({ type: "getElevation", latitude: 10, longitude: 20, source: "mapterhorn" });
  assert.equal(Math.round(mRes.elevationMeters), 25);
  assert.equal(mRes.provider, "mapterhorn");

  const openMeteoApp = setup(() => ({ elevation: [-32] }));
  const omRes = await openMeteoApp.send({ type: "getElevation", latitude: 0, longitude: 0, source: "open-meteo" });
  assert.equal(omRes.elevationMeters, -32);
  assert.equal(omRes.provider, "open-meteo");
  assert.match(openMeteoApp.requests[0].url, /api\.open-meteo\.com\/v1\/elevation\?latitude=0&longitude=0/);
});

test("background rejects invalid IDs and coordinates before sending a network request", async () => {
  const app = setup(() => { throw new Error("Unexpected fetch"); });
  for (const observationId of ["0", "../x", "123?x", null]) {
    assert.equal((await app.send({ type: "getPublicObservationCoordinates", observationId })).ok, false);
  }
  for (const latitude of [null, "", " ", false, [], 100]) {
    assert.equal((await app.send({ type: "getElevation", latitude, longitude: 0 })).ok, false);
  }
  assert.equal(app.requests.length, 0);
  assert.equal(app.listener({ type: "getElevation" }, { id: "other" }, () => {}), false);
  assert.equal(app.listener({ type: "unknown" }, { id: "test" }, () => {}), false);
});

test("background rejects missing and malformed elevations while allowing below-sea-level results", async () => {
  for (const value of [undefined, null, "", "12", false, NaN]) {
    const app = setup(() => ({ elevation: [value] }));
    assert.equal((await app.send({ type: "getElevation", latitude: 0, longitude: 0, source: "open-meteo" })).ok, false);
  }
  const app = setup(() => ({ status: "OK", results: [{ dataset: "mapzen", elevation: -32 }] }));
  assert.equal((await app.send({ type: "getElevation", latitude: 0, longitude: 0, allowFallback: false })).elevationMeters, -32);
  assert.equal((await app.send({ type: "openOptions" })).ok, true);
});
