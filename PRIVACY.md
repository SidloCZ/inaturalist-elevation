# Privacy

Updated November 6, 2026. Applies to iNaturalist Elevation 1.6.0.

## Data used

For an observation page or an observation opened in Identify, the extension sends latitude and longitude to Open-Meteo to retrieve terrain elevation. On a new installation, the extension uses exact coordinates visible to your iNaturalist account when available, including coordinates for observations with obscured/private geoprivacy. It requests the observation's JSON from the current iNaturalist site using your existing signed-in session. Authentication cookies are used only by this same-origin iNaturalist request and are never sent to Open-Meteo or the developer.

To use public coordinates only, check **Hide exact coordinates from Open-Meteo for observations with obscured/private geoprivacy** in Extension options. When checked, the extension sends the observation ID to the public iNaturalist API and sends only the returned public coordinates to Open-Meteo. The public API is also used when the account-specific coordinates cannot be retrieved. Obscured public coordinates may be shifted away from the true location; the result is marked `≈`. Observations with no available coordinates show “unavailable.”

The checkbox is unchecked by default on new installations. Existing saved preferences are preserved when updating. You can change this preference at any time; requests already sent cannot be recalled.

## Data not collected

The developer operates no server and receives no observation data. There is no analytics, advertising, sale of data, or background tracking. The extension reads only the observation identifier and coordinates needed for its elevation feature; it does not transmit photos, usernames, comments, passwords, or unrelated browsing activity.

The unit and precise-coordinate preferences are saved through Chrome's synchronized extension storage and may sync to your other Chrome devices. Up to 200 elevation results are cached in page memory and discarded on reload or when the coordinate preference changes. Coordinates are not saved to persistent extension storage.

## When requests occur

Lookups occur automatically for displayed observations, including when you move between observations in Identify. Cached results are reused within a page session; changing units does not require another request. Disable or remove the extension in `chrome://extensions` to stop future lookups.

## External services

- [iNaturalist](https://www.inaturalist.org/pages/privacy) — observation coordinates.
- [Open-Meteo Elevation API](https://open-meteo.com/en/docs/elevation-api) — terrain elevation lookup.

These services receive your IP address and process requests under their own policies. Open-Meteo's [privacy policy](https://open-meteo.com/en/terms#privacy) says its API logs may contain coordinates and are deleted after 90 days. The extension omits cookies and page referrers from these external API requests.

Data is used and transferred solely to provide the elevation feature, consistent with the Chrome Web Store User Data Policy, including its Limited Use requirements. Contact the maintainer through [GitHub Issues](https://github.com/armenenikolopov/inaturalist-elevation/issues); do not include private coordinates in public reports.
