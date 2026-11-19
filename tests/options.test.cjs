const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");

function setup(t, stored = {}, errors = {}, locale = "en-US") {
  const dom = new JSDOM(readFileSync(join(__dirname, "../options.html"), "utf8"), { runScripts: "outside-only" });
  t.after(() => dom.window.close());
  Object.defineProperty(dom.window.navigator, "language", { value: locale, configurable: true });
  const writes = [];
  dom.window.chrome = {
    runtime: {},
    storage: { sync: {
      get(defaults, callback) {
        dom.window.chrome.runtime.lastError = errors.get;
        callback(errors.get ? undefined : { ...defaults, ...stored });
        delete dom.window.chrome.runtime.lastError;
      },
      set(settings, callback) {
        writes.push(JSON.parse(JSON.stringify(settings)));
        dom.window.chrome.runtime.lastError = errors.set;
        callback();
        delete dom.window.chrome.runtime.lastError;
      }
    } }
  };
  for (const file of ["shared.js", "options.js"]) dom.window.eval(readFileSync(join(__dirname, "..", file), "utf8"));
  const unit = dom.window.document.getElementById("elevation-unit");
  const source = dom.window.document.getElementById("elevation-source");
  const uncertaintyMode = dom.window.document.getElementById("uncertainty-mode");
  const accuracyThreshold = dom.window.document.getElementById("accuracy-threshold");
  const hideExact = dom.window.document.querySelector("input[type=checkbox]");
  return { dom, unit, source, uncertaintyMode, accuracyThreshold, hideExact, writes };
}

test("failed settings reads display an error instead of reporting success or writing defaults", t => {
  const { dom, writes } = setup(t, {}, { get: { message: "Storage unavailable" } });
  assert.match(dom.window.document.getElementById("save-status").textContent, /Could not load settings/);
  assert.deepEqual(writes, []);
});

test("failed settings saves clearly report failure", t => {
  const { dom, hideExact } = setup(t, {}, { set: { message: "Sync quota exceeded" } });
  hideExact.checked = true;
  hideExact.dispatchEvent(new dom.window.Event("change"));
  assert.equal(dom.window.document.getElementById("save-status").textContent, "Could not save.");
});

test("options default to unchecked hide-exact checkbox, opentopodata source, and save settings independently", t => {
  const { dom, unit, source, hideExact, writes } = setup(t);
  assert.equal(unit.value, "auto");
  assert.equal(source.value, "opentopodata");
  assert.equal(unit.selectedOptions[0].textContent, "Automatic (ft)");
  assert.equal(dom.window.document.querySelector(".author").textContent, "Created by Armen Enikolopov.");
  assert.equal(hideExact.checked, false);
  assert.equal(hideExact.labels[0].textContent.trim(),
    "Hide exact coordinates from elevation APIs for observations with obscured/private geoprivacy.");
  unit.value = "feet";
  unit.dispatchEvent(new dom.window.Event("change"));
  source.value = "mapterhorn";
  source.dispatchEvent(new dom.window.Event("change"));
  hideExact.checked = true;
  hideExact.dispatchEvent(new dom.window.Event("change"));
  hideExact.checked = false;
  hideExact.dispatchEvent(new dom.window.Event("change"));
  assert.deepEqual(writes, [
    { elevationUnit: "feet" },
    { elevationSource: "mapterhorn" },
    { allowPrivateCoordinates: false },
    { allowPrivateCoordinates: true }
  ]);
  assert.equal(dom.window.document.getElementById("save-status").textContent, "Saved");
});

test("invalid stored elevationSource falls back cleanly to default", t => {
  const { source, writes } = setup(t, { elevationSource: "bogus" });
  assert.equal(source.value, "opentopodata");
  assert.deepEqual(writes, []);
});

for (const allowPrivateCoordinates of [false, true]) {
  test(`existing allowPrivateCoordinates=${allowPrivateCoordinates} preference is preserved with inverted checkbox`, t => {
    const { hideExact, writes } = setup(t, { allowPrivateCoordinates });
    assert.equal(hideExact.checked, !allowPrivateCoordinates);
    assert.deepEqual(writes, []);
  });
}

test("Automatic shows metric units for a non-US locale and can be restored after a manual choice", t => {
  const { dom, unit, writes } = setup(t, {}, {}, "en-CA");
  assert.equal(unit.value, "auto");
  assert.equal(unit.selectedOptions[0].textContent, "Automatic (m)");
  unit.value = "feet";
  unit.dispatchEvent(new dom.window.Event("change"));
  unit.value = "auto";
  unit.dispatchEvent(new dom.window.Event("change"));
  assert.deepEqual(writes, [{ elevationUnit: "feet" }, { elevationUnit: "auto" }]);
});

for (const elevationUnit of ["meters", "feet"]) {
  test(`saved manual ${elevationUnit} choice is preserved despite the locale default`, t => {
    const { unit, writes } = setup(t, { elevationUnit }, {}, elevationUnit === "meters" ? "en-US" : "en-GB");
    assert.equal(unit.value, elevationUnit);
    assert.deepEqual(writes, []);
  });
}

test("uncertainty mode and accuracy threshold default cleanly and save numeric threshold including Off (0)", t => {
  const { dom, uncertaintyMode, accuracyThreshold, writes } = setup(t);
  assert.equal(uncertaintyMode.value, "range");
  assert.equal(accuracyThreshold.value, "100");
  uncertaintyMode.value = "hide";
  uncertaintyMode.dispatchEvent(new dom.window.Event("change"));
  accuracyThreshold.value = "0";
  accuracyThreshold.dispatchEvent(new dom.window.Event("change"));
  assert.deepEqual(writes, [
    { uncertaintyMode: "hide" },
    { accuracyThresholdMeters: 0 }
  ]);

  const reloaded = setup(t, { uncertaintyMode: "mark", accuracyThresholdMeters: 0 });
  assert.equal(reloaded.uncertaintyMode.value, "mark");
  assert.equal(reloaded.accuracyThreshold.value, "0");
});
