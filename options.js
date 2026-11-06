"use strict";

const unitSelect = document.getElementById("elevation-unit");
const hideExactCoordinates = document.getElementById("hide-exact-coordinates");
const saveStatus = document.getElementById("save-status");
let statusTimer;

chrome.storage.sync.get({ elevationUnit: "meters", allowPrivateCoordinates: true }, settings => {
  if (chrome.runtime.lastError) {
    saveStatus.textContent = "Could not load settings. Reopen options to try again.";
    return;
  }
  unitSelect.value = settings.elevationUnit === "feet" ? "feet" : "meters";
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
  saveSetting({ elevationUnit: unitSelect.value === "feet" ? "feet" : "meters" });
});

hideExactCoordinates.addEventListener("change", () => {
  // Keep the existing stored preference so upgrades preserve each user's choice.
  saveSetting({ allowPrivateCoordinates: !hideExactCoordinates.checked });
});
