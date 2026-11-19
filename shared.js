"use strict";

// Shared by the content script, extension service worker, and options page.
globalThis.iNaturalistElevation = (() => {
  const PUBLIC_OBSERVATION_FIELDS =
    "id,geojson,obscured,positional_accuracy,public_positional_accuracy,location,geoprivacy";
  const VIEWER_OBSERVATION_FIELDS =
    "id,geojson,private_geojson,obscured,positional_accuracy,public_positional_accuracy,private_positional_accuracy,location,geoprivacy";
  const ELEVATION_SOURCES = Object.freeze(["opentopodata", "mapterhorn", "open-meteo"]);
  const DEFAULT_ELEVATION_SOURCE = "opentopodata";

  function resolveElevationSource(source) {
    return ELEVATION_SOURCES.includes(source) ? source : DEFAULT_ELEVATION_SOURCE;
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
    resolveElevationSource,
    resolveElevationUnit,
    positiveNumber,
    normalizeCoordinates,
    coordinatesFromObservation,
    fetchJSON
  });
})();
