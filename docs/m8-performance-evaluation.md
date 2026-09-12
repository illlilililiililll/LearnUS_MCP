# M8 Performance Evaluation

## Environment

- Runtime: Node v22.19.0, win32/x64
- Transport: MCP SDK client → spawned stdio server → production `createServer` Tool handlers
- Synthetic evaluation: RUN
- Integration evaluation: NOT RUN
- Download evaluation: excluded because `learnus_download_file` creates a local file
- Auth login/probe requests are excluded from M8 data-request counters. Integration startup authenticates before timed calls.

## Methodology

Each cold measurement clears normalized in-memory caches but retains the authenticated process session. Each warm measurement repeats the same Tool and arguments. Elapsed time covers the MCP `tools/call` round trip. `responseBytes` is the UTF-8 size of the serialized MCP Tool response envelope. Tool results are analyzed in memory and are never written to this report.

The `cacheHits/cacheMisses` counters describe the M8 general TTL cache. Existing feature-specific course/video, completion, and file caches can reduce warm network requests without incrementing those two counters.

## Synthetic Results

| Tool | Phase | Status | Requests | Cache hit/miss | Coalesced | Peak | Bytes | Warnings | Items |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| learnus_list_courses | cold | OK | 1 | 0/1 | 0 | 1 | 167 | 0 | 1 |
| learnus_list_courses | warm | OK | 0 | 1/0 | 0 | 0 | 167 | 0 | 1 |
| learnus_get_course | cold | OK | 1 | 0/1 | 0 | 1 | 651 | 0 | 3 |
| learnus_get_course | warm | OK | 0 | 1/0 | 0 | 0 | 651 | 0 | 3 |
| learnus_list_activities | cold | OK | 1 | 0/1 | 0 | 1 | 592 | 0 | 3 |
| learnus_list_activities | warm | OK | 0 | 1/0 | 0 | 0 | 592 | 0 | 3 |
| learnus_get_assignment | cold | OK | 1 | 0/1 | 0 | 1 | 1084 | 0 | 0 |
| learnus_get_assignment | warm | OK | 0 | 1/0 | 0 | 0 | 1084 | 0 | 0 |
| learnus_upcoming | cold | OK | 1 | 0/1 | 0 | 1 | 90 | 0 | 0 |
| learnus_upcoming | warm | OK | 0 | 1/0 | 0 | 0 | 90 | 0 | 0 |
| learnus_list_announcements | cold | OK | 2 | 0/1 | 0 | 1 | 277 | 0 | 1 |
| learnus_list_announcements | warm | OK | 0 | 1/0 | 0 | 0 | 277 | 0 | 1 |
| learnus_list_notifications | cold | OK | 1 | 0/1 | 0 | 1 | 674 | 0 | 1 |
| learnus_list_notifications | warm | OK | 0 | 1/0 | 0 | 0 | 674 | 0 | 1 |
| learnus_get_overview | cold | OK | 5 | 0/5 | 2 | 2 | 871 | 0 | 2 |
| learnus_get_overview | warm | OK | 0 | 5/0 | 0 | 0 | 871 | 0 | 2 |
| learnus_get_weekly_tasks | cold | OK | 7 | 0/5 | 2 | 2 | 1404 | 0 | 2 |
| learnus_get_weekly_tasks | warm | OK | 0 | 5/0 | 0 | 0 | 1404 | 0 | 2 |
| learnus_list_videos | cold | OK | 1 | 0/0 | 0 | 1 | 478 | 0 | 1 |
| learnus_list_videos | warm | OK | 0 | 0/0 | 0 | 0 | 478 | 0 | 1 |
| learnus_get_video_attendance | cold | OK | 2 | 0/0 | 0 | 1 | 613 | 1 | 1 |
| learnus_get_video_attendance | warm | OK | 0 | 0/0 | 0 | 0 | 613 | 1 | 1 |
| learnus_get_learning_overview | cold | OK | 2 | 0/0 | 0 | 1 | 1256 | 1 | 1 |
| learnus_get_learning_overview | warm | OK | 0 | 0/0 | 0 | 0 | 1256 | 1 | 1 |
| learnus_list_files | cold | OK | 1 | 0/0 | 0 | 1 | 277 | 0 | 1 |
| learnus_list_files | warm | OK | 0 | 0/0 | 0 | 0 | 277 | 0 | 1 |
| learnus_get_course | concurrent-3 | OK | 1 | 0/1 | 2 | 1 | 651 | 0 | 3 |
| learnus_get_overview | concurrent-3 | OK | 5 | 0/5 | 12 | 2 | 871 | 0 | 2 |
| learnus_get_overview | weekly-equivalent-cold | OK | 7 | 0/5 | 2 | 2 | 1404 | 0 | 2 |
| learnus_get_weekly_tasks | after-equivalent-overview | OK | 0 | 5/0 | 0 | 0 | 1404 | 0 | 2 |
| learnus_get_weekly_tasks | concurrent-3 | OK | 7 | 0/5 | 12 | 2 | 1404 | 0 | 2 |

## Integration Results

Integration evaluation: NOT RUN

## Cold vs Warm

| Tool | Cold req | Warm req | Cold ms | Warm ms | Cold bytes | Warm bytes | Warm cache hits |
| --- | --- | --- | --- | --- | --- | --- | --- |
| learnus_list_courses | 1 | 0 | 37.67 | 3.62 | 167 | 167 | 1 |
| learnus_get_course | 1 | 0 | 33.12 | 1.33 | 651 | 651 | 1 |
| learnus_list_activities | 1 | 0 | 23.99 | 1.14 | 592 | 592 | 1 |
| learnus_get_assignment | 1 | 0 | 35.74 | 1.58 | 1084 | 1084 | 1 |
| learnus_upcoming | 1 | 0 | 54.08 | 1.13 | 90 | 90 | 1 |
| learnus_list_announcements | 2 | 0 | 61.1 | 1.07 | 277 | 277 | 1 |
| learnus_list_notifications | 1 | 0 | 28.34 | 1.21 | 674 | 674 | 1 |
| learnus_get_overview | 5 | 0 | 108.4 | 2.38 | 871 | 871 | 5 |
| learnus_get_weekly_tasks | 7 | 0 | 154.57 | 2.23 | 1404 | 1404 | 5 |
| learnus_list_videos | 1 | 0 | 30.41 | 1.28 | 478 | 478 | 0 |
| learnus_get_video_attendance | 2 | 0 | 61.91 | 1.89 | 613 | 613 | 0 |
| learnus_get_learning_overview | 2 | 0 | 54.97 | 1.45 | 1256 | 1256 | 0 |
| learnus_list_files | 1 | 0 | 30.24 | 1.24 | 277 | 277 | 0 |



## Coalescing

| Tool | Logical calls | Network requests | Coalesced | Peak concurrency | Response bytes/call |
| --- | --- | --- | --- | --- | --- |
| learnus_get_course | 3 | 1 | 2 | 1 | 651 |
| learnus_get_overview | 3 | 5 | 12 | 2 | 871 |
| learnus_get_weekly_tasks | 3 | 7 | 12 | 2 | 1404 |

Identical concurrent calls share normalized cache flights or canonical data-request flights. The identity contains session generation, method, normalized path, sorted query, and stable body while excluding sesskey/token values.

The three concurrent synthetic overview calls used 5 network requests instead of three independent sets of underlying requests. An overview contains several distinct endpoint identities, so the target is one request per distinct underlying identity rather than one total network request.

## Overview Analysis

| Combination | Bytes | Requests | Cache hits | Elapsed ms | courses/upcoming/assignments/announcements/notifications |
| --- | --- | --- | --- | --- | --- |
| default | 871 | 5 | 0 | 97.29 | 0/0/1/1/0 |
| courses-upcoming | 377 | 2 | 0 | 20.46 | 1/0/0/0/0 |
| upcoming-assignments-announcements | 871 | 5 | 0 | 92.48 | 0/0/1/1/0 |
| with-notifications | 1234 | 6 | 0 | 76.6 | 0/0/1/1/1 |



## Payload Size

Section sizes are approximate serialized values. `other` includes the range and JSON object-key overhead; the MCP envelope is shown separately.

| Combination | MCP bytes | Result bytes | courses | upcoming | assignments | announcements | notifications | warnings | other |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| default | 871 | 738 | 2 | 2 | 217 | 186 | 2 | 2 | 327 |
| courses-upcoming | 377 | 298 | 88 | 2 | 2 | 2 | 2 | 2 | 200 |
| upcoming-assignments-announcements | 871 | 738 | 2 | 2 | 217 | 186 | 2 | 2 | 327 |
| with-notifications | 1234 | 1081 | 2 | 2 | 217 | 186 | 326 | 2 | 346 |

Duplicate candidates for the synthetic `with-notifications` overview:

| Signal | Occurrences beyond first | Estimated bytes |
| --- | --- | --- |
| courseId | 2 | 6 |
| course name | 0 | 0 |
| course URL | 0 | 0 |
| activity/module metadata | 0 | 0 |
| warning strings | 0 | 0 |
| shared URL origin | 2 | 48 |
| null/empty values | 2 | structural count |
| long text fields | 1 | 202 |

## Network Request Analysis

The warm overview should normally reuse the short source caches. A Tool whose warm row still performs network work either returned warnings that are intentionally not cached, paginated into a distinct request identity, or relies on a feature-specific refresh boundary. Authentication navigation is intentionally outside the data limiter and counters.

## M9 Candidates

These rankings are provisional because only synthetic account data was available in this run.

HIGH

- Largest overview section: `notifications`, currently about 326 synthetic serialized bytes. Benchmark narrower list summaries before changing it. Expected saving: potentially 20–50% of that section. Meaning-loss risk: medium. External schema compatibility impact: high if fields are removed; keep the current schema until an opt-in compatible representation is measured.
- Repeated URL origin/path material: 48 estimated bytes across 3 URLs. Expected saving: up to that repeated-prefix estimate. Meaning-loss risk: low if clients can reconstruct canonical URLs. External schema compatibility impact: high, so no change is made in M8.5.

MEDIUM

- Repeated course IDs/module metadata: 6 estimated bytes. Expected saving: small on synthetic data, potentially larger for multi-course accounts. Meaning-loss risk: medium. Compatibility impact: high for relational/dictionary conversion.
- Long notification/content text: 202 bytes in 1 long fields. Expected saving: high only when notifications are included. Meaning-loss risk: high because truncation can remove context. Compatibility impact: low if the existing overview summary cap is only tightened after real-account measurement.

LOW

- Empty optional values and repeated warnings: 2 empty structures and 0 repeated-warning bytes. Expected saving: low. Meaning-loss risk: low. Compatibility impact: medium if omission semantics change.

## Tool Description Observations

Descriptions explicitly require LearnUs or established academic context and exclude generic personal todo routing. weekly_tasks is the primary weekly coursework entry point; overview is a configurable broad summary while individual Tools support drill-down. Auth status is diagnostic, not a prerequisite, and browser/computer control is an explicit-unsupported/challenge fallback. Informational notifications are not required tasks. These are static expectations, not observed host-model behavior.

Expected scenarios:

- “이번 주 해야 할 일 정리해줘” → do not automatically prefer LearnUs without established academic context
- “LearnUs에서 이번 주 해야 할 일 정리해줘” → `learnus_get_weekly_tasks`
- “런어스 이번 주 할 일 알려줘” → `learnus_get_weekly_tasks`
- “이번 주 강의에서 해야 할 일 정리해줘” → `learnus_get_weekly_tasks`
- “이번 주 출석해야 할 영상 있어?” → `learnus_get_weekly_tasks` or `learnus_get_learning_overview`
- “LearnUs 공지만 보여줘” → `learnus_list_announcements`
- “이 과제 상세 알려줘” → `learnus_get_assignment` with established assignment context
- “강의자료 새로 올라온 것 보여줘” → `learnus_list_files`
- “OO 과목에서 앞으로 해야 할 게 뭐야?” → resolve the course, then overview or the smallest required individual Tool set
- “새로운 알림과 공지 있어?” → overview with `includeNotifications=true`

Actual host-model Tool selection, one-call behavior, interpretation, and final answer quality: **NOT_AUTOMATICALLY_VERIFIED**.

## Remaining Manual Verification

Run these in a real MCP Host and inspect its Tool trace without copying sensitive Tool results:

1. “이번 주 해야 할 일 정리해줘.” — do not automatically prefer LearnUs without academic context
2. “LearnUs에서 이번 주 해야 할 일 정리해줘.”
3. “내 강의 중 하나에서 앞으로 해야 할 일을 알려줘.”
4. “새로운 알림과 공지가 있는지 확인해줘.”
5. Repeat question 2 immediately and confirm the second call is warm and semantically equivalent.
