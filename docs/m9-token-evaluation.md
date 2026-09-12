# M9 Token / Context Evaluation

## Environment

- Runtime: Node v22.19.0, win32/x64
- Transport: MCP SDK client → local stdio server → production Tool handlers
- Metric: UTF-8 bytes of serialized JSON; this is not an exact LLM token count
- Synthetic evaluation: RUN
- Integration token evaluation: NOT RUN
- Host-internal Tool tokenization: not observable from this local benchmark

## Tool Definition Baseline

- Tool count: 16
- Before: 23795 bytes
- After: 19640 bytes
- Reduction: 4155 bytes
- Description bytes: 9925 → 5770
- Schema bytes: 10594 → 10594

Largest current definitions (description text is intentionally omitted):

| Tool | Before | After | Reduction | Description | Schema |
| --- | --- | --- | --- | --- | --- |
| learnus_get_overview | 3754 | 3477 | 277 | 640 | 2633 |
| learnus_get_weekly_tasks | 2890 | 2613 | 277 | 714 | 1691 |
| learnus_upcoming | 2732 | 2455 | 277 | 380 | 1875 |
| learnus_get_learning_overview | 1447 | 1170 | 277 | 308 | 649 |
| learnus_download_file | 1110 | 1110 | 0 | 483 | 443 |

## Tool Result Baseline

| Tool | Variant | Before result | After result | Reduction | MCP envelope | Items | Warnings | Largest category |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| learnus_list_courses | default | 114 | 114 | 0 | 167 | 1 | 0 | url |
| learnus_get_course | default | 540 | 540 | 0 | 651 | 3 | 0 | url |
| learnus_list_activities | default | 485 | 485 | 0 | 592 | 3 | 0 | url |
| learnus_get_assignment | default | 1017 | 1017 | 0 | 1084 | — | 0 | longText |
| learnus_upcoming | default | 45 | 45 | 0 | 90 | 0 | 0 | other |
| learnus_list_announcements | default | 374 | 210 | 164 | 277 | 1 | 0 | url |
| learnus_get_announcement | default | — | 841 | — | 910 | 1 | 0 | longText |
| learnus_list_notifications | default | 613 | 613 | 0 | 674 | 1 | 0 | longText |
| learnus_get_overview | default | 738 | 738 | 0 | 871 | 1 | 0 | url |
| learnus_get_overview | with-notifications | 1081 | 1081 | 0 | 1234 | 1 | 0 | longText |
| learnus_get_overview | with-learning | 1306 | 1205 | 101 | 1404 | 1 | 0 | url |
| learnus_get_overview | course-scoped | 1306 | 1205 | 101 | 1404 | 1 | 0 | url |
| learnus_get_weekly_tasks | default | 1306 | 1205 | 101 | 1404 | 1 | 0 | url |
| learnus_list_videos | default | 484 | 383 | 101 | 478 | 1 | 0 | semantics |
| learnus_get_video_attendance | default | 605 | 504 | 101 | 613 | 1 | 1 | semantics |
| learnus_get_learning_overview | default | 1271 | 1069 | 202 | 1256 | 1 | 1 | semantics |
| learnus_list_files | default | 208 | 208 | 0 | 277 | 1 | 0 | identity |

All measurements use the MCP tools/call path. Result bytes measure parsed JSON; envelope bytes measure the serialized MCP response. Download is excluded because it writes a local file.

## Weekly Tasks Analysis

| Section | Items | Bytes | Average bytes/item |
| --- | --- | --- | --- |
| range | 1 | 39 | 39 |
| actionable assignments | 1 | 217 | 217 |
| actionable learning/videos | 0 | 2 | 0 |
| upcoming/deadlines | 0 | 2 | 0 |
| informational announcements | 1 | 186 | 186 |
| informational notifications | 0 | 2 | 0 |
| informational resources | 1 | 91 | 91 |
| unknown/needs-verification | 1 | 412 | 412 |
| completed | 0 | 2 | 0 |
| warnings | 0 | 2 | 0 |
| other metadata | 1 | 102 | 102 |

## Overview Analysis

| Section | Items | Bytes | Average bytes/item |
| --- | --- | --- | --- |
| range | 1 | 39 | 39 |
| actionable assignments | 1 | 217 | 217 |
| actionable learning/videos | 0 | 2 | 0 |
| upcoming/deadlines | 0 | 2 | 0 |
| informational announcements | 1 | 186 | 186 |
| informational notifications | 0 | 2 | 0 |
| informational resources | 1 | 91 | 91 |
| unknown/needs-verification | 0 | 2 | 0 |
| completed | 0 | 2 | 0 |
| warnings | 0 | 2 | 0 |
| other metadata | 1 | 102 | 102 |

## Learning Analysis

| Section | Items | Bytes | Average bytes/item |
| --- | --- | --- | --- |
| courses | 1 | 472 | 472 |
| requiredIncomplete | 0 | 2 | 0 |
| completed | 0 | 2 | 0 |
| excludedOrOptional | 0 | 2 | 0 |
| unknown | 1 | 412 | 412 |
| warnings | 1 | 37 | 37 |

## Duplicate / Empty Field Analysis

- Weekly empty/null/empty-container fields: 5
- Overview repeated canonical identity occurrences: 2
- Overview URL bytes: 112 across 2 URLs
- Public internal/debug fields remaining across measured results: 0
- Warning strings remain attached to item identity when item-specific; aggregate warnings already use set semantics.

## Changes Applied

- Repeated per-Tool source/read-only/browser boilerplate moved to server instructions and annotations; routing-specific wording remains on each Tool.
- Public MCP JSON omits parser diagnostics and internal target/deadline evidence fields while preserving final state, uncertainty, effective deadline and warning semantics.
- Existing list/detail boundaries, notification summary cap, canonical IDs and full URLs remain unchanged.

## Before / After

The table above compares the stored pre-optimization synthetic baseline with the current MCP path. Exact byte counts are reports, not unit-test contracts.

## Semantic Risk Review

- Retained: canonical IDs, completion/submission state, attendance target/status, effective due date/source, actionability, uncertainty and warnings.
- Retained: detail Tool content, full canonical URLs, notification text cap and list/detail schemas.
- Removed only from MCP serialization: diagnostics, raw/debug/session/cache keys and internal evidence arrays/basis fields.

## M8 Performance Regression

| Case | Cold requests | Warm requests | Before cold | Before warm |
| --- | --- | --- | --- | --- |
| overview | 5 | 0 | 5 | 0 |
| weekly_tasks | 7 | 0 | 7 | 0 |

| Tool | Requests | Coalesced | Peak | Before requests/coalesced/peak |
| --- | --- | --- | --- | --- |
| learnus_get_course | 1 | 2 | 1 | 1/2/1 |
| learnus_get_overview | 5 | 12 | 2 | 5/12/2 |
| learnus_get_weekly_tasks | 7 | 12 | 2 | 7/12/2 |

Network request counts, cache reuse, coalescing and peak concurrency must remain equal to the stored baseline.

## Structured Content Audit

The installed MCP SDK supports structuredContent when an output schema is declared. Current Tools publish text JSON without output schemas. Adding both formats would increase payload; switching to structured-only could break existing local Hosts. No transport-format migration was applied.

## Integration Evaluation

Integration token evaluation: NOT RUN

Only structural statistics are written. Course names, titles, bodies, filenames, user data, URL queries, HTML and authentication values are never recorded.

## Deferred Candidates

- Definition surface consolidation requires a Host-level routing benchmark; Tool deletion or renaming is deferred.
- Dictionary/relational encoding, URL prefix compression and property-name shortening save bytes but break compatibility.
- More aggressive notification or instructor-text truncation requires opt-in real-account evidence because it can remove required context.
