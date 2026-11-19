"use strict";

if (typeof importScripts === "function") {
  importScripts("shared.js", "elevation-providers.js");
}
const {
  PUBLIC_OBSERVATION_FIELDS,
  DEFAULT_ELEVATION_SOURCE,
  resolveElevationSource,
  positiveNumber,
  normalizeCoordinates,
  coordinatesFromObservation,
  fetchJSON
} = iNaturalistElevation;
const { createElevationClient } = iNaturalistElevationProviders;
const REQUEST_OPTIONS = {
  credentials: "omit",
  referrerPolicy: "no-referrer",
  headers: { Accept: "application/json" }
};
const elevationClient = createElevationClient(globalThis.__elevationClientOptions);

async function fetchElevation(latitude, longitude, options = {}) {
  const coordinates = normalizeCoordinates(latitude, longitude);
  if (!coordinates) throw new Error("The observation did not provide valid coordinates.");
  const source = resolveElevationSource(options.source || DEFAULT_ELEVATION_SOURCE);
  const sampleRadiusMeters = positiveNumber(options.sampleRadiusMeters);
  const result = await elevationClient.lookupPoint(coordinates, {
    source,
    allowFallback: options.allowFallback,
    sampleRadiusMeters
  });
  if (!result || typeof result.elevationMeters !== "number" || !Number.isFinite(result.elevationMeters)) {
    throw new Error("No terrain elevation was available for these coordinates.");
  }
  return result;
}

async function fetchPublicObservationCoordinates(observationId) {
  if (!/^[1-9]\d*$/.test(String(observationId))) {
    throw new Error("This does not look like an iNaturalist observation.");
  }
  const data = await fetchJSON(
    `https://api.inaturalist.org/v2/observations?id=${observationId}&fields=${PUBLIC_OBSERVATION_FIELDS}`,
    REQUEST_OPTIONS
  );
  const coordinates = coordinatesFromObservation(data?.results?.[0]);
  if (!coordinates) throw new Error("This observation has no public coordinates.");
  return coordinates;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== "object") return false;

  let task;
  if (message.type === "getElevation") {
    task = fetchElevation(message.latitude, message.longitude, {
      source: message.source,
      allowFallback: message.allowFallback,
      sampleRadiusMeters: message.sampleRadiusMeters
    });
  } else if (message.type === "getPublicObservationCoordinates") {
    task = fetchPublicObservationCoordinates(message.observationId);
  } else if (message.type === "openOptions") {
    task = chrome.runtime.openOptionsPage().then(() => ({}));
  } else {
    return false;
  }

  task
    .then(result => sendResponse({ ok: true, ...result }))
    .catch(error => sendResponse({
      ok: false,
      error: error && error.message ? error.message : "The lookup failed."
    }));

  return true;
});
