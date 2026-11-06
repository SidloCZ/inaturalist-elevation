# Testing

Run `npm ci` and `npm test` with Node.js 22.13 or newer. Tests use mocked services and a DOM environment; they need no iNaturalist account or live network connection.

Latest pre-publication run: **68 tests passed**, November 6, 2026.

## Coverage

- All 22 listed iNaturalist Network sites: manifest matching and automatic display on both observation and Identify pages. The registry snapshot and its source URL are in `tests/fixtures/network-sites.json`.
- Separate domains include Canada, New Zealand, Portugal, Australia, Argentina, Chile, Finland, Sweden, Luxembourg, and Uruguay, alongside country subdomains of inaturalist.org.
- Permission boundaries reject unrelated sites, lookalike domains, HTTP, and unrelated iNaturalist pages.
- Regional account-coordinate requests use the current site's relative JSON route and fall back to public coordinates if signed out.
- Identify forward/back navigation, late responses, simultaneous page/modal requests, repeated observations, missing accuracy rows, and replacement of the location DOM by React.
- Switching units while a request is pending, saved preferences, the inverted geoprivacy checkbox, and failed storage reads/writes.
- Public/obscured/private coordinates, empty and invalid values, zero coordinates/elevations, below-sea-level elevation, malformed JSON, API failures, timeouts, and disabling exact-coordinate sharing while a lookup is pending.

## Live checks — November 6, 2026

Version 1.5.0 passed the real Chrome checks recorded in [SMOKE-TEST.md](SMOKE-TEST.md): main and Colombia observation pages, Identify navigation, meters/feet, information button, and a private observation with no public coordinates. Version 1.6.0's simplified options UI was separately verified in Chrome.

Additional 1.6.0 browser checks attempted the following regional observation URLs using the same public observation ID (`412925717`) so results could be compared directly:

| Site | Result |
| --- | --- |
| www.inaturalist.ca | Blocked at Cloudflare browser verification |
| www.inaturalist.nz | Blocked at Cloudflare browser verification |
| www.biodiversity4all.org | Blocked at Cloudflare browser verification |
| inaturalist.ala.org.au | Blocked at Cloudflare browser verification |

These are incomplete live checks, not passing extension checks. No CAPTCHA or site security check was bypassed. The automated site matrix verifies URLs and extension behavior against representative markup; it does not certify that every live site's markup or availability is unchanged.

## Release packaging

`npm run package` creates and checks two ZIPs in `dist/`: `chrome-web-store` for upload or local installation after unzipping, and `source` for development. The installable ZIP has `manifest.json` at its root and contains only extension files, the license, and privacy policy. The source ZIP also contains the lockfile, tests, scripts, documentation, and screenshots; it excludes `node_modules`, `.git`, and temporary files.
