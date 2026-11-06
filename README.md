# iNaturalist Elevation

Automatically adds terrain elevation to iNaturalist observation pages and the Identify view, including supported regional sites. Meters by default, with a feet option. No API key required.

## Install

1. Download the [extension ZIP](https://github.com/armenenikolopov/inaturalist-elevation/archive/refs/heads/main.zip) and unzip it.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Select **Load unpacked** and choose the folder containing `manifest.json`.
4. Refresh iNaturalist. Elevation appears automatically beside the location.

To update, replace the installed files, click **Reload** in `chrome://extensions`, and refresh iNaturalist.

## Settings and privacy

Open **Details → Extension options** in `chrome://extensions` to choose meters or feet.

Lookups send coordinates to Open-Meteo, using exact coordinates visible to your account by default. Check **Hide exact coordinates…** to use public coordinates only for obscured/private geoprivacy. `≈` marks obscured public locations. Existing saved preferences are preserved. No analytics or developer-operated server. [Privacy policy](PRIVACY.md).

## Data

[Open-Meteo](https://open-meteo.com/en/docs/elevation-api), using Copernicus DEM 2021 GLO-90 (~90 m resolution), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Values estimate terrain elevation; obscured coordinates can yield very different elevations. The free API is for [non-commercial use](https://open-meteo.com/en/terms).

## Development

Node.js 22.13+: `npm ci`, then `npm test`. Run `npm run package` for Web Store, unpacked, and source ZIPs in `dist/`. No runtime dependencies. See [testing](TESTING.md) and [release notes](RELEASE.md).

[Report an issue](https://github.com/armenenikolopov/inaturalist-elevation/issues) · [MIT license](LICENSE) · Independent project, not affiliated with iNaturalist.
