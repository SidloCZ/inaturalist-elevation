const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");

const INTERCEPTOR_CODE = readFileSync(join(__dirname, "../page-interceptor.js"), "utf8");

function setup(t, { url = "https://www.inaturalist.org/observations/123", fetchImpl, xhrImpl } = {}) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url, runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const { window } = dom;
  const events = [];
  window.addEventListener("inat-elevation:observations", event => events.push(event.detail));

  if (fetchImpl) {
    window.fetch = fetchImpl;
  } else {
    window.fetch = async () => ({
      ok: true,
      clone() {
        return this;
      },
      json: async () => ({})
    });
  }

  class MockXHR {
    open(method, targetUrl) {
      this._method = method;
      this._url = targetUrl;
      this._headers = {};
      this._listeners = {};
    }
    setRequestHeader(name, value) {
      this._headers[name] = value;
    }
    addEventListener(type, fn) {
      this._listeners[type] = this._listeners[type] || [];
      this._listeners[type].push(fn);
    }
    send() {
      if (xhrImpl) xhrImpl(this);
    }
    triggerLoad({ status = 200, responseType = "", responseText = "", response = null } = {}) {
      this.status = status;
      this.responseType = responseType;
      this.responseText = responseText;
      this.response = response;
      for (const fn of this._listeners.load || []) fn.call(this);
    }
  }
  window.XMLHttpRequest = MockXHR;

  window.eval(INTERCEPTOR_CODE);
  return { window, events };
}

test("fetch interceptor captures v1/v2 observations, strips unrelated fields, and flags auth", async t => {
  const app = setup(t, {
    fetchImpl: async url => {
      const payload = url.includes("/v2/")
        ? {
            total_results: 2,
            results: [
              {
                id: 101,
                obscured: false,
                geojson: { type: "Point", coordinates: [-76.1, 5.2] },
                positional_accuracy: 15,
                user: { login: "secret" },
                photos: [{ url: "https://example.test/photo.jpg" }]
              },
              {
                id: 102,
                obscured: true,
                geojson: { type: "Point", coordinates: [-76.2, 5.3] },
                private_geojson: { type: "Point", coordinates: [-76.25, 5.35] },
                private_positional_accuracy: 4,
                description: "sensitive notes"
              }
            ]
          }
        : {
            id: 200,
            geojson: { type: "Point", coordinates: [10, 20] },
            public_positional_accuracy: 500
          };
      return {
        ok: true,
        clone() {
          return { json: async () => payload };
        }
      };
    }
  });

  await app.window.fetch("https://api.inaturalist.org/v2/observations?per_page=30", {
    headers: { Authorization: "Bearer jwt-token" }
  });
  await app.window.fetch("https://api.inaturalist.org/v1/observations/200");
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(app.events.length, 2);
  assert.equal(app.events[0].batch, true);
  assert.equal(app.events[0].observations[0].authenticated, true);
  assert.equal(app.events[0].observations[0].user, undefined);
  assert.equal(app.events[0].observations[0].photos, undefined);
  assert.equal(app.events[0].observations[1].description, undefined);
  assert.equal(app.events[0].observations[1].private_positional_accuracy, 4);
  assert.equal(app.events[1].batch, false);
  assert.equal(app.events[1].observations[0].authenticated, false);
  assert.equal(app.events[1].observations[0].public_positional_accuracy, 500);
});

test("XHR interceptor captures responses and replays buffer when content script announces ready", async t => {
  const app = setup(t, {
    xhrImpl: xhr => {
      xhr.triggerLoad({
        status: 200,
        responseText: JSON.stringify({
          results: [
            { id: 301, geojson: { type: "Point", coordinates: [1, 2] }, positional_accuracy: 12 }
          ]
        })
      });
    }
  });

  const xhr = new app.window.XMLHttpRequest();
  xhr.open("GET", "https://api.inaturalist.org/v1/observations/301");
  xhr.setRequestHeader("Authorization", "Bearer abc");
  xhr.send();

  assert.equal(app.events.length, 1);
  assert.equal(app.events[0].observations[0].authenticated, true);

  app.events.length = 0;
  app.window.dispatchEvent(new app.window.CustomEvent("inat-elevation:ready"));
  assert.equal(app.events.length, 1);
  assert.equal(app.events[0].observations[0].id, 301);
});

test("interceptor preserves authenticated records against unauthenticated overwrites and ignores unrelated URLs", async t => {
  let authedFirst = true;
  const app = setup(t, {
    fetchImpl: async url => {
      if (url.includes("taxa")) {
        return { ok: true, clone: () => ({ json: async () => ({ id: 999 }) }) };
      }
      if (url.includes("broken")) {
        return { ok: true, clone: () => ({ json: async () => { throw new Error("bad json"); } }) };
      }
      const payload = authedFirst
        ? { results: [{ id: 55, obscured: true, private_geojson: { type: "Point", coordinates: [2, 3] } }] }
        : { results: [{ id: 55, obscured: true, geojson: { type: "Point", coordinates: [9, 9] } }] };
      authedFirst = false;
      return { ok: true, clone: () => ({ json: async () => payload }) };
    }
  });

  await app.window.fetch("https://api.inaturalist.org/v1/taxa/999");
  await app.window.fetch("https://api.inaturalist.org/v2/observations?broken=1");
  await app.window.fetch("https://api.inaturalist.org/v2/observations?id=55", {
    headers: new app.window.Headers({ Authorization: "Bearer secret" })
  });
  await app.window.fetch("https://api.inaturalist.org/v2/observations?id=55");
  await new Promise(resolve => setImmediate(resolve));

  app.events.length = 0;
  app.window.dispatchEvent(new app.window.CustomEvent("inat-elevation:ready"));
  assert.equal(app.events.length, 1);
  assert.equal(app.events[0].observations[0].authenticated, true);
  assert.deepEqual(app.events[0].observations[0].private_geojson.coordinates, [2, 3]);
});
