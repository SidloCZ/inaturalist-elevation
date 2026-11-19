"use strict";

const {
  DEFAULT_ELEVATION_SOURCE,
  DEFAULT_UNCERTAINTY_MODE,
  DEFAULT_ACCURACY_THRESHOLD,
  resolveElevationSource,
  resolveUncertaintyMode,
  resolveAccuracyThreshold,
  resolveElevationUnit,
  getExtensionAPI,
  invokeExtensionMethod
} = iNaturalistElevation;
const ext = getExtensionAPI();
const unitSelect = document.getElementById("elevation-unit");
const sourceSelect = document.getElementById("elevation-source");
const uncertaintyModeSelect = document.getElementById("uncertainty-mode");
const thresholdSelect = document.getElementById("accuracy-threshold");
const hideExactCoordinates = document.getElementById("hide-exact-coordinates");
const saveStatus = document.getElementById("save-status");
let statusTimer;

const automaticUnit = resolveElevationUnit("auto");
unitSelect.querySelector('[value="auto"]').textContent = `Automatic (${automaticUnit === "feet" ? "ft" : "m"})`;

invokeExtensionMethod(
  ext?.storage?.sync,
  "get",
  [{
    elevationUnit: "auto",
    allowPrivateCoordinates: true,
    elevationSource: DEFAULT_ELEVATION_SOURCE,
    uncertaintyMode: DEFAULT_UNCERTAINTY_MODE,
    accuracyThresholdMeters: DEFAULT_ACCURACY_THRESHOLD
  }],
  settings => {
    unitSelect.value = ["auto", "meters", "feet"].includes(settings.elevationUnit) ? settings.elevationUnit : "auto";
    sourceSelect.value = resolveElevationSource(settings.elevationSource);
    uncertaintyModeSelect.value = resolveUncertaintyMode(settings.uncertaintyMode);
    const resolvedThreshold = String(resolveAccuracyThreshold(settings.accuracyThresholdMeters));
    const hasOption = Array.from(thresholdSelect.options).some(option => option.value === resolvedThreshold);
    thresholdSelect.value = hasOption ? resolvedThreshold : String(DEFAULT_ACCURACY_THRESHOLD);
    hideExactCoordinates.checked = settings.allowPrivateCoordinates !== true;
  },
  () => {
    saveStatus.textContent = "Could not load settings. Reopen options to try again.";
  }
);

function saveSetting(settings) {
  invokeExtensionMethod(
    ext?.storage?.sync,
    "set",
    [settings],
    () => {
      window.clearTimeout(statusTimer);
      saveStatus.textContent = "Saved";
      statusTimer = window.setTimeout(() => {
        saveStatus.textContent = "";
      }, 1500);
    },
    () => {
      window.clearTimeout(statusTimer);
      saveStatus.textContent = "Could not save.";
      statusTimer = window.setTimeout(() => {
        saveStatus.textContent = "";
      }, 1500);
    }
  );
}

unitSelect.addEventListener("change", () => {
  saveSetting({ elevationUnit: ["meters", "feet"].includes(unitSelect.value) ? unitSelect.value : "auto" });
});

sourceSelect.addEventListener("change", () => {
  saveSetting({ elevationSource: resolveElevationSource(sourceSelect.value) });
});

uncertaintyModeSelect.addEventListener("change", () => {
  saveSetting({ uncertaintyMode: resolveUncertaintyMode(uncertaintyModeSelect.value) });
});

thresholdSelect.addEventListener("change", () => {
  saveSetting({ accuracyThresholdMeters: resolveAccuracyThreshold(thresholdSelect.value) });
});

hideExactCoordinates.addEventListener("change", () => {
  // Keep the existing stored preference so upgrades preserve each user's choice.
  saveSetting({ allowPrivateCoordinates: !hideExactCoordinates.checked });
});
