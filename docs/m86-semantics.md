# M8.6 coursework semantics

Use LearnUs only with explicit or established academic context. A generic personal todo question does not establish that context. Authentication status is diagnostic, not a prerequisite. Server instructions and Tool descriptions carry this boundary; there is no keyword router.

## Observed completion evidence

The recorded `_research/ys.learnus.org.har` course responses contain 20 `completion-auto-n` icons. No checked example was observed in those responses. Synthetic tests cover Moodle's corresponding `completion-auto-y` signal, missing tracking, and unfamiliar tracking markup. Unrecognized completion markup is unknown, not incomplete. The signal means Moodle activity completion, not download history. File descriptors inherit completion from their course activity by cmid.

## Actionability

Announcements and notifications default to informational; upload notices never create required tasks. Overview adds optional section semantics, assignment classification, and resource summaries from course pages already fetched for assignment discovery. Completed resources are completed, tracked incomplete resources are actionable, and unknown completion remains unknown. Submission labels are classified conservatively with exact known aliases. Schedule events do not prove an unfinished obligation.

`includeLearning:true` optionally adds actionable/completed/unknown video groups using the existing attendance service. `courseId` scopes the overview. Default calls perform no additional learning requests. Required videos with unknown deadlines remain required; unknown targets and deadline conflicts go to unknown. These are additive optional schema fields.

## Video evidence

Direct activity exclusion wins. A same-cmid report's explicit individual attendance status and activity-local required instruction are strong evidence. An audience override only supports an activity-local audience exclusion. Section summaries, title similarity, course names and other videos are not used as target evidence. No evidence means unknown. Completion, viewing percentage, target, and attendance status are separate fields.

Deadline candidates retain their source. Tier 1 is a same-video attendance report end; tier 2 is a canonical same-cmid `vod/progressstop` calendar event; tier 3 is an explicit activity-local instructional deadline. System availability never becomes attendance due time. A higher tier wins with `VIDEO_DEADLINE_SOURCES_DIFFER` for differing lower evidence. Equal-tier disagreement clears effectiveDueAt and adds `VIDEO_DEADLINE_CONFLICT`. Calendar candidates are consumed from the already selected upcoming result when learning is included in overview; events absent from its range/limit cannot provide evidence. Standalone attendance does not add a calendar fetch.

Passed deadlines only produce incomplete/overdue states. Attendance is only called not_attended when the report explicitly says so. A completed video is excluded from required tasks.

## Verification limits

M8 synthetic stdio comparison: default overview cold/warm requests remain 5/0; three concurrent course calls remain one request plus two coalesced calls; three concurrent overviews remain five requests with peak concurrency two. Optional semantic fields increase the default synthetic overview envelope from 717 to 1005 bytes. This is a payload increase, not a network improvement; no latency guarantee is inferred from synthetic timing. Explicit learning inclusion performs additional attendance reads as requested.

Actual authenticated integration: NOT RUN without opt-in credentials. Recorded unchecked completion was observed; checked completion and canonical Progress stop responses are synthetic-only checks in the available evidence. Real Host routing and answer quality: NOT_AUTOMATICALLY_VERIFIED.

Manual retest:

1. 이번 주 해야 할 일 정리해줘 — no unsupported LearnUs preference.
2. LearnUs에서 이번 주 해야 할 일 정리해줘 — coursework overview.
3. 이번 주 강의에서 해야 할 일 정리해줘 — coursework overview.
4. 이번 주 출석해야 할 영상 있어? — learning/attendance.
5. 새 강의자료 확인할 것 있어? — completed materials are not review obligations.
6. 경제학개론에서 아직 해야 할 학습 알려줘 — resolve course, then scoped overview/learning.
