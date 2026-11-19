"use strict";

(() => {
  const ROOT_ID = "inat-elevation-extension";
  const IDENTIFY_ROOT_ID = "inat-elevation-identify-extension";
  const METERS_TO_FEET = 3.28084;
  const {
    VIEWER_OBSERVATION_FIELDS,
    DEFAULT_ELEVATION_SOURCE,
    resolveElevationSource,
    resolveElevationUnit,
    coordinatesFromObservation,
    fetchJSON
  } = iNaturalistElevation;
  const MAX_CACHED_OBSERVATIONS = 200;
  const MAX_INTERCEPTED_OBSERVATIONS = 300;
  let currentObservationId = null;
  let currentIdentifyObservationId = null;
  let injectionTimer = null;
  let settingsGeneration = 0;
  let preferredUnit = resolveElevationUnit("auto");
  let allowPrivateCoordinates = false;
  let elevationSource = DEFAULT_ELEVATION_SOURCE;
  let viewerApiToken = null;
  let pendingTokenRequest = null;
  const resultCache = new Map();
  const pendingLookups = new Map();
  const interceptedObservations = new Map();
  const rootLookups = new WeakMap();

  function hasPrivateFields(observation) {
    return Boolean(observation && (observation.private_geojson || observation.private_latitude != null));
  }

  function recordInterceptedObservation(observation) {
    if (!observation || typeof observation !== "object" || observation.id == null) return;
    const key = String(observation.id);
    if (!/^[1-9]\d*$/.test(key)) return;
    const existing = interceptedObservations.get(key);
    const existingRich = Boolean(existing && (existing.authenticated || hasPrivateFields(existing)));
    const nextRich = Boolean(observation.authenticated || hasPrivateFields(observation));
    if (existing && existingRich && !nextRich) return;

    if (interceptedObservations.has(key)) interceptedObservations.delete(key);
    interceptedObservations.set(key, observation);
    if (interceptedObservations.size > MAX_INTERCEPTED_OBSERVATIONS) {
      interceptedObservations.delete(interceptedObservations.keys().next().value);
    }
  }

  function observationIdFromPath() {
    const match = window.location.pathname.match(/^\/observations\/(\d+)(?:\/|$)/);
    return match ? match[1] : null;
  }

  async function getViewerApiToken() {
    if (viewerApiToken) return viewerApiToken;
    const metaToken = document.querySelector('meta[name="inaturalist-api-token"]')
      ?.getAttribute("content")?.trim();
    if (metaToken) {
      viewerApiToken = metaToken;
      return viewerApiToken;
    }
    if (pendingTokenRequest) return pendingTokenRequest;

    pendingTokenRequest = fetchJSON("/users/api_token", {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    }).then(data => {
      const token = typeof data?.api_token === "string" ? data.api_token.trim() : "";
      if (token) viewerApiToken = token;
      return token || null;
    }).finally(() => {
      pendingTokenRequest = null;
    });

    return pendingTokenRequest;
  }

  async function fetchViewerCoordinates(observationId) {
    const token = await getViewerApiToken();
    if (!token) return null;
    try {
      const data = await fetchJSON(
        `https://api.inaturalist.org/v2/observations?id=${observationId}&fields=${VIEWER_OBSERVATION_FIELDS}`,
        {
          credentials: "omit",
          referrerPolicy: "no-referrer",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`
          }
        }
      );
      const observation = data?.results?.[0];
      if (observation) recordInterceptedObservation({ ...observation, authenticated: true });
      return coordinatesFromObservation(observation, true);
    } catch (error) {
      if (error && /HTTP 40[13]\b/.test(error.message)) viewerApiToken = null;
      throw error;
    }
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || !response.ok) {
          reject(new Error(response && response.error
            ? response.error
            : "The extension did not receive a response."));
          return;
        }
        resolve(response);
      });
    });
  }

  async function resolveCoordinates(observationId, allowPrivate) {
    const cachedObs = interceptedObservations.get(String(observationId));
    if (cachedObs) {
      if (!allowPrivate) {
        const publicCoords = coordinatesFromObservation(cachedObs, false);
        if (publicCoords) return publicCoords;
      } else if (hasPrivateFields(cachedObs) || !cachedObs.obscured || cachedObs.authenticated) {
        const coords = coordinatesFromObservation(cachedObs, true);
        if (coords) return coords;
      }
    }

    if (allowPrivate) {
      try {
        const viewerCoordinates = await fetchViewerCoordinates(observationId);
        if (viewerCoordinates) return viewerCoordinates;
      } catch (_error) {
        // Use public coordinates if the account-specific route is unavailable.
      }
    }

    return sendMessage({
      type: "getPublicObservationCoordinates",
      observationId
    });
  }

  function formatNumber(value) {
    const rounded = Math.round(value);
    const locale = window.navigator?.language;
    if (locale) {
      try {
        return rounded.toLocaleString(locale);
      } catch (_error) {
        // Fall back to the runtime default locale if navigator.language is invalid.
      }
    }
    return rounded.toLocaleString();
  }

  function formatElevation(meters) {
    if (preferredUnit === "feet") {
      return `${formatNumber(meters * METERS_TO_FEET)} ft`;
    }
    return `${formatNumber(meters)} m`;
  }

  function renderCachedResult(root, cached) {
    const prefix = cached.approximate ? "≈ " : "";
    setStatus(
      root,
      "success",
      `${prefix}${formatElevation(cached.elevationMeters)}`,
      cached.title
    );
  }

  function setStatus(root, state, text, title = "") {
    const status = root.querySelector(".inat-elevation-status");
    const value = root.querySelector(".inat-elevation-value");
    status.dataset.state = state;
    value.textContent = text;
    status.title = title;
  }

  function lookupResult(observationId) {
    if (resultCache.has(observationId)) return Promise.resolve(resultCache.get(observationId));
    if (pendingLookups.has(observationId)) return pendingLookups.get(observationId);
    const generation = settingsGeneration;
    const allowPrivate = allowPrivateCoordinates;
    const source = elevationSource;
    const task = (async () => {
      const coordinates = await resolveCoordinates(observationId, allowPrivate);
      // Never start a precise-location lookup after the user disables that setting.
      if (generation !== settingsGeneration) throw new Error("Settings changed.");
      const result = await sendMessage({
        type: "getElevation",
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        source
      });

      const privacyNote = coordinates.approximate
        ? " Approximate: iNaturalist obscured the observation's exact location."
        : "";
      const title = [
        `Coordinates: ${coordinates.source}.`,
        privacyNote
      ].join(" ").trim();
      const cached = {
        elevationMeters: result.elevationMeters,
        approximate: coordinates.approximate,
        title
      };
      if (generation === settingsGeneration) {
        resultCache.set(observationId, cached);
        if (resultCache.size > MAX_CACHED_OBSERVATIONS) {
          resultCache.delete(resultCache.keys().next().value);
        }
      }
      return cached;
    })().finally(() => {
      if (pendingLookups.get(observationId) === task) pendingLookups.delete(observationId);
    });
    pendingLookups.set(observationId, task);
    return task;
  }

  async function lookUpElevation(root, observationId) {
    const token = {};
    rootLookups.set(root, token);
    const generation = settingsGeneration;
    const isCurrent = () => root.isConnected && rootLookups.get(root) === token
      && generation === settingsGeneration && root.dataset.observationId === observationId
      && (root.id === ROOT_ID ? observationIdFromPath() : identifyModalContext()?.observationId) === observationId;
    root.setAttribute("aria-busy", "true");
    setStatus(root, "loading", "looking up…");
    try {
      const result = await lookupResult(observationId);
      if (isCurrent()) renderCachedResult(root, result);
    } catch (error) {
      if (isCurrent()) setStatus(root, "error", "unavailable", error.message);
    } finally {
      if (isCurrent()) root.removeAttribute("aria-busy");
    }
  }

  function makeControl(observationId, options = {}) {
    const identifyView = Boolean(options.identifyView);
    const root = document.createElement(identifyView ? "li" : "div");
    root.id = identifyView ? IDENTIFY_ROOT_ID : ROOT_ID;
    root.dataset.observationId = observationId;

    if (identifyView) {
      root.className = "inat-elevation-identify-row";
      const icon = document.createElement("i");
      icon.className = "fa fa-area-chart bullet-icon";
      icon.setAttribute("aria-hidden", "true");
      root.append(icon);
    }

    const status = document.createElement("span");
    status.className = "inat-elevation-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    const label = document.createElement("span");
    label.className = "inat-elevation-label";
    label.textContent = "Elev.:";

    const value = document.createElement("span");
    value.className = "inat-elevation-value";
    status.append(label, document.createTextNode(" "), value);

    const infoButton = document.createElement("button");
    infoButton.type = "button";
    infoButton.className = "inat-elevation-info";
    infoButton.textContent = "ⓘ";
    infoButton.title = "Elevation data source and licensing";
    infoButton.setAttribute("aria-label", "Open elevation data source and licensing information");
    infoButton.addEventListener("click", async () => {
      try {
        await sendMessage({ type: "openOptions" });
      } catch (error) {
        infoButton.title = error.message;
      }
    });

    root.append(status, infoButton);
    return root;
  }

  function findLocationRow() {
    return document.querySelector(".Map .map_details")
      || Array.from(document.querySelectorAll(".map_details"))
        .find(element => element.querySelector(".place-guess"))
      || null;
  }

  function injectObservationPage() {
    const observationId = observationIdFromPath();
    const oldControl = document.getElementById(ROOT_ID);

    if (!observationId) {
      if (oldControl) oldControl.remove();
      currentObservationId = null;
      return;
    }

    if (observationId !== currentObservationId) {
      if (oldControl) oldControl.remove();
      currentObservationId = observationId;
    }

    const existing = document.getElementById(ROOT_ID);
    if (existing && existing.dataset.observationId === observationId) return;

    const locationRow = findLocationRow();
    if (!locationRow) return;

    const control = makeControl(observationId);
    const detailsMenu = locationRow.querySelector(".details_menu");
    locationRow.insertBefore(control, detailsMenu || null);
    lookUpElevation(control, observationId);
  }

  function identifyModalContext() {
    const modal = document.querySelector(".ObservationModal");
    if (!modal) return null;

    const permalink = modal.querySelector(
      ".map-and-details .details a.permalink[href*='/observations/']"
    );
    if (!permalink) return null;

    const href = permalink.getAttribute("href") || "";
    const match = href.match(/\/observations\/(\d+)(?:\/|$|[?#])/);
    const detailsList = modal.querySelector(".map-and-details .details > ul");
    if (!match || !detailsList) return null;

    return { observationId: match[1], detailsList };
  }

  function injectIdentifyView() {
    const context = identifyModalContext();
    const oldControl = document.getElementById(IDENTIFY_ROOT_ID);

    if (!context) {
      if (oldControl) oldControl.remove();
      currentIdentifyObservationId = null;
      return;
    }

    const { observationId, detailsList } = context;
    if (observationId !== currentIdentifyObservationId) {
      if (oldControl) oldControl.remove();
      currentIdentifyObservationId = observationId;
    }

    const existing = document.getElementById(IDENTIFY_ROOT_ID);
    if (existing && existing.dataset.observationId === observationId) return;

    const control = makeControl(observationId, { identifyView: true });
    const accuracyIcon = detailsList.querySelector(":scope > li > .fa-circle-o.bullet-icon");
    const locationIcon = detailsList.querySelector(":scope > li > .fa-map-marker.bullet-icon");
    const precedingRow = accuracyIcon?.closest("li") || locationIcon?.closest("li");

    if (precedingRow) {
      precedingRow.after(control);
    } else {
      detailsList.append(control);
    }
    lookUpElevation(control, observationId);
  }

  function inject() {
    injectObservationPage();
    injectIdentifyView();
  }

  function scheduleInjection() {
    window.clearTimeout(injectionTimer);
    injectionTimer = window.setTimeout(inject, 100);
  }

  function start() {
    const observer = new MutationObserver(scheduleInjection);
    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["href"]
    });
    window.addEventListener("popstate", scheduleInjection);
    window.setInterval(inject, 1000);

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync") return;
      if (changes.elevationUnit) {
        preferredUnit = resolveElevationUnit(changes.elevationUnit.newValue);
      }
      const privacyChanged = changes.allowPrivateCoordinates
        && (changes.allowPrivateCoordinates.newValue === undefined
          || changes.allowPrivateCoordinates.newValue === true) !== allowPrivateCoordinates;
      if (privacyChanged) {
        allowPrivateCoordinates = changes.allowPrivateCoordinates.newValue === undefined
          || changes.allowPrivateCoordinates.newValue === true;
      }
      const sourceChanged = Boolean(changes.elevationSource)
        && resolveElevationSource(changes.elevationSource.newValue) !== elevationSource;
      if (sourceChanged) {
        elevationSource = resolveElevationSource(changes.elevationSource.newValue);
      }
      const invalidateCache = privacyChanged || sourceChanged;
      if (invalidateCache) {
        settingsGeneration += 1;
        resultCache.clear();
        pendingLookups.clear();
      }
      for (const id of [ROOT_ID, IDENTIFY_ROOT_ID]) {
        const root = document.getElementById(id);
        if (!root) continue;
        const observationId = root.dataset.observationId;
        if (invalidateCache) lookUpElevation(root, observationId);
        else if (resultCache.has(observationId)) renderCachedResult(root, resultCache.get(observationId));
      }
    });

    inject();
  }

  window.addEventListener("inat-elevation:observations", event => {
    const observations = event?.detail?.observations;
    if (!Array.isArray(observations)) return;
    for (const observation of observations) recordInterceptedObservation(observation);
  });
  window.dispatchEvent(new window.CustomEvent("inat-elevation:ready"));

  chrome.storage.sync.get({
    elevationUnit: "auto",
    allowPrivateCoordinates: true,
    elevationSource: DEFAULT_ELEVATION_SOURCE
  }, settings => {
    if (!chrome.runtime.lastError) {
      preferredUnit = resolveElevationUnit(settings.elevationUnit);
      allowPrivateCoordinates = settings.allowPrivateCoordinates === true;
      elevationSource = resolveElevationSource(settings.elevationSource);
    }
    start();
  });
})();
