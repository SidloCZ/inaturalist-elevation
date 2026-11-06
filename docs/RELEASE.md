# Release 1.6.0

## Changes

- Replaced the coordinate heading and explanatory paragraphs with one checkbox: “Hide exact coordinates from Open-Meteo for observations with obscured/private geoprivacy.”
- New installations use account-visible exact coordinates by default. Checking the box uses public coordinates only. Existing saved choices are preserved.
- Updated privacy disclosures and added regression coverage for the reversed checkbox and the new default.

## Earlier improvements (1.5.0)

- Fixed conflicting lookups between observation pages and Identify modals, stale results during navigation, and duplicate requests for the same observation.
- Preserved obscured-location warnings, validated coordinates and API responses, added 12-second request timeouts, and bounded page-memory caching.
- Defaulted to public coordinates. Account-visible exact coordinates now require explicit opt-in, with a disclosure in options.
- Added original extension icons, meaningful regression tests, CI, and separate Web Store, unpacked, and source packages. Shortened the README.

## Build

Use Node.js 22.13 or newer:

```sh
npm ci
npm test
npm run icons
npm run package
```

The `chrome-web-store` ZIP has `manifest.json` at its root. Upload it to the Web Store, or unzip it and select its folder with Chrome's **Load unpacked** command. It contains only the extension, license, and privacy policy. The source ZIP includes the development files and documentation, but no `node_modules`.

## Chrome Web Store listing draft

**Name:** iNaturalist Elevation

**Summary:** Automatically shows terrain elevation on iNaturalist observation pages and in Identify.

**Description:**

See terrain elevation automatically beside observation locations on iNaturalist, including the Identify view and supported regional sites. Choose meters or feet in Extension options; meters are the default. No API key required.

Observation coordinates are sent to Open-Meteo to look up elevation. New installations use exact coordinates visible to your signed-in iNaturalist account by default, including coordinates for observations with obscured/private geoprivacy. Check “Hide exact coordinates from Open-Meteo for observations with obscured/private geoprivacy” in Extension options to use public coordinates only. Existing saved preferences are preserved. Obscured public locations are marked approximate. No analytics, advertising, or developer-operated server.

Elevation comes from Open-Meteo and the Copernicus DEM 2021 GLO-90 dataset (~90 m resolution), under CC BY 4.0. Terrain estimates are not survey measurements. Free API access is for non-commercial use and is subject to service availability and rate limits.

Independent open-source project, not affiliated with iNaturalist.

**Language:** English

**Homepage:** https://github.com/armenenikolopov/inaturalist-elevation

**Support:** https://github.com/armenenikolopov/inaturalist-elevation/issues

**Privacy policy:** https://github.com/armenenikolopov/inaturalist-elevation/blob/main/PRIVACY.md

## Privacy practices and permissions

Single purpose: display terrain elevation for the observation the user is viewing.

- `storage`: saves the unit and coordinate-sharing preferences through Chrome sync.
- iNaturalist observation-page access: reads the displayed observation ID and inserts the elevation. Regional domains use the same observation and Identify interfaces.
- `api.inaturalist.org`: retrieves public coordinates for the displayed observation.
- `api.open-meteo.com`: sends coordinates and retrieves elevation.
- No remote executable code, geolocation permission, broad browsing-history access, analytics, or advertising.

Disclose **Location** in the dashboard because observation coordinates are transmitted. Explain that these are observation locations, not the device's live location. Observation IDs are sent only to iNaturalist; coordinates only to Open-Meteo. Do not claim that no data is transmitted. Certify only statements that agree with PRIVACY.md and the actual package.

## Before submitting

Version 1.6.0 has an expanded automated suite covering all 22 network sites on observation and Identify pages, permission boundaries, the new default, reversed checkbox, saved preferences, settings failures, and pending lookups. See TESTING.md for the current results and live-browser limitations. The simplified options layout was also checked in Chrome after reloading version 1.6.0; an existing public-only preference correctly appeared as a checked “Hide exact coordinates…” box and was preserved. The earlier full Chrome smoke-test report covers version 1.5.0.

Obscured-coordinate approximation and changing the exact-coordinate preference during pending requests are covered by the automated tests; those cases were not separately exercised in the live browser.

- Verify the homepage, support, and privacy URLs work publicly before using them in the store listing.
- Use [the observation screenshot](../screenshots/observation.jpg) as the 1280×800 store screenshot and `icons/icon-128.png` as the store icon. The Identify screenshot is a separate demonstration at the browser's original viewport size.
- Upload the `chrome-web-store` ZIP, complete the listing and privacy fields, then submit for review.

Store instructions: [package preparation](https://developer.chrome.com/docs/webstore/prepare), [listing assets](https://developer.chrome.com/docs/webstore/cws-dashboard-listing), [data disclosures](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements).

Service constraints: [Open-Meteo elevation attribution](https://open-meteo.com/en/docs/elevation-api), [free non-commercial API terms and quotas](https://open-meteo.com/en/terms). If usage grows or the project is monetized, arrange appropriate API access.
