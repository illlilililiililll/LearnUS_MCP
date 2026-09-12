# LearnUs request performance

M8 adds internal request metrics, a process-wide data-request concurrency limit, identical-request coalescing, and short normalized-result TTL caches. Authentication navigation and probes are outside the data limiter. Metrics are available only from `LearnUsClient.performanceMetrics()` for tests and benchmarks; MCP responses and normal logs do not include them.

`LEARNUS_MAX_CONCURRENT_REQUESTS` defaults to `4` and accepts integers from 1 through 32. Invalid values fall back to 4. `LEARNUS_CACHE_ENABLED=0` disables the new general TTL cache while retaining request coalescing, the limiter, timetable disk cache, and existing feature-specific caches.

## Synthetic benchmark

Run `npm run benchmark:performance`. The fixture contains only synthetic labels and IDs. These September 2026 measurements are local process timings, so request counts are the stable comparison and elapsed time is diagnostic only.

| Scenario | Baseline requests | Optimized requests | Cache hits | Coalesced | Baseline / optimized elapsed |
| --- | ---: | ---: | ---: | ---: | ---: |
| overview cold | 4 | 4 | 0 | 2 | 40.06 / 5.86 ms |
| overview warm | 4 | 0 | 5 | 0 | 13.33 / 0.46 ms |
| get course twice | 2 | 1 | 1 | 0 | 1.91 / 1.75 ms |
| concurrent get course ×3 | 1 | 1 | 0 | 2 | 1.68 / 1.14 ms |

The baseline uses the same orchestration with the general TTL cache disabled. Both modes retain identical in-flight request coalescing, matching the pre-M8 behavior for concurrent dashboard/course reads.

## Cache boundaries

Only normalized successful results are cached: course lists for 30 seconds, course details for 30 seconds, assignments for 25 seconds, upcoming events for 15 seconds, announcement lists for 20 seconds, and notifications for 7 seconds. Results containing parser or endpoint warnings are not stored as normal cache hits. Authentication HTML, raw HTTP bodies, failures, downloads, and announcement details are not TTL-cached.

The existing course/video context, completion, and file-list caches remain feature-specific because they support existing `refresh` behavior and longer feature TTLs. The timetable cache remains the only disk cache. Every general entry and in-flight request includes the authenticated session generation, so a reauthentication cannot reuse data from an older session.

The remaining latency is cold-page parsing plus endpoints that must paginate or scan multiple courses. Possible M9 payload work should first benchmark summary-field selection for overview assignments, calendar events, and notifications; no external relational response change is justified by the M8 request-count results alone.
