const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");
const network = require("./fixtures/network-sites.json");

const PAGE = '<div class="Map"><div class="map_details"><span class="place-guess">Location</span><div class="details_menu"></div></div></div><span id="latlng">88, 99</span>';
function modal(id, accuracy = true) {
  return `<div class="ObservationModal"><div class="map-and-details"><div class="details"><ul>
    <li class="location"><i class="fa fa-map-marker bullet-icon"></i>Colombia</li>
    ${accuracy ? '<li class="accuracy"><i class="fa fa-circle-o bullet-icon"></i>Acc (m): 5</li>' : ''}
    <li><a class="permalink" href="/observations/${id}">View</a></li>
  </ul></div></div></div>`;
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for test state");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function setup(t, { html = PAGE, url = "https://www.inaturalist.org/observations/123", settings = {}, handler, fetch, locale = "en-GB" } = {}) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const { window } = dom;
  Object.defineProperty(window.navigator, "language", { value: locale, configurable: true });
  const messages = [];
  const fetches = [];
  let changed;
  window.fetch = async (...args) => {
    fetches.push(args);
    if (fetch) return fetch(...args);
    throw new Error("Unexpected account-specific fetch");
  };
  window.chrome = {
    runtime: {
      sendMessage(message, callback) {
        messages.push(message);
        Promise.resolve(handler ? handler(message) : message.type === "getPublicObservationCoordinates"
          ? { ok: true, latitude: Number(message.observationId), longitude: 0, approximate: true, source: "public" }
          : { ok: true, elevationMeters: message.latitude }).then(callback);
      }
    },
    storage: {
      sync: { get(defaults, callback) { callback({ ...defaults, ...settings }); } },
      onChanged: { addListener(fn) { changed = fn; } }
    }
  };
  for (const file of ["shared.js", "content.js"]) window.eval(readFileSync(join(__dirname, "..", file), "utf8"));
  return {
    window, document: window.document, messages, fetches,
    change: changes => changed(changes, "sync"),
    root: () => window.document.getElementById("inat-elevation-extension"),
    identify: () => window.document.getElementById("inat-elevation-identify-extension")
  };
}
const value = root => root.querySelector(".inat-elevation-value").textContent;
const complete = root => root?.querySelector(".inat-elevation-status").dataset.state === "success";

test("US locale defaults to feet on both views, while manual and Automatic changes reuse cached results", async t => {
  const app = setup(t, { locale: "es-US", html: PAGE + modal(123), settings: { allowPrivateCoordinates: false } });
  await until(() => complete(app.root()) && complete(app.identify()));
  assert.equal(value(app.root()), "≈ 404 ft");
  assert.equal(value(app.identify()), "≈ 404 ft");
  const requests = app.messages.length;
  app.change({ elevationUnit: { newValue: "meters" } });
  assert.equal(value(app.root()), "≈ 123 m");
  assert.equal(value(app.identify()), "≈ 123 m");
  for (const newValue of ["auto", undefined]) {
    app.change({ elevationUnit: { newValue } });
    assert.equal(value(app.root()), "≈ 404 ft");
    assert.equal(value(app.identify()), "≈ 404 ft");
  }
  assert.equal(app.messages.length, requests);
});

test("returning to Automatic during a pending request uses the locale and preserves an initial manual setting", async t => {
  const pending = deferred();
  const app = setup(t, {
    locale: "en-US", settings: { allowPrivateCoordinates: false, elevationUnit: "meters" },
    handler: message => message.type === "getPublicObservationCoordinates"
      ? { ok: true, latitude: 5, longitude: -76 } : pending.promise
  });
  await until(() => app.messages.some(message => message.type === "getElevation"));
  app.change({ elevationUnit: { newValue: "auto" } });
  pending.resolve({ ok: true, elevationMeters: 100 });
  await until(() => complete(app.root()));
  assert.equal(value(app.root()), "328 ft");
  assert.equal(app.messages.filter(message => message.type === "getElevation").length, 1);
});

test("normal pages use public API coordinates rather than unscoped page coordinates; units update locally", async t => {
  const app = setup(t, { settings: { allowPrivateCoordinates: false } });
  await until(() => complete(app.root()));
  assert.equal(value(app.root()), "≈ 123 m");
  assert.equal(app.fetches.length, 0);
  assert.equal(app.messages[1].latitude, 123);
  const requests = app.messages.length;
  app.change({ elevationUnit: { newValue: "feet" } });
  assert.equal(value(app.root()), "≈ 404 ft");
  assert.equal(app.messages.length, requests);
  assert.equal(app.root().hasAttribute("aria-busy"), false);
  app.root().querySelector("button").click();
  assert.equal(app.messages.at(-1).type, "openOptions");
});

test("Identify follows href changes and ignores a slow result from the previous observation", async t => {
  const slow = deferred();
  const app = setup(t, {
    settings: { allowPrivateCoordinates: false },
    html: modal(1), url: "https://colombia.inaturalist.org/observations/identify",
    handler: message => message.type === "getPublicObservationCoordinates"
      ? message.observationId === "1" ? slow.promise : { ok: true, latitude: 2, longitude: 0 }
      : { ok: true, elevationMeters: message.latitude * 10 }
  });
  app.document.querySelector(".permalink").href = "/observations/2";
  await until(() => complete(app.identify()));
  assert.equal(value(app.identify()), "20 m");
  slow.resolve({ ok: true, latitude: 1, longitude: 0 });
  await until(() => app.messages.filter(message => message.type === "getElevation").length === 2);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(value(app.identify()), "20 m");
  assert.equal(app.identify().previousElementSibling.className, "accuracy");
  app.document.querySelector(".ObservationModal").remove();
  await until(() => !app.identify());
  app.document.body.insertAdjacentHTML("beforeend", modal(2, false));
  await until(() => complete(app.identify()));
  assert.equal(app.identify().previousElementSibling.className, "location");
  assert.equal(app.messages.filter(message => message.type === "getElevation").length, 2);
});

test("normal page and modal lookups finish independently, with shared requests for the same observation", async t => {
  const app = setup(t, { html: PAGE + modal(456), settings: { allowPrivateCoordinates: false } });
  await until(() => complete(app.root()) && complete(app.identify()));
  assert.equal(value(app.root()), "≈ 123 m");
  assert.equal(value(app.identify()), "≈ 456 m");
  app.document.querySelector(".permalink").href = "/observations/123";
  await until(() => app.identify()?.dataset.observationId === "123" && complete(app.identify()));
  assert.equal(value(app.identify()), "≈ 123 m");
  assert.equal(app.messages.filter(message => message.type === "getElevation").length, 2);
  const second = setup(t, { html: PAGE + modal(123), settings: { allowPrivateCoordinates: false } });
  await until(() => complete(second.root()) && complete(second.identify()));
  assert.equal(second.messages.filter(message => message.type === "getPublicObservationCoordinates").length, 1);
  assert.equal(second.messages.filter(message => message.type === "getElevation").length, 1);
});

test("hiding exact coordinates prevents a pending account lookup from being sent externally", async t => {
  const slow = deferred();
  const app = setup(t, {
    settings: { allowPrivateCoordinates: true },
    fetch: url => String(url) === "/users/api_token"
      ? Promise.resolve({ ok: true, json: async () => ({ api_token: "test-jwt" }) })
      : slow.promise
  });
  await until(() => app.fetches.length === 2);
  app.change({ allowPrivateCoordinates: { newValue: false } });
  await until(() => complete(app.root()));
  slow.resolve({ ok: true, json: async () => ({ results: [{ private_latitude: 7, private_longitude: 8 }] }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(value(app.root()), "≈ 123 m");
  assert.equal(app.messages.filter(message => message.type === "getElevation").length, 1);
  assert.equal(app.messages.find(message => message.type === "getElevation").latitude, 123);
});

function viewerFetch(observation = { private_latitude: 7, private_longitude: 8 }) {
  return async url => {
    if (String(url) === "/users/api_token") {
      return { ok: true, json: async () => ({ api_token: "test-jwt" }) };
    }
    if (String(url).startsWith("https://api.inaturalist.org/v2/observations")) {
      return { ok: true, json: async () => ({ results: [observation] }) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

test("unhiding uses account-visible coordinates, and hiding again clears cached exact results", async t => {
  const app = setup(t, {
    settings: { allowPrivateCoordinates: false },
    fetch: viewerFetch()
  });
  await until(() => complete(app.root()));
  app.change({ allowPrivateCoordinates: { newValue: true } });
  await until(() => complete(app.root()) && value(app.root()) === "7 m");
  assert.equal(app.fetches[0][0], "/users/api_token");
  assert.equal(app.fetches[0][1].credentials, "same-origin");
  assert.match(app.fetches[1][0], /^https:\/\/api\.inaturalist\.org\/v2\/observations\?id=123&fields=/);
  assert.equal(app.fetches[1][1].credentials, "omit");
  assert.equal(app.fetches[1][1].headers.Authorization, "Bearer test-jwt");
  app.change({ allowPrivateCoordinates: { newValue: false } });
  await until(() => complete(app.root()) && value(app.root()) === "≈ 123 m");
  assert.equal(app.messages.filter(message => message.type === "getElevation").length, 3);
});

test("new installs use account-visible exact coordinates by default and preference removal restores that default", async t => {
  const app = setup(t, { fetch: viewerFetch() });
  await until(() => complete(app.root()));
  assert.equal(value(app.root()), "7 m");
  assert.equal(app.messages.some(message => message.type === "getPublicObservationCoordinates"), false);
  app.change({ allowPrivateCoordinates: { newValue: false } });
  await until(() => complete(app.root()) && value(app.root()) === "≈ 123 m");
  app.change({ allowPrivateCoordinates: { newValue: undefined } });
  await until(() => complete(app.root()) && value(app.root()) === "7 m");
});

test("missing coordinates and network failures settle to unavailable rather than staying busy", async t => {
  const app = setup(t, {
    settings: { allowPrivateCoordinates: false },
    handler: () => ({ ok: false, error: "No public coordinates" })
  });
  await until(() => app.root()?.querySelector(".inat-elevation-status").dataset.state === "error");
  assert.equal(value(app.root()), "unavailable");
  assert.equal(app.root().hasAttribute("aria-busy"), false);
  assert.equal(app.messages.length, 1);
});

for (const site of network.sites) {
  test(`automatic elevation on ${site.name}: normal page and Identify`, async t => {
    const common = {
      settings: { allowPrivateCoordinates: false },
      handler: message => message.type === "getPublicObservationCoordinates"
        ? { ok: true, latitude: 5, longitude: -76, approximate: false, source: "public" }
        : { ok: true, elevationMeters: 1907 }
    };
    const page = setup(t, { ...common, url: `${site.url}/observations/123` });
    const identify = setup(t, { ...common, html: modal(123), url: `${site.url}/observations/identify` });
    await until(() => complete(page.root()) && complete(identify.identify()));
    assert.equal(value(page.root()), "1,907 m");
    assert.equal(value(identify.identify()), "1,907 m");
    assert.equal(page.fetches.length + identify.fetches.length, 0);
    assert.equal(identify.identify().previousElementSibling.className, "accuracy");
  });
}

test("account lookup stays relative to the regional site and falls back to public coordinates when signed out", async t => {
  const app = setup(t, {
    url: "https://www.biodiversity4all.org/observations/123",
    fetch: async () => ({ ok: false, status: 401 })
  });
  await until(() => complete(app.root()));
  assert.equal(app.fetches[0][0], "/users/api_token");
  assert.equal(app.fetches[0][1].credentials, "same-origin");
  assert.equal(value(app.root()), "≈ 123 m");
});

test("React replacing the location row restores one control without a second elevation lookup", async t => {
  const app = setup(t, { settings: { allowPrivateCoordinates: false } });
  await until(() => complete(app.root()));
  const requests = app.messages.length;
  app.document.querySelector(".map_details").outerHTML = '<div class="map_details"><span class="place-guess">New location rendering</span></div>';
  await until(() => complete(app.root()));
  assert.equal(app.document.querySelectorAll("#inat-elevation-extension").length, 1);
  assert.equal(app.messages.length, requests);
});

test("changing feet while a request is pending formats its eventual result in the new unit", async t => {
  const pending = deferred();
  const app = setup(t, {
    settings: { allowPrivateCoordinates: false },
    handler: message => message.type === "getPublicObservationCoordinates"
      ? { ok: true, latitude: 5, longitude: -76 }
      : pending.promise
  });
  await until(() => app.messages.some(message => message.type === "getElevation"));
  app.change({ elevationUnit: { newValue: "feet" } });
  pending.resolve({ ok: true, elevationMeters: 100 });
  await until(() => complete(app.root()));
  assert.equal(value(app.root()), "328 ft");
  assert.equal(app.messages.filter(message => message.type === "getElevation").length, 1);
});

test("elevation numbers format using navigator.language independently of host OS locale", async t => {
  const enApp = setup(t, {
    locale: "en-GB",
    settings: { allowPrivateCoordinates: false },
    handler: message => message.type === "getPublicObservationCoordinates"
      ? { ok: true, latitude: 5, longitude: -76 }
      : { ok: true, elevationMeters: 1907 }
  });
  const deApp = setup(t, {
    locale: "de-DE",
    settings: { allowPrivateCoordinates: false },
    handler: message => message.type === "getPublicObservationCoordinates"
      ? { ok: true, latitude: 5, longitude: -76 }
      : { ok: true, elevationMeters: 1907 }
  });
  await until(() => complete(enApp.root()) && complete(deApp.root()));
  assert.equal(value(enApp.root()), "1,907 m");
  assert.equal(value(deApp.root()), "1.907 m");
});

test("intercepted API payload resolves observation coordinates with zero extra iNaturalist requests", async t => {
  const app = setup(t, {
    html: '<div class="Map"></div>',
    settings: { allowPrivateCoordinates: true }
  });
  app.window.dispatchEvent(new app.window.CustomEvent("inat-elevation:observations", {
    detail: {
      batch: false,
      observations: [{
        id: 123,
        authenticated: true,
        obscured: true,
        geojson: { type: "Point", coordinates: [0, 10] },
        private_geojson: { type: "Point", coordinates: [-76, 42] }
      }]
    }
  }));
  app.document.querySelector(".Map").innerHTML = '<div class="map_details"><span class="place-guess">Loc</span></div>';
  await until(() => complete(app.root()));
  assert.equal(value(app.root()), "42 m");
  assert.equal(app.fetches.length, 0);
  assert.equal(app.messages.some(message => message.type === "getPublicObservationCoordinates"), false);
});

test("intercepted private coordinates are ignored when allowPrivateCoordinates is false", async t => {
  const app = setup(t, {
    html: '<div class="Map"></div>',
    settings: { allowPrivateCoordinates: false }
  });
  app.window.dispatchEvent(new app.window.CustomEvent("inat-elevation:observations", {
    detail: {
      batch: false,
      observations: [{
        id: 123,
        authenticated: true,
        obscured: true,
        geojson: { type: "Point", coordinates: [0, 10] },
        private_geojson: { type: "Point", coordinates: [-76, 42] }
      }]
    }
  }));
  app.document.querySelector(".Map").innerHTML = '<div class="map_details"><span class="place-guess">Loc</span></div>';
  await until(() => complete(app.root()));
  assert.equal(value(app.root()), "≈ 10 m");
  assert.equal(app.fetches.length, 0);
  assert.equal(app.messages.some(message => message.type === "getPublicObservationCoordinates"), false);
});

test("changing elevationSource re-runs active lookup with the new provider", async t => {
  const app = setup(t, {
    settings: { allowPrivateCoordinates: false, elevationSource: "opentopodata" },
    handler: message => message.type === "getPublicObservationCoordinates"
      ? { ok: true, latitude: 5, longitude: -76 }
      : { ok: true, elevationMeters: message.source === "mapterhorn" ? 512 : 500 }
  });
  await until(() => complete(app.root()));
  assert.equal(value(app.root()), "500 m");
  assert.equal(app.messages.find(message => message.type === "getElevation").source, "opentopodata");

  app.change({ elevationSource: { newValue: "mapterhorn" } });
  await until(() => complete(app.root()) && value(app.root()) === "512 m");
  assert.equal(app.messages.filter(message => message.type === "getElevation").at(-1).source, "mapterhorn");
});
