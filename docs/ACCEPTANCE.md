# Acceptance

## Automated

- [x] typecheck
- [x] unit tests for completion, markers, guards and reducer
- [x] coordinator routing, refresh and duplicate-send guard tests
- [ ] MV3 build loads in a clean Chrome profile
- [x] worker restart, delayed replies, expired commands, bounded disconnect/reload recovery simulation

## Real web Pro

- [ ] dedicated test conversation, not a formal research conversation
- [ ] actual selected Pro mode is read and remains unchanged for two续研 rounds
- [ ] two accepted automatic messages and two completed answers in a background tab
- [ ] user draft pauses without overwriting text
- [ ] refresh/worker restart does not resend an uncertain attempt
- [ ] mode/branch change, error, limit or captcha pauses without retry

Status: v0.2.12 has 108 automated tests using mocked Chrome APIs and jsdom fixtures. Recovery cases cover a delayed final probe finding a recovered or busy page, fresh stability before a single send, changed identity/drafts, missing-evidence diagnostics, unavailable/old documents, freshest verification evidence and pending-send uncertainty. The earlier supplied composer DOM was also checked offline: adjacent version/Pro spans yield `6 pro` and the stop control remains busy. The full supplied HTML is not included in the repository. This does not validate live long-running background reliability. Check the latest local validation result or CI before relying on a build.


v0.2.10 adds busy-page reload exclusion, current-turn progress hashing without false completion, a fresh inactivity window after generation stops, pre-reload state revalidation, and click-result metadata coverage. Live page inspection confirmed that process cards can sit outside final-message nodes; no message, stop, or reload was sent to the research conversation during inspection. These observations do not establish why the server-side response stopped or whether it stopped.

v0.2.11 supersedes the busy-page exclusion. Regression cases cover stale BUSY recovery without sending or changing the budget, process progress resetting inactivity without implying completion, new process activity or generation resumption cancelling a pre-reload probe, and the three-refresh limit in both BUSY and READY. No live research-conversation reload experiment was performed.


v0.2.12 adds read-failure classification and bounded browser-owned tab metadata diagnostics. Tests cover timeout, missing receiver, closed channel, invalid extension context, missing tab, unknown transport error redaction, explicit DOM read exceptions and unavailable metadata. Typecheck, 108 automated tests, build and 33 e2e fixtures passed locally. No live extension reload was performed in the research conversation.
