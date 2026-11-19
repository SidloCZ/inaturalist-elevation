const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const network = require("./fixtures/network-sites.json");
const manifest = JSON.parse(readFileSync(join(__dirname, "../manifest.json"), "utf8"));

// Model Chrome's scheme/host/path match rules for these HTTPS observation patterns.
function matches(pattern, address) {
  const url = new URL(address);
  const [scheme, rest] = pattern.split("://");
  const slash = rest.indexOf("/");
  const host = rest.slice(0, slash);
  const pathPattern = rest.slice(slash).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return url.protocol === `${scheme}:`
    && (host.startsWith("*.") ? url.hostname === host.slice(2) || url.hostname.endsWith(host.slice(1)) : url.hostname === host)
    && new RegExp(`^${pathPattern}$`).test(url.pathname + url.search);
}

for (const site of network.sites) {
  test(`manifest covers observation and Identify pages: ${site.name}`, () => {
    for (const path of ["/observations/412925717", "/observations/identify", "/observations/identify?place_id=any"]) {
      assert.ok(manifest.content_scripts.some(script => script.matches.some(pattern => matches(pattern, site.url + path))), site.url + path);
    }
  });
}

test("content-script permissions exclude unrelated websites, lookalike hosts, and unrelated pages", () => {
  for (const url of ["https://example.com/observations/1", "https://inaturalist.org.evil.example/observations/1",
    "https://notinaturalist.org/observations/1", "http://www.inaturalist.org/observations/1",
    "https://www.inaturalist.org/people/test", "https://www.inaturalist.org/messages"]) {
    assert.equal(manifest.content_scripts.some(script => script.matches.some(pattern => matches(pattern, url))), false, url);
  }
});

test("manifest, package version, entry points, and declared PNG dimensions agree", () => {
  const root = join(__dirname, "..");
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.description.length <= 132);
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.ok(manifest.host_permissions.includes("https://api.opentopodata.org/*"));
  assert.ok(manifest.host_permissions.includes("https://tiles.mapterhorn.com/*"));
  const entries = [manifest.background.service_worker, "elevation-providers.js", manifest.options_ui.page,
    ...manifest.content_scripts.flatMap(script => [...script.js, ...(script.css || [])])];
  for (const name of entries) assert.ok(existsSync(join(root, name)), name);
  const mainWorldScript = manifest.content_scripts.find(script => script.world === "MAIN");
  assert.ok(mainWorldScript);
  assert.deepEqual(mainWorldScript.js, ["page-interceptor.js"]);
  assert.equal(mainWorldScript.run_at, "document_start");
  for (const site of network.sites) {
    assert.ok(mainWorldScript.matches.some(pattern => matches(pattern, `${site.url}/observations/1`)), site.url);
  }
  for (const [size, name] of Object.entries(manifest.icons)) {
    const bytes = readFileSync(join(root, name));
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    assert.equal(bytes.readUInt32BE(16), Number(size));
    assert.equal(bytes.readUInt32BE(20), Number(size));
  }
});
