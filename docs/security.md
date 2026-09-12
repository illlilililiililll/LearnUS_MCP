# Security and limitations

Credentials come from the local process environment, never MCP arguments. Yonsei's real page handles SSO encryption; CAPTCHA/MFA is not bypassed.
Cookies/sesskey remain in memory; no storageState export is used. stdout is MCP-only. Runtime failures use fixed codes rather than raw Playwright errors, page dialogs or bodies.

LearnUs requests are read-only: no submissions, quiz starts, notification read/delete, playback or progress update endpoint.
Download writes locally and has readOnlyHint=false. It requires a registered fileId, validates every redirect before obtaining cookies, restricts origin/path, sanitizes names, checks containment/symlink descendants, limits declared and streamed bytes, cleans partial files and publishes without overwriting.

HAR/authenticated HTML/downloads/private caches must not be committed. Fixtures are synthetic. Optional recorded research checks read ignored local data and report structural booleans.
Pattern-based secret checks cannot prove every arbitrary string harmless; review prospective staged files before publication.

Stable errors: CREDENTIALS_MISSING, AUTH_FAILED, AUTH_CHALLENGE_REQUIRED, SESSION_EXPIRED, NETWORK_ERROR, PARSE_ERROR, ENDPOINT_UNAVAILABLE, DOWNLOAD_TOO_LARGE.
NETWORK_ERROR covers ordinary network/data timeout failures. Empty results and parser mismatches have distinct warning codes.

Data requests have 30-second timeouts; SSO has bounded page/login stages. Download uses a 30-second socket inactivity timeout, not a total-transfer deadline.
Shutdown handles EOF/SIGINT/SIGTERM with a ten-second cleanup ceiling. Windows signals can terminate at OS level; EOF tests graceful shutdown there.

## Known limitations

Theme/HTML changes may require parser updates. Unknown modules remain discoverable where canonical identity exists. Unsupported completion DOM remains unknown.
Missing evidence is not an obligation, confirmed deadline or absence. Equal-tier deadline conflicts remain unresolved with warnings. Availability dates are separate from attendance deadlines.

Only observed file adapters are enabled; resource/folder may require more research. Timetable storage exists but no live endpoint is connected.
Some older integration tests require nonempty entities. Live tests are opt-in and CI requires no secrets.
Host routing is model-controlled. No structuredContent migration, remote transport or new write capability is included.

If sensitive material was ever committed, stop publishing and review credential rotation/history cleanup with the owner. Do not automatically rewrite history.
