const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const code = readFileSync(join(__dirname, "../shared.js"), "utf8");
function load(fetch = async () => { throw new Error("Unexpected fetch"); }) {
  const context = vm.createContext({ fetch, AbortController, setTimeout, clearTimeout });
  vm.runInContext(code, context);
  return context.iNaturalistElevation;
}

test("automatic units use the US region rather than the English language, with metric fallback", () => {
  const { resolveElevationUnit } = load();
  for (const locale of ["en-US", "es-US", "en-Latn-US", "en-us"]) {
    assert.equal(resolveElevationUnit("auto", locale), "feet", locale);
  }
  for (const locale of ["en-GB", "en-CA", "es-CO", "fr-FR", "en", "en-GB-x-US", "", null, undefined, "not_a_locale"]) {
    assert.equal(resolveElevationUnit("auto", locale), "meters", String(locale));
  }
});

test("saved manual units override automatic locale selection", () => {
  const { resolveElevationUnit } = load();
  assert.equal(resolveElevationUnit("meters", "en-US"), "meters");
  assert.equal(resolveElevationUnit("feet", "en-GB"), "feet");
  assert.equal(resolveElevationUnit("feet", null), "feet");
  assert.equal(resolveElevationUnit(undefined, "en-US"), "feet");
  assert.equal(resolveElevationUnit("unknown", "en-GB"), "meters");
});

test("coordinates accept zero and valid bounds, but reject missing and coerced invalid values", () => {
  const { normalizeCoordinates } = load();
  for (const value of [null, undefined, "", " ", true, false, [], {}, Infinity, NaN, "nope"]) {
    assert.equal(normalizeCoordinates(value, 0), null);
    assert.equal(normalizeCoordinates(0, value), null);
  }
  assert.equal(normalizeCoordinates(0, "0").latitude, 0);
  assert.equal(normalizeCoordinates(-90, 180).longitude, 180);
  assert.equal(normalizeCoordinates(91, 0), null);
  assert.equal(normalizeCoordinates(0, -181), null);
});

test("public coordinates and obscured flag are preserved unless exact coordinates are explicitly allowed", () => {
  const { coordinatesFromObservation } = load();
  const observation = {
    obscured: true,
    positional_accuracy: 42,
    public_positional_accuracy: 1500,
    private_positional_accuracy: 8,
    geojson: { type: "Point", coordinates: [20, 10] },
    private_geojson: { type: "Point", coordinates: [21, 11] }
  };
  assert.equal(coordinatesFromObservation(observation).latitude, 10);
  assert.equal(coordinatesFromObservation(observation).approximate, true);
  assert.equal(coordinatesFromObservation(observation).accuracyMeters, 1500);
  assert.equal(coordinatesFromObservation(observation, true).latitude, 11);
  assert.equal(coordinatesFromObservation(observation, true).approximate, false);
  assert.equal(coordinatesFromObservation(observation, true).accuracyMeters, 8);
  assert.equal(coordinatesFromObservation({
    geojson: { type: "Point", coordinates: [20, 10] },
    positional_accuracy: 0
  }).accuracyMeters, null);
  assert.equal(coordinatesFromObservation({ private_latitude: 1, private_longitude: 2 }), null);
});

test("unusable GeoJSON falls back to a valid location string; private and malformed locations stay unavailable", () => {
  const { coordinatesFromObservation } = load();
  assert.equal(coordinatesFromObservation({ geojson: { type: "Polygon", coordinates: [] }, location: "0,-70" }).latitude, 0);
  for (const location of ["", "1,", ",2", "1,2,3", "91,2"]) {
    assert.equal(coordinatesFromObservation({ location }), null);
  }
});

test("HTTP failures, malformed JSON, and stalled requests return errors", async () => {
  await assert.rejects(load(async () => ({ ok: false, status: 429 })).fetchJSON("https://example.test"), /429/);
  await assert.rejects(load(async () => ({ ok: true, json: async () => { throw new Error("Invalid JSON"); } })).fetchJSON("https://example.test"), /Invalid JSON/);
  const stalled = load((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
  }));
  await assert.rejects(stalled.fetchJSON("https://example.test", {}, 5), /timed out/);
});
