# LearnUs weekly task discovery

`learnus_get_weekly_tasks({courseId?:string,from?:string,to?:string})` calls the existing overview once with `includeLearning:true`. No new parser, authentication, network, cache, or task classifier is introduced. Omitting dates inherits the Korea Monday–Sunday range. Public Tool count: 16.

The response retains the overview schema: assignments/resources retain their classifications, learning retains actionable/completed/unknown groups, announcements are informational, and calendar entries are schedule evidence rather than proof of unfinished work. Existing source limits, date coverage and partial-failure warnings also apply. Notifications are not fetched by default. Completed/informational items must not be presented as required tasks.

## Discovery metadata

Weekly tasks is the primary entry point for explicit LearnUs/런어스 weekly coursework planning. Overview remains the configurable broad summary; upcoming is calendar/deadline only; learning overview is video/attendance only; assignment is specific detail; files is material discovery/download.

Server instructions prefer LearnUs MCP over browser/computer control for explicit or established LearnUs coursework. Data queries authenticate internally when configured. auth_status is diagnostic-only and is not a prerequisite. Browser/computer control is an explicit unsupported-operation or required-interaction fallback, such as AUTH_CHALLENGE_REQUIRED. Read-only tools declare readOnlyHint and idempotentHint; download retains its local-file side-effect semantics. Metadata expresses guidance, not a guarantee of host-model routing.

## Static routing expectations / manual Host tests

| User message | Expected selection |
| --- | --- |
| LearnUs에서 이번 주 해야 할 일 정리해줘 | learnus_get_weekly_tasks |
| 런어스 이번 주 할 일 알려줘 | learnus_get_weekly_tasks |
| 이번 주 출석해야 할 영상 있어? | weekly_tasks or learning_overview |
| LearnUs 공지만 보여줘 | learnus_list_announcements |
| 이 과제 상세 알려줘 | learnus_get_assignment with established assignment identity |
| 이번 주 해야 할 일 정리해줘 | No unsupported preference for LearnUs without academic context |

Actual LLM selection and answer quality: NOT_AUTOMATICALLY_VERIFIED. Refresh the Host's tool discovery/session after restarting the server, then run the messages above and inspect which tool is chosen first.

## Synthetic stdio evaluation

`npm run evaluate:mcp` measures the real MCP client → stdio server → existing service path with synthetic network responses. No sensitive results are saved.

| Scenario | Network requests | MCP response bytes |
| --- | ---: | ---: |
| Weekly cold | 7 | 1647 |
| Weekly warm | 0 | 1647 |
| Equivalent overview with learning, cold | 7 | 1647 |
| Weekly after equivalent overview | 0 | 1647 |
| Three concurrent weekly calls | 7 total | 1647 per call |

Three weekly calls coalesce 12 underlying loads, peak concurrency 2. The basic overview remains 5 cold / 0 warm requests and 1005 bytes. Learning inclusion uses the existing course-context and completion reads; the wrapper adds none beyond that equivalent overview. The evaluation checks request-count equivalence and warm cache reuse. Timings are synthetic and are not a production latency guarantee. Actual authenticated evaluation: NOT RUN in this environment.
