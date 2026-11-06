const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");

function setup(t, stored = {}, errors = {}) {
  const dom = new JSDOM(readFileSync(join(__dirname, "../options.html"), "utf8"), { runScripts: "outside-only" });
  t.after(() => dom.window.close());
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
  dom.window.eval(readFileSync(join(__dirname, "../options.js"), "utf8"));
  const unit = dom.window.document.querySelector("select");
  const hideExact = dom.window.document.querySelector("input[type=checkbox]");
  return { dom, unit, hideExact, writes };
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

test("options default to unchecked hide-exact checkbox, and save its inverse independently of units", t => {
  const { dom, unit, hideExact, writes } = setup(t);
  assert.equal(unit.value, "meters");
  assert.equal(hideExact.checked, false);
  assert.equal(hideExact.labels[0].textContent.trim(),
    "Hide exact coordinates from Open-Meteo for observations with obscured/private geoprivacy.");
  unit.value = "feet";
  unit.dispatchEvent(new dom.window.Event("change"));
  hideExact.checked = true;
  hideExact.dispatchEvent(new dom.window.Event("change"));
  hideExact.checked = false;
  hideExact.dispatchEvent(new dom.window.Event("change"));
  assert.deepEqual(writes, [
    { elevationUnit: "feet" }, { allowPrivateCoordinates: false }, { allowPrivateCoordinates: true }
  ]);
  assert.equal(dom.window.document.getElementById("save-status").textContent, "Saved");
});

for (const allowPrivateCoordinates of [false, true]) {
  test(`existing allowPrivateCoordinates=${allowPrivateCoordinates} preference is preserved with inverted checkbox`, t => {
    const { hideExact, writes } = setup(t, { allowPrivateCoordinates });
    assert.equal(hideExact.checked, !allowPrivateCoordinates);
    assert.deepEqual(writes, []);
  });
}
