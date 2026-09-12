# Release checklist — M10

Status: **READY_TO_PUSH_WITH_UNVERIFIED_INTEGRATION**

## Validation

- [x] npm ci in the working tree and a fresh temporary source copy
- [x] Build and lint in both environments
- [x] Working-tree tests: 129 total, 121 passed, 8 opt-in skips, 0 failed
- [x] Fresh-copy tests pass without ignored research HAR or prior build artifacts
- [x] Synthetic browser/SSO tests and headless Chromium smoke
- [x] Production stdio EOF/signal tests and Inspector smoke (credential-free)
- [x] M8 request/cache/coalescing regression checks
- [x] M9 serialization and semantic regression checks
- [ ] Optional real-account integration: **REAL_ACCOUNT_INTEGRATION: NOT RUN**
- [x] CI explicitly disables live and download integration; no credential secrets required

The fresh copy contains prospective Git files only, then installs from the lockfile and builds before tests. This is local clean-install validation; GitHub-hosted CI has not been run by this task. Windows signal termination can be OS-driven; graceful EOF cleanup is verified separately.

## Public contract and performance

16 Tools; no renamed/deleted Tools, input schema migration or structuredContent migration. M9 text JSON remains the transport result format. Current definitions: 19,640 bytes. Synthetic JSON results: weekly_tasks 1,205, default overview 738, overview+notifications 1,081, overview+learning 1,205, learning_overview 1,069, notifications 613, announcements 210 bytes. These are serialized bytes, not LLM token counts.

Cold/warm data requests: overview 5/0; weekly_tasks 7/0. Concurrent request/coalesced/peak: course 1/2/1; overview 5/12/2; weekly_tasks 7/12/2. Synthetic dates are fixed to the fixture semester so reruns do not silently change the workload. The benchmark checks network/coalescing/peak against its saved baseline, without exact byte assertions in unit tests.

Weekly's extra requests are a separately cached course learning context GET and completion report GET. The latter supplies attendance/progress evidence. The former can potentially be shared later; M10 preserves cache boundaries and does not claim both are irreducible network costs.

## Security and repository

- [x] Credential/session-value and private-artifact review of prospective public files
- [x] No tracked HAR, authenticated HTML, cookie/storage state, download or private cache artifacts
- [x] Synthetic fixtures reviewed; local recorded research remains ignored
- [x] No personal absolute developer paths in public source/docs/config
- [x] Runtime stdout is MCP-only; research diagnostics now emit counts instead of DOM attributes
- [x] Redirect, streamed size, partial-file cleanup and local setup failure cleanup tests
- [x] Runtime dependency audit: 0 reported vulnerabilities (npm audit --omit=dev)
- [x] History reviewed: the sole existing commit contains LICENSE; no sensitive-history artifact found
- [x] README and environment example match current Tools/configuration
- [x] Architecture, security and known limitations documented
- [x] .github/workflows/ci.yml provides non-live install/build/lint/test/browser/Inspector/benchmark checks
- [x] package-lock.json retained; no dependency/version bump
- [x] git diff --check and prospective-file whitespace/conflict/large-file review
- [x] Working tree, current branch and remote reviewed; no commit/push/tag/release performed
- [x] LICENSE present: MIT; supplied repository license retained

At review, only LICENSE was tracked; application files were untracked initial-release candidates. Therefore an empty git diff alone is insufficient: the untracked candidate files were reviewed separately. No history rewriting is required by the observed history. Secret pattern scans are not a mathematical guarantee; review the actual staged files before publishing.

## Stabilization changes

Ordinary HTTP 403/404 errors no longer masquerade as session expiry. Successful login-page responses and explicit session-expiry signals still use the existing one-retry path. Course fallback discovery is restricted to course content and excludes navigation. Shutdown cleanup is bounded. Binary responses close even if local directory creation fails. Failed cache/auth/request flights remain retryable and release their permits.

Completion, submission status, informational notifications/resources, unknown attendance targets, canonical-only calendar joins and deadline-conflict warnings remain intact. New release integration accepts missing optional entities; older milestone-specific tests may still require a nonempty entity.

## Remaining manual checks

Real-account integration, actual Host answer quality/routing and GitHub-hosted CI execution are unverified here. CAPTCHA/MFA is not bypassed; theme changes and unsupported file adapters may need future evidence. Timetable storage exists without a live endpoint adapter. These limitations do not add a live-integration push blocker.

Before publishing, review `git status` and staged changes. Keep version 0.1.0. Suggested commit: `chore: stabilize LearnUs MCP for initial release`.
