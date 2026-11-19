const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

function encodeTerrarium(meters) {
  const value = meters + 32768;
  const r = Math.floor(value / 256);
  const g = Math.floor(value - r * 256);
  const b = Math.round((value - Math.floor(value)) * 256);
  return [r, g, b, 255];
}

function makeTile(width, height, fillMeters) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const m = typeof fillMeters === "function" ? fillMeters(x, y) : fillMeters;
      const [r, g, b, a] = encodeTerrarium(m);
      const idx = (y * width + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
  return { width, height, data };
}

function loadProviders(options = {}) {
  const context = vm.createContext({
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    Date
  });
  vm.runInContext(readFileSync(join(__dirname, "../shared.js"), "utf8"), context);
  vm.runInContext(readFileSync(join(__dirname, "../elevation-providers.js"), "utf8"), context);
  const providers = context.iNaturalistElevationProviders;
  const client = providers.createElevationClient({
    batchWindowMs: 5,
    minIntervalMs: 30,
    ...options
  });
  return { providers, client };
}

test("OpenTopoData uses 4-dataset chain with bilinear interpolation and maps dataset labels", async () => {
  const requests = [];
  const { client } = loadProviders({
    fetch: async (url, opts) => {
      requests.push({ url: String(url), opts });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "OK",
          results: [
            { dataset: "ned10m", elevation: 16.5 },
            { dataset: "eudem25m", elevation: 38.1 },
            { dataset: "nzdem8m", elevation: 16.2 },
            { dataset: "mapzen", elevation: -3845 }
          ]
        })
      };
    }
  });

  const results = await client.lookupPoints([
    { latitude: 37.7749, longitude: -122.4194 },
    { latitude: 51.478, longitude: 0 },
    { latitude: -41.2865, longitude: 174.7762 },
    { latitude: 35, longitude: -40 }
  ]);

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /^https:\/\/api\.opentopodata\.org\/v1\/ned10m,eudem25m,nzdem8m,mapzen\?/);
  assert.match(requests[0].url, /interpolation=bilinear/);
  assert.equal(requests[0].opts.credentials, "omit");
  assert.equal(requests[0].opts.referrerPolicy, "no-referrer");
  assert.equal(results[0].resolutionLabel, "USGS NED 10 m");
  assert.equal(results[1].resolutionLabel, "EU-DEM 25 m");
  assert.equal(results[2].resolutionLabel, "LINZ NZ 8 m");
  assert.equal(results[3].resolutionLabel, "Mapzen ~30 m");
  assert.equal(results[3].elevationMeters, -3845);
});

test("OpenTopoData coalesces concurrent calls and enforces minimum request interval", async () => {
  const timestamps = [];
  const { client } = loadProviders({
    batchWindowMs: 10,
    minIntervalMs: 60,
    fetch: async url => {
      timestamps.push(Date.now());
      const locParam = new URL(url).searchParams.get("locations");
      const count = locParam.split("|").length;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "OK",
          results: Array.from({ length: count }, (_, i) => ({ dataset: "mapzen", elevation: i + 10 }))
        })
      };
    }
  });

  const [a, b] = await Promise.all([
    client.lookupPoints([{ latitude: 1, longitude: 1 }]),
    client.lookupPoints([{ latitude: 2, longitude: 2 }])
  ]);
  assert.equal(timestamps.length, 1);
  assert.equal(a[0].elevationMeters, 10);
  assert.equal(b[0].elevationMeters, 11);

  await client.lookupPoints([{ latitude: 3, longitude: 3 }]);
  assert.equal(timestamps.length, 2);
  assert.ok(timestamps[1] - timestamps[0] >= 50, `Expected >=50ms spacing, got ${timestamps[1] - timestamps[0]}`);
});

test("OpenTopoData falls back automatically to Mapterhorn on HTTP 429 or null result", async () => {
  const urls = [];
  const { client } = loadProviders({
    fetch: async url => {
      const s = String(url);
      urls.push(s);
      if (s.includes("opentopodata")) {
        return { ok: false, status: 429, json: async () => ({}) };
      }
      if (s.includes("/14/")) return { ok: false, status: 404 };
      return { ok: true, status: 200, tileData: makeTile(4, 4, 250) };
    },
    decodeImage: async res => res.tileData
  });

  const [res] = await client.lookupPoints([{ latitude: 51.478, longitude: 0 }]);
  assert.ok(urls.some(u => u.includes("opentopodata")));
  assert.ok(urls.some(u => u.includes("tiles.mapterhorn.com/12/")));
  assert.equal(Math.round(res.elevationMeters), 250);
  assert.equal(res.provider, "mapterhorn");
  assert.equal(res.fallbackFrom, "opentopodata");
});

test("Mapterhorn decodes Terrarium bilinear values, caches z14 misses, and deduplicates tiles", async () => {
  const { providers } = loadProviders();
  assert.equal(providers.decodeTerrarium(128, 0, 0), 0);
  assert.equal(providers.decodeTerrarium(128, 100, 0), 100);
  assert.ok(Math.abs(providers.decodeTerrarium(127, 255, 128) - (-0.5)) < 0.01);

  const grad = makeTile(2, 2, (x, y) => x * 10 + y * 20);
  assert.ok(Math.abs(providers.sampleBilinear(grad.data, 2, 2, 0.5, 0.5) - 15) < 0.02);

  const pos = providers.latLonToTilePixel(51.478, 0, 12, 512);
  assert.equal(pos.tileX, 2048);
  assert.equal(pos.tileY, 1362);

  const fetched = [];
  const { client } = loadProviders({
    fetch: async url => {
      fetched.push(String(url));
      if (String(url).includes("/14/")) return { ok: false, status: 404 };
      return { ok: true, status: 200, tileData: makeTile(4, 4, 37) };
    },
    decodeImage: async res => res.tileData
  });

  const [r1, r2] = await Promise.all([
    client.lookupPoints([{ latitude: 51.478, longitude: 0 }], { source: "mapterhorn" }),
    client.lookupPoints([{ latitude: 51.479, longitude: 0.001 }], { source: "mapterhorn" })
  ]);
  assert.equal(Math.round(r1[0].elevationMeters), 37);
  assert.equal(r1[0].dataset, "mapterhorn-z12");
  assert.equal(r2[0].dataset, "mapterhorn-z12");
  // Same z14 and z12 tiles deduplicated + cached.
  assert.equal(fetched.filter(u => u.includes("/14/")).length, 1);
  assert.equal(fetched.filter(u => u.includes("/12/")).length, 1);

  // Subsequent lookup in same z14 tile skips retrying z14 and uses cached z12 tile.
  await client.lookupPoints([{ latitude: 51.478, longitude: 0 }], { source: "mapterhorn" });
  assert.equal(fetched.length, 2);
});

test("Open-Meteo provider supports single and multi-point queries", async () => {
  const { client } = loadProviders({
    fetch: async url => {
      assert.match(String(url), /^https:\/\/api\.open-meteo\.com\/v1\/elevation/);
      return { ok: true, status: 200, json: async () => ({ elevation: [123, -45] }) };
    }
  });

  const results = await client.lookupPoints([
    { latitude: 10, longitude: 20 },
    { latitude: 30, longitude: 40 }
  ], { source: "open-meteo" });
  assert.deepEqual(Array.from(results, r => r.elevationMeters), [123, -45]);
  assert.equal(results[0].provider, "open-meteo");
  assert.equal(results[0].dataset, "copernicus-glo90");
});

test("lookupPoint with sampleRadiusMeters samples 9 points in one batch on OpenTopoData and 17 on Mapterhorn", async () => {
  const topoUrls = [];
  const topo = loadProviders({
    fetch: async url => {
      topoUrls.push(String(url));
      const locCount = new URL(url).searchParams.get("locations").split("|").length;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "OK",
          results: Array.from({ length: locCount }, (_, idx) => ({
            dataset: "ned10m",
            elevation: 400 + idx * 35
          }))
        })
      };
    }
  });

  const topoRes = await topo.client.lookupPoint(
    { latitude: 37.77, longitude: -122.41 },
    { source: "opentopodata", sampleRadiusMeters: 500 }
  );
  assert.equal(topoUrls.length, 1);
  assert.equal(new URL(topoUrls[0]).searchParams.get("locations").split("|").length, 9);
  assert.equal(topoRes.elevationMeters, 400);
  assert.equal(topoRes.minElevationMeters, 400);
  assert.equal(topoRes.maxElevationMeters, 400 + 8 * 35);

  const mapterhorn = loadProviders({
    fetch: async url => {
      if (String(url).includes("/14/")) return { ok: false, status: 404 };
      return {
        ok: true,
        status: 200,
        tileData: makeTile(512, 512, (x, y) => 100 + Math.floor((x + y) / 10))
      };
    },
    decodeImage: async res => res.tileData
  });
  const mapRes = await mapterhorn.client.lookupPoint(
    { latitude: 46.6, longitude: 7.8 },
    { source: "mapterhorn", sampleRadiusMeters: 1500 }
  );
  assert.ok(mapRes.maxElevationMeters > mapRes.minElevationMeters);
  assert.ok(mapRes.elevationMeters >= mapRes.minElevationMeters);
  assert.ok(mapRes.elevationMeters <= mapRes.maxElevationMeters);
});
