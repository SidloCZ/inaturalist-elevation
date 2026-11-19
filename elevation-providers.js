"use strict";

// Terrain elevation providers: OpenTopoData, Mapterhorn (local Terrarium tiles), and Open-Meteo.
globalThis.iNaturalistElevationProviders = (() => {
  const {
    DEFAULT_ELEVATION_SOURCE,
    resolveElevationSource,
    positiveNumber,
    normalizeCoordinates,
    sampleCircleCoordinates
  } = iNaturalistElevation;

  const OPENTOPODATA_DATASETS = "ned10m,eudem25m,nzdem8m,mapzen";
  const OPENTOPODATA_DATASET_LABELS = Object.freeze({
    ned10m: "USGS NED 10 m",
    eudem25m: "EU-DEM 25 m",
    nzdem8m: "LINZ NZ 8 m",
    mapzen: "Mapzen ~30 m"
  });
  const MAX_LOCATIONS_PER_BATCH = 100;
  const MAX_TILE_CACHE = 32;
  const MAX_MISSING_Z14 = 500;
  const MAPTERHORN_TILE_SIZE = 512;
  const MAX_MERCATOR_LAT = 85.0511287;
  const DEFAULT_TIMEOUT_MS = 12000;

  const JSON_REQUEST_OPTIONS = {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: { Accept: "application/json" }
  };
  const TILE_REQUEST_OPTIONS = {
    credentials: "omit",
    referrerPolicy: "no-referrer"
  };

  function decodeTerrarium(r, g, b) {
    return (r * 256 + g + b / 256) - 32768;
  }

  function latLonToTilePixel(latitude, longitude, zoom, tileSize = MAPTERHORN_TILE_SIZE) {
    const clampedLat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, latitude));
    const n = 2 ** zoom;
    const xRaw = ((longitude + 180) / 360) * n;
    const xWrapped = ((xRaw % n) + n) % n;
    const latRad = (clampedLat * Math.PI) / 180;
    const yRaw = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
    const yClamped = Math.max(0, Math.min(n - 1e-9, yRaw));
    const tileX = Math.floor(xWrapped);
    const tileY = Math.floor(yClamped);
    return {
      tileX,
      tileY,
      px: (xWrapped - tileX) * tileSize,
      py: (yClamped - tileY) * tileSize
    };
  }

  function sampleBilinear(rgba, width, height, px, py) {
    const x = Math.max(0, Math.min(width - 1, px));
    const y = Math.max(0, Math.min(height - 1, py));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;

    function elevAt(ix, iy) {
      const idx = (iy * width + ix) * 4;
      return decodeTerrarium(rgba[idx], rgba[idx + 1], rgba[idx + 2]);
    }

    const top = elevAt(x0, y0) * (1 - tx) + elevAt(x1, y0) * tx;
    const bottom = elevAt(x0, y1) * (1 - tx) + elevAt(x1, y1) * tx;
    return top * (1 - ty) + bottom * ty;
  }

  async function defaultDecodeImage(response) {
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
      return {
        width: bitmap.width,
        height: bitmap.height,
        data: imageData.data
      };
    } finally {
      if (typeof bitmap.close === "function") bitmap.close();
    }
  }

  function formatOpenTopoDatasetLabel(dataset) {
    return OPENTOPODATA_DATASET_LABELS[dataset] || (dataset ? String(dataset) : "OpenTopoData");
  }

  function createElevationClient({
    fetch: fetchImpl = globalThis.fetch,
    decodeImage = defaultDecodeImage,
    batchWindowMs = 60,
    minIntervalMs = 1100,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    now = () => Date.now()
  } = {}) {
    const tileCache = new Map();
    const inFlightTiles = new Map();
    const missingZ14Tiles = new Set();
    let openTopoQueue = [];
    let openTopoFlushTimer = null;
    let openTopoChain = Promise.resolve();
    let lastOpenTopoRequestAt = 0;

    async function fetchWithTimeout(url, options) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetchImpl(url, { ...options, signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error("The lookup timed out. Reload the page to try again.");
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    async function fetchJSONWithTimeout(url) {
      const response = await fetchWithTimeout(url, JSON_REQUEST_OPTIONS);
      if (!response.ok) {
        const error = new Error(`The service returned HTTP ${response.status}.`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    }

    function rememberMissingZ14(tileKey) {
      if (missingZ14Tiles.has(tileKey)) return;
      missingZ14Tiles.add(tileKey);
      if (missingZ14Tiles.size > MAX_MISSING_Z14) {
        missingZ14Tiles.delete(missingZ14Tiles.values().next().value);
      }
    }

    function getCachedTile(key) {
      if (!tileCache.has(key)) return null;
      const tile = tileCache.get(key);
      tileCache.delete(key);
      tileCache.set(key, tile);
      return tile;
    }

    function setCachedTile(key, tile) {
      if (tileCache.has(key)) tileCache.delete(key);
      tileCache.set(key, tile);
      if (tileCache.size > MAX_TILE_CACHE) {
        tileCache.delete(tileCache.keys().next().value);
      }
    }

    async function loadTile(zoom, tileX, tileY) {
      const key = `${zoom}/${tileX}/${tileY}`;
      const cached = getCachedTile(key);
      if (cached) return cached;
      if (inFlightTiles.has(key)) return inFlightTiles.get(key);

      const task = (async () => {
        const url = `https://tiles.mapterhorn.com/${zoom}/${tileX}/${tileY}.webp`;
        const response = await fetchWithTimeout(url, TILE_REQUEST_OPTIONS);
        if (response.status === 404) {
          if (zoom === 14) {
            rememberMissingZ14(key);
            return null;
          }
          throw new Error("No terrain elevation was available for these coordinates.");
        }
        if (!response.ok) {
          const error = new Error(`The service returned HTTP ${response.status}.`);
          error.status = response.status;
          throw error;
        }
        const decoded = await decodeImage(response);
        if (!decoded || !decoded.data || !decoded.width || !decoded.height) {
          throw new Error("Could not decode terrain tile data.");
        }
        setCachedTile(key, decoded);
        return decoded;
      })().finally(() => {
        inFlightTiles.delete(key);
      });

      inFlightTiles.set(key, task);
      return task;
    }

    async function lookupMapterhornPoint(point) {
      const z14Pos = latLonToTilePixel(point.latitude, point.longitude, 14, MAPTERHORN_TILE_SIZE);
      const z14Key = `14/${z14Pos.tileX}/${z14Pos.tileY}`;
      let zoom = 14;
      let pos = z14Pos;
      let tile = missingZ14Tiles.has(z14Key) ? null : await loadTile(14, z14Pos.tileX, z14Pos.tileY);

      if (!tile) {
        zoom = 12;
        pos = latLonToTilePixel(point.latitude, point.longitude, 12, MAPTERHORN_TILE_SIZE);
        tile = await loadTile(12, pos.tileX, pos.tileY);
      }

      // Align tile pixel coordinates to pixel centers (i + 0.5, j + 0.5).
      const sampleX = (pos.px / MAPTERHORN_TILE_SIZE) * tile.width - 0.5;
      const sampleY = (pos.py / MAPTERHORN_TILE_SIZE) * tile.height - 0.5;
      const elevationMeters = sampleBilinear(tile.data, tile.width, tile.height, sampleX, sampleY);
      if (typeof elevationMeters !== "number" || !Number.isFinite(elevationMeters)) {
        throw new Error("No terrain elevation was available for these coordinates.");
      }

      return {
        elevationMeters,
        provider: "mapterhorn",
        dataset: `mapterhorn-z${zoom}`,
        resolutionLabel: zoom === 14
          ? "Mapterhorn LiDAR/DEM (z14)"
          : "Mapterhorn Copernicus/DEM (z12)"
      };
    }

    async function lookupMapterhornPoints(points) {
      return Promise.all(points.map(point => lookupMapterhornPoint(point)));
    }

    async function executeOpenTopoChunk(items) {
      const elapsed = now() - lastOpenTopoRequestAt;
      if (lastOpenTopoRequestAt > 0 && elapsed < minIntervalMs) {
        await new Promise(resolve => setTimeout(resolve, minIntervalMs - elapsed));
      }

      const locations = items.map(item => `${item.latitude},${item.longitude}`).join("|");
      const url = `https://api.opentopodata.org/v1/${OPENTOPODATA_DATASETS}?locations=${locations}&interpolation=bilinear`;
      lastOpenTopoRequestAt = now();
      const data = await fetchJSONWithTimeout(url);
      if (data?.status !== "OK" || !Array.isArray(data?.results) || data.results.length !== items.length) {
        throw new Error("No terrain elevation was available for these coordinates.");
      }

      return data.results.map(entry => {
        const elevationMeters = entry?.elevation;
        if (typeof elevationMeters !== "number" || !Number.isFinite(elevationMeters)) {
          return null;
        }
        const dataset = entry.dataset || "mapzen";
        return {
          elevationMeters,
          provider: "opentopodata",
          dataset,
          resolutionLabel: formatOpenTopoDatasetLabel(dataset)
        };
      });
    }

    function scheduleOpenTopoFlush() {
      if (openTopoQueue.length >= MAX_LOCATIONS_PER_BATCH) {
        if (openTopoFlushTimer) {
          clearTimeout(openTopoFlushTimer);
          openTopoFlushTimer = null;
        }
        flushOpenTopoQueue();
        return;
      }
      if (openTopoFlushTimer) return;
      openTopoFlushTimer = setTimeout(() => {
        openTopoFlushTimer = null;
        flushOpenTopoQueue();
      }, batchWindowMs);
    }

    function flushOpenTopoQueue() {
      if (!openTopoQueue.length) return;
      const snapshot = openTopoQueue;
      openTopoQueue = [];

      for (let i = 0; i < snapshot.length; i += MAX_LOCATIONS_PER_BATCH) {
        const chunk = snapshot.slice(i, i + MAX_LOCATIONS_PER_BATCH);
        openTopoChain = openTopoChain.then(async () => {
          let results = null;
          let chunkError = null;
          try {
            results = await executeOpenTopoChunk(chunk);
          } catch (error) {
            chunkError = error;
          }

          await Promise.all(chunk.map(async (item, index) => {
            const direct = results?.[index];
            if (direct) {
              item.resolve(direct);
              return;
            }
            if (!item.allowFallback) {
              item.reject(chunkError || new Error("No terrain elevation was available for these coordinates."));
              return;
            }
            try {
              const fallback = await lookupMapterhornPoint(item);
              item.resolve({ ...fallback, fallbackFrom: "opentopodata" });
            } catch (fallbackError) {
              item.reject(chunkError || fallbackError);
            }
          }));
        });
      }
    }

    function enqueueOpenTopoPoints(points, allowFallback) {
      return Promise.all(points.map(point => new Promise((resolve, reject) => {
        openTopoQueue.push({
          latitude: point.latitude,
          longitude: point.longitude,
          allowFallback,
          resolve,
          reject
        });
        scheduleOpenTopoFlush();
      })));
    }

    async function lookupOpenMeteoPoints(points) {
      const allResults = [];
      for (let i = 0; i < points.length; i += MAX_LOCATIONS_PER_BATCH) {
        const chunk = points.slice(i, i + MAX_LOCATIONS_PER_BATCH);
        const url = new URL("https://api.open-meteo.com/v1/elevation");
        url.searchParams.set("latitude", chunk.map(p => String(p.latitude)).join(","));
        url.searchParams.set("longitude", chunk.map(p => String(p.longitude)).join(","));
        const data = await fetchJSONWithTimeout(url);
        const elevations = Array.isArray(data?.elevation) ? data.elevation : [];
        for (let j = 0; j < chunk.length; j += 1) {
          const elevationMeters = elevations[j];
          if (typeof elevationMeters !== "number" || !Number.isFinite(elevationMeters)) {
            throw new Error("No terrain elevation was available for these coordinates.");
          }
          allResults.push({
            elevationMeters,
            provider: "open-meteo",
            dataset: "copernicus-glo90",
            resolutionLabel: "Copernicus GLO-90 (~90 m)"
          });
        }
      }
      return allResults;
    }

    async function lookupPoints(points, options = {}) {
      if (!Array.isArray(points) || !points.length) return [];
      const normalized = points.map(point => {
        const coords = normalizeCoordinates(point?.latitude, point?.longitude);
        if (!coords) throw new Error("The observation did not provide valid coordinates.");
        return coords;
      });
      const source = resolveElevationSource(options.source || DEFAULT_ELEVATION_SOURCE);
      const allowFallback = options.allowFallback !== false;

      if (source === "mapterhorn") return lookupMapterhornPoints(normalized);
      if (source === "open-meteo") return lookupOpenMeteoPoints(normalized);
      return enqueueOpenTopoPoints(normalized, allowFallback);
    }

    async function lookupPoint(point, options = {}) {
      const coords = normalizeCoordinates(point?.latitude, point?.longitude);
      if (!coords) throw new Error("The observation did not provide valid coordinates.");
      const source = resolveElevationSource(options.source || DEFAULT_ELEVATION_SOURCE);
      const radiusMeters = positiveNumber(options.sampleRadiusMeters);
      if (!radiusMeters) {
        const [result] = await lookupPoints([coords], { ...options, source });
        return result;
      }

      let samplePoints;
      if (source === "mapterhorn") {
        const innerRing = sampleCircleCoordinates(coords.latitude, coords.longitude, radiusMeters * 0.5, 8).slice(1);
        const outerRing = sampleCircleCoordinates(coords.latitude, coords.longitude, radiusMeters, 8);
        samplePoints = [outerRing[0], ...innerRing, ...outerRing.slice(1)];
      } else {
        samplePoints = sampleCircleCoordinates(coords.latitude, coords.longitude, radiusMeters, 8);
      }

      const results = await lookupPoints(samplePoints, { ...options, source });
      const center = results[0];
      let minElevationMeters = center.elevationMeters;
      let maxElevationMeters = center.elevationMeters;
      for (const entry of results) {
        if (entry.elevationMeters < minElevationMeters) minElevationMeters = entry.elevationMeters;
        if (entry.elevationMeters > maxElevationMeters) maxElevationMeters = entry.elevationMeters;
      }
      return {
        ...center,
        minElevationMeters,
        maxElevationMeters
      };
    }

    function clearCaches() {
      tileCache.clear();
      inFlightTiles.clear();
      missingZ14Tiles.clear();
    }

    return Object.freeze({ lookupPoints, lookupPoint, clearCaches });
  }

  return Object.freeze({
    OPENTOPODATA_DATASETS,
    decodeTerrarium,
    latLonToTilePixel,
    sampleBilinear,
    createElevationClient
  });
})();
