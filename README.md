# LearnUs local MCP server

Yonsei LearnUs의 강의, 과제, 일정, 공지, 알림, 영상 학습 상태와 강의자료를 읽는 TypeScript **local stdio MCP 서버**입니다. Node.js **22.19 이상**과 Playwright Chromium이 필요합니다. 현재 버전은 0.1.0입니다.

## 설치 및 실행

```sh
npm ci
npx playwright install chromium
npm run build
npm run lint
npm test
npm start
```

Linux CI에서는 `npx playwright install --with-deps chromium`으로 OS 의존성도 설치합니다. 전역 TypeScript/Playwright 설치는 필요하지 않습니다. production process 테스트를 위해 build를 먼저 실행하세요.

MCP Host에 command `node`, args `["<path-to-repo>/dist/index.js"]`를 설정합니다. Host 프로세스에 `LEARNUS_ID`, `LEARNUS_PASSWORD` 환경변수를 안전하게 전달하세요. 실제 값을 Tool 인자, 채팅, 명령줄 또는 커밋되는 설정에 넣지 마세요. 서버는 `.env`를 자동 로드하지 않습니다. [Host 설정](docs/codex-mcp-host-setup.md)을 참고하세요.

조회 Tool은 자동 인증합니다. auth_status는 세션 진단용이며 조회 전 필수 단계가 아닙니다.

## 16개 public Tools

courseId/moduleId/articleId/videoId는 응답에서 얻은 양의 정수 **문자열**입니다. 과제 상세 cmid는 양의 정수 **숫자**, fileId는 등록된 UUID입니다.

| Tool | 필수 입력 | 선택 입력 | 결과 |
| --- | --- | --- | --- |
| learnus_auth_status | 없음 | 없음 | authenticated |
| learnus_list_courses | 없음 | 없음 | courses, warnings |
| learnus_get_course | courseId | 없음 | name?, activities |
| learnus_list_activities | courseId | 없음 | activities |
| learnus_get_assignment | cmid | 없음 | 과제 상세, extraFields, warnings |
| learnus_upcoming | from, to | courseId, limit | events, truncated, warnings |
| learnus_list_announcements | 없음 | courseId, limit | items, warnings |
| learnus_get_announcement | moduleId, articleId | 없음 | item?, warnings |
| learnus_list_notifications | 없음 | limit | items, warnings |
| learnus_list_videos | courseId | refresh | items, currentWeek?, warnings |
| learnus_get_video_attendance | courseId | videoId, refresh | mode, items, currentWeek?, warnings |
| learnus_get_learning_overview | 없음 | courseId, week, status, refresh | courses 및 상태별 목록, warnings |
| learnus_list_files | courseId | scope, refresh | items, warnings |
| learnus_download_file | fileId | 없음 | 로컬 path, sizeBytes, mimeType |
| learnus_get_overview | 없음 | courseId, from, to, include 옵션, maxItemsPerSection | range 및 선택된 summary sections, warnings |
| learnus_get_weekly_tasks | 없음 | courseId, from, to | 학습을 포함한 주간 coursework summary |

주간 과제·출석·학습 질문은 weekly_tasks, 여러 범주의 조정 가능한 요약은 overview, 특정 항목은 개별 Tool을 사용합니다. 학업 맥락이 없는 일반 개인 할 일 질문에 LearnUs를 자동 우선하지 않습니다.

주간 기본 범위는 Asia/Seoul 월요일~일요일입니다. overview는 기본 upcoming/과제/공지를 각각 최대 10개 조합합니다. includeCourses/includeNotifications/includeLearning은 기본 false이며 weekly_tasks는 learning도 포함합니다. includeUpcoming/includeAssignments/includeAnnouncements로 기본 sections도 제외할 수 있습니다. 부분 실패는 *_UNAVAILABLE warning으로 남깁니다.

공지·알림·새 파일은 기본 informational입니다. 완료된 자료를 확인 의무로 해석하지 않으며 Moodle completion은 다운로드나 실제 독서의 증명이 아닙니다. 영상 completion/progress/attendance target/status를 분리합니다. 대상·마감 근거가 부족하면 unknown을 유지합니다. 상세 정책: [학습 의미](docs/m86-semantics.md), [주간 조회](docs/weekly-tasks.md).

## 환경변수

| 변수 | 기본값/용도 |
| --- | --- |
| LEARNUS_ID / LEARNUS_PASSWORD | 로컬 프로세스 인증정보 |
| LEARNUS_MAX_CONCURRENT_REQUESTS | 4; 1~32 |
| LEARNUS_CACHE_ENABLED | 1; 0은 일반 TTL cache 비활성화, 기능별 cache 유지 |
| LEARNUS_DOWNLOAD_ROOT | 미설정 시 ~/Documents/LearnUS |
| LEARNUS_MAX_DOWNLOAD_BYTES | 52428800 |
| LEARNUS_COURSE_CONTEXT_OVERRIDES | 선택적 course ID별 audienceTags JSON |
| LEARNUS_INTEGRATION | 0; 실계정 read-only 검증 opt-in |
| LEARNUS_DOWNLOAD_INTEGRATION | 0; 별도 다운로드 integration opt-in |

세션은 메모리에 보관합니다. [Cache/coalescing 정책](docs/performance.md). 시간표 cache는 정규화 데이터를 학기별로 저장하지만 실제 endpoint adapter는 연결되지 않았습니다.

파일은 등록된 fileId만 다운로드하며 root 하위에서 기존 파일을 덮어쓰지 않습니다. ubfile/과제 introattachment를 지원하며 증거가 부족한 resource/folder는 FILE_SOURCE_RESEARCH_REQUIRED를 반환할 수 있습니다.

## 검증

```sh
npm run test:browser
npm run test:inspector
npm run evaluate:tokens
```

Inspector UI는 `npm run inspector`로 엽니다. smoke는 credential을 제거한 production stdio 프로세스에서 등록/진단/안전한 오류 응답을 검사합니다. benchmark는 synthetic HTTP와 production Tool handlers를 조합하며 정확한 LLM token 수나 Host routing을 검증하지 않습니다.

실계정은 credential과 LEARNUS_INTEGRATION=1을 안전하게 공급한 프로세스에서 `npm run test:integration:release`로 opt-in 합니다. 한 세션에서 조회하며 과제/공지/영상이 없는 정상 계정도 허용합니다. 다운로드는 `test:integration:learning`에서 추가 flag가 있을 때만 임시 디렉터리에서 수행하고 정리합니다. 일부 과거 milestone 테스트는 과제/영상 존재를 요구하므로 empty 계정에서는 상세 검증이 불가능할 수 있습니다. 일반 CI에는 실계정 credential을 설정하지 않습니다.

- [Architecture](docs/architecture.md)
- [Security 및 한계](docs/security.md)
- [M9 측정](docs/m9-token-evaluation.md)
- [Release checklist](docs/release-checklist.md)

라이선스: [MIT](LICENSE).
