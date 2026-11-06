# Chrome smoke test — 1.5.0

Completed November 6, 2026 in the user's actual Google Chrome session on Mac. The enabled unpacked extension reported version 1.5.0 and was loaded from this project folder.

| Check | Observed result |
| --- | --- |
| Normal observation `/observations/412925717` | Automatically displayed 1,907 m beside the location; typography and information-icon alignment looked balanced. |
| Information button | Opened the extension options with attribution and privacy controls. |
| Meters → feet | Changing options updated the already-open observation to 6,257 ft without reloading. |
| Colombia domain, same observation | Automatically displayed the matching 6,257 ft result while signed out on the regional site. |
| Identify Info panel | Displayed the elevation below accuracy. |
| Forward navigation | Replaced the previous result appropriately across multiple records; observation `412578224` displayed 13,419 ft. |
| Missing/private location | Observation `412925462` showed “unavailable” with the explanation “This observation has no public coordinates.” |
| Backward navigation | Returning to `412925717` restored its cached 6,257 ft result. |
| Restore meters | Both normal and Identify views returned to 1,907 m. |
| Console | No errors were returned by the browser's captured Identify console-error log at the final check. This is not a complete service-worker network audit. |

The initial preferences were meters and exact-coordinate opt-in enabled. Public-coordinate mode was used during testing, then both original preferences were restored. Temporary viewport changes were reset. No IDs, comments, favorites, or reviewed flags were submitted.

The existing 15 automated tests additionally cover obscured-coordinate approximation, simultaneous lookups, malformed responses, timeouts, and disabling precise-coordinate access during a pending lookup. Those edge cases were not all separately reproduced in live Chrome.

## Screenshots

Actual browser captures, with no content edits:

- [Normal page — 1280×800, suitable for the store listing](../screenshots/observation.jpg)
- [Identify — 1390×762](../screenshots/identify.jpg)

The page photograph belongs to Iván Lau, as credited on the [source observation](https://www.inaturalist.org/observations/412925717); its linked photo license is CC BY-NC 4.0. These screenshots are not extension runtime assets.
