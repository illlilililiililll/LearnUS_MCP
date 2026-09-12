# Architecture

MCP Tools → LearnUsClient orchestration → authenticated request wrapper → limiter/cache/coalescing → Moodle AJAX, Coursemos and HTML adapters.

Credentials enter through CredentialProvider. PlaywrightAuthManager runs the real SSO page, shares one authentication flight and retains BrowserContext/session state in memory. Identified session expiry triggers one reauthentication and one original-request retry.

Parsers normalize text, URLs and dates. Identities are course IDs, activity cmids, event IDs and module/article pairs. Notification fallback identity is a deterministic composite. Titles are not video/report/calendar join keys. Unknown fields remain optional or produce stable warnings.

Overview composes client methods with bounded parallel work. Weekly tasks delegates with learning enabled. Both preserve informational/completed/unknown distinctions. Public MCP text JSON excludes internal diagnostics and evidence arrays, retained internally for decisions/tests.

Cache values are normalized objects, scoped to session generation. No database or remote transport exists. TimetableCache stores normalized semester data; a live endpoint adapter is not connected.

## Weekly cold request fan-out

The synthetic default overview makes five requests: dashboard GET, calendar POST, course GET shared by announcement/assignment discovery, board GET and assignment GET.
Learning adds a course context GET (a separate feature cache loader) and completion report GET.
The report supplies actual progress/attendance. The repeated course GET could be shared in a future measured refactor; it reflects existing cache boundaries rather than an extra authentication probe.
M10 preserves the 7-request baseline and does not redesign M8 caches. Warm calls make zero requests.

Concurrent three-call request/coalesced/peak counts: course 1/2/1, overview 5/12/2, weekly 7/12/2.
These are synthetic measurements, not real-account throughput guarantees.
