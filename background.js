"use strict";

importScripts("shared.js");
const { normalizeCoordinates, coordinatesFromObservation, fetchJSON } = iNaturalistElevation;
const REQUEST_OPTIONS = {
  credentials: "omit",
  referrerPolicy: "no-referrer",
  headers: { Accept: "application/json" }
};

async function fetchElevation(latitude, longitude) {
  const coordinates = normalizeCoordinates(latitude, longitude);
  if (!coordinates) throw new Error("The observation did not provide valid coordinates.");
  const url = new URL("https://api.open-meteo.com/v1/elevation");
  url.searchParams.set("latitude", String(coordinates.latitude));
  url.searchParams.set("longitude", String(coordinates.longitude));
  const data = await fetchJSON(url, REQUEST_OPTIONS);
  const elevationMeters = Array.isArray(data?.elevation) ? data.elevation[0] : undefined;
  if (typeof elevationMeters !== "number" || !Number.isFinite(elevationMeters)) {
    throw new Error("No terrain elevation was available for these coordinates.");
  }

  return { elevationMeters };
}

async function fetchPublicObservationCoordinates(observationId) {
  if (!/^[1-9]\d*$/.test(String(observationId))) {
    throw new Error("This does not look like an iNaturalist observation.");
  }
  const data = await fetchJSON(
    `https://api.inaturalist.org/v1/observations/${observationId}`,
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
    task = fetchElevation(message.latitude, message.longitude);
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
