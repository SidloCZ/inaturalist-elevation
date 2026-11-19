"use strict";

// Shared by the content script, extension service worker, and options page.
globalThis.iNaturalistElevation = (() => {
  const PUBLIC_OBSERVATION_FIELDS =
    "id,geojson,obscured,positional_accuracy,public_positional_accuracy,location,geoprivacy";
  const VIEWER_OBSERVATION_FIELDS =
    "id,geojson,private_geojson,obscured,positional_accuracy,public_positional_accuracy,private_positional_accuracy,location,geoprivacy";
  const ELEVATION_SOURCES = Object.freeze(["opentopodata", "mapterhorn", "open-meteo"]);
  const DEFAULT_ELEVATION_SOURCE = "opentopodata";
  const UNCERTAINTY_MODES = Object.freeze(["range", "mark", "hide"]);
  const DEFAULT_UNCERTAINTY_MODE = "range";
  const DEFAULT_ACCURACY_THRESHOLD = 100;
  const DEEP_OCEAN_THRESHOLD_METERS = -450;
  const EARTH_RADIUS_METERS = 6371000;

  function resolveElevationSource(source) {
    return ELEVATION_SOURCES.includes(source) ? source : DEFAULT_ELEVATION_SOURCE;
  }

  function resolveUncertaintyMode(mode) {
    return UNCERTAINTY_MODES.includes(mode) ? mode : DEFAULT_UNCERTAINTY_MODE;
  }

  function resolveAccuracyThreshold(value) {
    const num = coordinateNumber(value);
    return Number.isFinite(num) && num >= 0 ? Math.round(num) : DEFAULT_ACCURACY_THRESHOLD;
  }

  function resolveElevationUnit(preference, locale = globalThis.navigator?.language) {
    if (preference === "feet" || preference === "meters") return preference;
    try {
      return new Intl.Locale(locale).region === "US" ? "feet" : "meters";
    } catch (_error) {
      return "meters";
    }
  }

  function coordinateNumber(value) {
    if (typeof value !== "number" && typeof value !== "string") return NaN;
    if (typeof value === "string" && !value.trim()) return NaN;
    return Number(value);
  }

  function positiveNumber(value) {
    const number = coordinateNumber(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function normalizeCoordinates(latitude, longitude, options = {}) {
    const lat = coordinateNumber(latitude);
    const lon = coordinateNumber(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)
        || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return {
      latitude: lat,
      longitude: lon,
      approximate: Boolean(options.approximate),
      accuracyMeters: positiveNumber(options.accuracyMeters),
      source: options.source || "iNaturalist public coordinates"
    };
  }

  function fromGeoJSON(geojson, options) {
    if (geojson?.type !== "Point" || !Array.isArray(geojson.coordinates)) return null;
    return normalizeCoordinates(geojson.coordinates[1], geojson.coordinates[0], options);
  }

  function coordinatesFromObservation(observation, allowPrivate = false) {
    if (!observation || typeof observation !== "object") return null;
    if (allowPrivate) {
      const options = {
        source: "exact coordinates visible to your iNaturalist account",
        accuracyMeters: positiveNumber(observation.private_positional_accuracy)
          ?? positiveNumber(observation.positional_accuracy)
      };
      const privateCoordinates = fromGeoJSON(observation.private_geojson, options)
        || normalizeCoordinates(observation.private_latitude, observation.private_longitude, options);
      if (privateCoordinates) return privateCoordinates;
    }

    const options = {
      approximate: observation.obscured === true,
      accuracyMeters: positiveNumber(observation.public_positional_accuracy)
        ?? positiveNumber(observation.positional_accuracy)
    };
    const publicCoordinates = fromGeoJSON(observation.geojson, options)
      || normalizeCoordinates(observation.latitude, observation.longitude, options);
    if (publicCoordinates) return publicCoordinates;
    if (typeof observation.location !== "string") return null;
    const parts = observation.location.split(",");
    return parts.length === 2 ? normalizeCoordinates(parts[0], parts[1], options) : null;
  }

  function sampleCircleCoordinates(latitude, longitude, radiusMeters, ringPoints = 8) {
    const center = normalizeCoordinates(latitude, longitude);
    if (!center) return [];
    const radiusNum = coordinateNumber(radiusMeters);
    if (!Number.isFinite(radiusNum) || radiusNum <= 0) {
      return [{ latitude: center.latitude, longitude: center.longitude }];
    }
    const clampedRadius = Math.max(1, Math.min(25000, radiusNum));
    const angularDistance = clampedRadius / EARTH_RADIUS_METERS;
    const lat1 = (center.latitude * Math.PI) / 180;
    const lon1 = (center.longitude * Math.PI) / 180;
    const sinLat1 = Math.sin(lat1);
    const cosLat1 = Math.cos(lat1);
    const sinDist = Math.sin(angularDistance);
    const cosDist = Math.cos(angularDistance);

    const points = [{ latitude: center.latitude, longitude: center.longitude }];
    for (let i = 0; i < ringPoints; i += 1) {
      const bearing = (2 * Math.PI * i) / ringPoints;
      const lat2 = Math.asin(sinLat1 * cosDist + cosLat1 * sinDist * Math.cos(bearing));
      const lon2 = lon1 + Math.atan2(
        Math.sin(bearing) * sinDist * cosLat1,
        cosDist - sinLat1 * Math.sin(lat2)
      );
      const latDeg = Math.max(-89.9, Math.min(89.9, (lat2 * 180) / Math.PI));
      const rawLonDeg = (lon2 * 180) / Math.PI;
      const lonDeg = (((rawLonDeg + 540) % 360) - 180);
      points.push({
        latitude: Number(latDeg.toFixed(6)),
        longitude: Number(lonDeg.toFixed(6))
      });
    }
    return points;
  }

  function macrostratUrl(latitude, longitude) {
    const coords = normalizeCoordinates(latitude, longitude);
    if (!coords) return null;
    return `https://macrostrat.org/map/loc/${coords.longitude}/${coords.latitude}#z=13`;
  }

  function getExtensionAPI() {
    return globalThis.browser || globalThis.chrome || null;
  }

  function invokeExtensionMethod(target, methodName, args, onSuccess, onError) {
    const api = getExtensionAPI();
    const fn = target?.[methodName];
    if (typeof fn !== "function") {
      onError?.(new Error(`Extension API ${methodName} is unavailable.`));
      return;
    }
    if (globalThis.browser && api === globalThis.browser) {
      Promise.resolve()
        .then(() => fn.apply(target, args))
        .then(result => onSuccess?.(result), error => onError?.(error));
      return;
    }
    try {
      fn.call(target, ...args, result => {
        const lastError = api?.runtime?.lastError;
        if (lastError) {
          onError?.(new Error(lastError.message || "Extension API error."));
        } else {
          onSuccess?.(result);
        }
      });
    } catch (error) {
      onError?.(error);
    }
  }

  function sendRuntimeMessage(message) {
    const api = getExtensionAPI();
    return new Promise((resolve, reject) => {
      invokeExtensionMethod(
        api?.runtime,
        "sendMessage",
        [message],
        response => {
          if (!response || !response.ok) {
            reject(new Error(response && response.error
              ? response.error
              : "The extension did not receive a response."));
            return;
          }
          resolve(response);
        },
        error => reject(error instanceof Error ? error : new Error(String(error)))
      );
    });
  }

  async function fetchJSON(url, options = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) throw new Error(`The service returned HTTP ${response.status}.`);
      return await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw new Error("The lookup timed out. Reload the page to try again.");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    PUBLIC_OBSERVATION_FIELDS,
    VIEWER_OBSERVATION_FIELDS,
    ELEVATION_SOURCES,
    DEFAULT_ELEVATION_SOURCE,
    UNCERTAINTY_MODES,
    DEFAULT_UNCERTAINTY_MODE,
    DEFAULT_ACCURACY_THRESHOLD,
    DEEP_OCEAN_THRESHOLD_METERS,
    resolveElevationSource,
    resolveUncertaintyMode,
    resolveAccuracyThreshold,
    resolveElevationUnit,
    positiveNumber,
    normalizeCoordinates,
    coordinatesFromObservation,
    sampleCircleCoordinates,
    macrostratUrl,
    getExtensionAPI,
    invokeExtensionMethod,
    sendRuntimeMessage,
    fetchJSON
  });
})();
