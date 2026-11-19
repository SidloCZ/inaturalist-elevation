"use strict";

(() => {
  if (window.__inatElevationInterceptorInstalled) return;
  window.__inatElevationInterceptorInstalled = true;

  const OBSERVATIONS_URL_RE = /^https:\/\/api\.inaturalist\.org\/v[12]\/observations(?:\/|$|\?)/;
  const MAX_BUFFER = 200;
  const buffer = new Map();

  function hasPrivateFields(record) {
    return Boolean(record && (record.private_geojson || record.private_latitude != null));
  }

  function pickObservationFields(obs, authenticated) {
    if (!obs || typeof obs !== "object") return null;
    const id = obs.id == null ? null : String(obs.id);
    if (!id || !/^[1-9]\d*$/.test(id)) return null;

    const record = { id: Number(id), authenticated: Boolean(authenticated) };
    const fields = [
      "geojson",
      "private_geojson",
      "latitude",
      "longitude",
      "private_latitude",
      "private_longitude",
      "location",
      "obscured",
      "geoprivacy",
      "positional_accuracy",
      "public_positional_accuracy",
      "private_positional_accuracy"
    ];
    for (const field of fields) {
      if (obs[field] !== undefined) record[field] = obs[field];
    }
    return record;
  }

  function storeRecord(record) {
    const key = String(record.id);
    const existing = buffer.get(key);
    const existingRich = Boolean(existing && (existing.authenticated || hasPrivateFields(existing)));
    const nextRich = record.authenticated || hasPrivateFields(record);
    if (existing && existingRich && !nextRich) return existing;

    if (buffer.has(key)) buffer.delete(key);
    buffer.set(key, record);
    if (buffer.size > MAX_BUFFER) {
      buffer.delete(buffer.keys().next().value);
    }
    return record;
  }

  function emitObservations(observations, batch) {
    if (!observations.length) return;
    try {
      window.dispatchEvent(new window.CustomEvent("inat-elevation:observations", {
        detail: { observations, batch: Boolean(batch) }
      }));
    } catch (_error) {
      // Never break page scripts if event dispatch fails.
    }
  }

  function handlePayload(payload, authenticated) {
    if (!payload || typeof payload !== "object") return;
    const rawList = Array.isArray(payload.results)
      ? payload.results
      : (payload.id != null ? [payload] : []);
    if (!rawList.length) return;

    const records = [];
    for (const obs of rawList) {
      const picked = pickObservationFields(obs, authenticated);
      if (picked) records.push(storeRecord(picked));
    }
    if (records.length) {
      emitObservations(records, Array.isArray(payload.results) && records.length > 1);
    }
  }

  function resolveUrl(input) {
    try {
      const raw = typeof input === "string" ? input : input?.url;
      if (!raw) return "";
      return new URL(raw, window.location.href).href;
    } catch (_error) {
      return "";
    }
  }

  function hasAuthorizationHeader(headers) {
    if (!headers) return false;
    try {
      if (typeof headers.get === "function") {
        return Boolean(headers.get("authorization"));
      }
      if (Array.isArray(headers)) {
        return headers.some(pair => Array.isArray(pair) && String(pair[0]).toLowerCase() === "authorization" && Boolean(pair[1]));
      }
      if (typeof headers === "object") {
        return Object.keys(headers).some(key => key.toLowerCase() === "authorization" && Boolean(headers[key]));
      }
    } catch (_error) {
      return false;
    }
    return false;
  }

  if (typeof window.fetch === "function") {
    const originalFetch = window.fetch;
    window.fetch = function wrappedFetch(input, init) {
      const url = resolveUrl(input);
      const shouldInspect = OBSERVATIONS_URL_RE.test(url);
      const authenticated = shouldInspect && (
        hasAuthorizationHeader(init?.headers) || hasAuthorizationHeader(input?.headers)
      );
      const resultPromise = originalFetch.apply(this, arguments);
      if (!shouldInspect) return resultPromise;

      Promise.resolve(resultPromise)
        .then(response => {
          if (!response || !response.ok || typeof response.clone !== "function") return null;
          return response.clone().json();
        })
        .then(data => {
          if (data) handlePayload(data, authenticated);
        })
        .catch(() => {});

      return resultPromise;
    };
  }

  if (typeof window.XMLHttpRequest === "function" && window.XMLHttpRequest.prototype) {
    const xhrProto = window.XMLHttpRequest.prototype;
    const xhrMeta = new WeakMap();
    const originalOpen = xhrProto.open;
    const originalSetHeader = xhrProto.setRequestHeader;
    const originalSend = xhrProto.send;

    xhrProto.open = function wrappedOpen(method, url) {
      try {
        xhrMeta.set(this, { url: resolveUrl(url), authenticated: false });
      } catch (_error) {
        // Ignore invalid XHR metadata.
      }
      return originalOpen.apply(this, arguments);
    };

    if (typeof originalSetHeader === "function") {
      xhrProto.setRequestHeader = function wrappedSetRequestHeader(name, value) {
        try {
          if (String(name).toLowerCase() === "authorization" && value) {
            const meta = xhrMeta.get(this) || { url: "", authenticated: false };
            meta.authenticated = true;
            xhrMeta.set(this, meta);
          }
        } catch (_error) {
          // Ignore header inspection errors.
        }
        return originalSetHeader.apply(this, arguments);
      };
    }

    xhrProto.send = function wrappedSend() {
      const meta = xhrMeta.get(this);
      if (meta && OBSERVATIONS_URL_RE.test(meta.url)) {
        this.addEventListener("load", () => {
          try {
            if (this.status < 200 || this.status >= 300) return;
            if (this.responseType && this.responseType !== "text" && this.responseType !== "json") return;
            const data = this.responseType === "json"
              ? this.response
              : JSON.parse(this.responseText);
            if (data) handlePayload(data, meta.authenticated);
          } catch (_error) {
            // Ignore non-JSON or inaccessible responses.
          }
        }, { once: true });
      }
      return originalSend.apply(this, arguments);
    };
  }

  window.addEventListener("inat-elevation:ready", () => {
    if (!buffer.size) return;
    const records = Array.from(buffer.values());
    emitObservations(records, records.length > 1);
  });
})();
