const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

function setup(handler) {
  let listener;
  const requests = [];
  const context = vm.createContext({
    URL, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      return { ok: true, json: async () => handler(String(url)) };
    },
    chrome: { runtime: { id: "test", onMessage: { addListener(fn) { listener = fn; } }, openOptionsPage: async () => {} } }
  });
  context.importScripts = filename => vm.runInContext(readFileSync(join(__dirname, "..", filename), "utf8"), context);
  vm.runInContext(readFileSync(join(__dirname, "../background.js"), "utf8"), context);
  return {
    requests,
    listener,
    send: message => new Promise(resolve => assert.equal(listener(message, { id: "test" }, resolve), true))
  };
}

test("background retrieves obscured public coordinates and numeric elevation without cookies or referrers", async () => {
  const app = setup(url => url.includes("inaturalist")
    ? { results: [{ obscured: true, geojson: { type: "Point", coordinates: [-70, 5] }, private_latitude: 8, private_longitude: 9 }] }
    : { elevation: [0] });
  const coordinates = await app.send({ type: "getPublicObservationCoordinates", observationId: "123" });
  assert.equal(coordinates.latitude, 5);
  assert.equal(coordinates.approximate, true);
  const result = await app.send({ type: "getElevation", latitude: coordinates.latitude, longitude: coordinates.longitude });
  assert.equal(result.elevationMeters, 0);
  for (const request of app.requests) {
    assert.equal(request.options.credentials, "omit");
    assert.equal(request.options.referrerPolicy, "no-referrer");
  }
  assert.match(app.requests[1].url, /latitude=5&longitude=-70/);
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
    assert.equal((await app.send({ type: "getElevation", latitude: 0, longitude: 0 })).ok, false);
  }
  const app = setup(() => ({ elevation: [-32] }));
  assert.equal((await app.send({ type: "getElevation", latitude: 0, longitude: 0 })).elevationMeters, -32);
  assert.equal((await app.send({ type: "openOptions" })).ok, true);
});
