"use strict";

const { DEFAULT_ELEVATION_SOURCE, resolveElevationSource, resolveElevationUnit } = iNaturalistElevation;
const unitSelect = document.getElementById("elevation-unit");
const sourceSelect = document.getElementById("elevation-source");
const hideExactCoordinates = document.getElementById("hide-exact-coordinates");
const saveStatus = document.getElementById("save-status");
let statusTimer;

const automaticUnit = resolveElevationUnit("auto");
unitSelect.querySelector('[value="auto"]').textContent = `Automatic (${automaticUnit === "feet" ? "ft" : "m"})`;

chrome.storage.sync.get({
  elevationUnit: "auto",
  allowPrivateCoordinates: true,
  elevationSource: DEFAULT_ELEVATION_SOURCE
}, settings => {
  if (chrome.runtime.lastError) {
    saveStatus.textContent = "Could not load settings. Reopen options to try again.";
    return;
  }
  unitSelect.value = ["auto", "meters", "feet"].includes(settings.elevationUnit) ? settings.elevationUnit : "auto";
  sourceSelect.value = resolveElevationSource(settings.elevationSource);
  hideExactCoordinates.checked = settings.allowPrivateCoordinates !== true;
});

function saveSetting(settings) {
  chrome.storage.sync.set(settings, () => {
    window.clearTimeout(statusTimer);
    saveStatus.textContent = chrome.runtime.lastError ? "Could not save." : "Saved";
    statusTimer = window.setTimeout(() => {
      saveStatus.textContent = "";
    }, 1500);
  });
}

unitSelect.addEventListener("change", () => {
  saveSetting({ elevationUnit: ["meters", "feet"].includes(unitSelect.value) ? unitSelect.value : "auto" });
});

sourceSelect.addEventListener("change", () => {
  saveSetting({ elevationSource: resolveElevationSource(sourceSelect.value) });
});

hideExactCoordinates.addEventListener("change", () => {
  // Keep the existing stored preference so upgrades preserve each user's choice.
  saveSetting({ allowPrivateCoordinates: !hideExactCoordinates.checked });
});
