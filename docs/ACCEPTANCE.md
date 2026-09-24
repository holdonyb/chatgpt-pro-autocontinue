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

Status: v0.2.9 has 92 automated tests using mocked Chrome APIs and jsdom fixtures. New recovery cases cover a delayed final probe finding a recovered or busy page, fresh stability before a single send, changed identity/drafts, missing-evidence diagnostics, unavailable/old documents, freshest verification evidence and pending-send uncertainty. Typecheck and build pass locally. The earlier supplied composer DOM was also checked offline: adjacent version/Pro spans yield `6 pro` and the stop control remains busy. The full supplied HTML is not included in the repository. This does not validate live long-running background reliability. Check the latest local validation result or CI before relying on a build.
