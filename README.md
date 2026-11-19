# iNaturalist Elevation

Automatically adds terrain elevation to iNaturalist observation pages and the Identify view, including supported regional sites. Units follow your browser locale, with a manual meters/feet option. No API key required.

## Install

1. Download the [extension ZIP](https://github.com/armenenikolopov/inaturalist-elevation/archive/refs/heads/main.zip) and unzip it.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Select **Load unpacked** and choose the folder containing `manifest.json`.
4. Refresh iNaturalist. Elevation appears automatically beside the location.

To update, replace the installed files, click **Reload** in `chrome://extensions`, and refresh iNaturalist.

## Settings and privacy

Open **Details → Extension options** in `chrome://extensions`. **Automatic** is the default: feet for US browser locales, meters elsewhere. This uses your browser's regional setting, not your physical location. Saved manual choices are preserved.

Lookups default to **OpenTopoData** (with automatic fallback to Mapterhorn tiles) and can be switched to **Mapterhorn tiles** (decoded locally in your browser without sending exact coordinates) or **Open-Meteo** in Extension options. By default, account-visible exact coordinates are used when available; check **Hide exact coordinates…** to use public coordinates only for obscured/private geoprivacy. `≈` marks obscured public locations. Existing saved preferences are preserved. No analytics or developer-operated server. [Privacy policy](PRIVACY.md).

## Data

- **[OpenTopoData](https://www.opentopodata.org/)** (default): queries `ned10m` (USGS 10 m), `eudem25m` (EU-DEM 25 m), `nzdem8m` (LINZ 8 m), and `mapzen` (~30 m + bathymetry).
- **[Mapterhorn](https://mapterhorn.com/attribution)**: WebP Terrarium terrain tiles combining Copernicus GLO-30 (~30 m) and national open LiDAR DTMs (1–10 m), decoded locally in the browser (`© Mapterhorn`).
- **[Open-Meteo](https://open-meteo.com/en/docs/elevation-api)**: Copernicus DEM 2021 GLO-90 (~90 m resolution), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (non-commercial free API).

Values estimate terrain elevation; obscured coordinates can yield very different elevations.

## Development

Node.js 22.13+: `npm ci`, then `npm test`. No runtime dependencies.

`npm run package` creates two ZIPs in `dist/`: `chrome-web-store` for upload or local installation after unzipping, and `source` for development. See [testing](docs/TESTING.md) and [release notes](docs/RELEASE.md).

Created by [Armen Enikolopov](https://github.com/armenenikolopov).

[Report an issue](https://github.com/armenenikolopov/inaturalist-elevation/issues) · [MIT license](LICENSE) · Independent project, not affiliated with iNaturalist.
