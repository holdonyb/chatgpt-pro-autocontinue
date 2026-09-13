# ChatGPT Pro Auto-Continue

An experimental Chrome Manifest V3 extension for one user-bound `chatgpt.com` conversation. It waits for a verified completed answer, then sends a user-configured follow-up such as “好的，继续推进。”. The selected model remains controlled by the ChatGPT page.

This project drives only visible page UI. It is not an API client and does not use account credentials, cookies, private endpoints, or network interception.

## What it does

- Binds one run to one top-level ChatGPT tab, conversation, branch, and visible model label.
- Waits for independent completion evidence and a stability window before sending.
- Preserves the run budget across a same-tab refresh after re-checking identity.
- Stops rather than retrying when send outcome is ambiguous.
- Keeps bounded, metadata-only diagnostic logs in `chrome.storage.local`.

## Background tabs: an important limitation

Chrome may throttle timers, rendering, and page work in hidden tabs. A Manifest V3 service worker can still wake on alarms, but it cannot force the ChatGPT web app to keep its real-time connection or UI rendering active. A long answer can therefore be complete on the server while a background page remains stale until it is refreshed.

The “stale refresh” setting is a recovery probe, not a keep-alive: after a prolonged lack of observable progress, the extension reloads the bound tab and re-checks the same conversation. It never clicks the page’s stop-generation control. Use a threshold longer than normal answer duration; a refresh can interrupt the page’s current display and must not be treated as proof that a response was complete.

See [limitations](docs/LIMITATIONS.md) for the exact boundaries.

## Install from source

```powershell
npm ci
npm run validate
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, then select `dist`.

For a run: open the target conversation, choose the desired model in ChatGPT, open the extension popup, set the instruction/budget/time limit/stale-refresh threshold, and choose **Start**. Starting while ChatGPT is already answering is allowed: that user turn becomes the baseline and does not count toward the automatic-send budget.

Use a dedicated test conversation first. Closing Chrome, putting the computer to sleep, tab discarding/freezing, site changes, or a page that cannot be verified can interrupt the run.

## Privacy

Run settings (including your follow-up instruction), task metadata, an answer fingerprint containing a short text suffix, and up to 500 diagnostic events stay in extension local storage. Full assistant answers, page HTML, screenshots, attachments, cookies, and tokens are not persisted. Read [the privacy boundary](docs/PRIVACY.md) before use.

## Development

### v0.2.8: model evidence

The composer model selector takes priority. Adjacent version/Pro spans (`6Pro`) now read as `6 Pro`; filenames such as `C065 Proof notes.md` cannot become a model fingerprint. Answer content, account navigation, hidden controls, and conflicting candidates are excluded or treated as unknown. Logs include selection source and candidate counts without copying arbitrary button text.

For a paused legacy run bound to the generic `pro` label, manual Resume can bind the versioned Pro label after checking the same conversation/branch and an empty composer. This preserves counts and the original deadline. Specific version changes remain blocked. Reload the extension and refresh the target page before resuming.

### v0.2.7: bounded recovery

- Page requests time out after 5 seconds; consecutive failed checks pause after the third failure and retain the budget. A successful check clears the failure count.
- Send commands expire before clicking after 20 seconds or at the run deadline, whichever comes first. A missing reply after 25 seconds remains uncertain and is never replayed. These are wall-clock checks when execution resumes, not guarantees that Chrome will run a timer on time.
- Reload recovery waits up to 2 minutes for identity and allows at most 3 automatic refreshes per awaited user turn. Manual Resume restarts the recovery allowance, preserving send count and the original deadline.
- Status reads remain available while a page request is pending. Popup polling is coalesced; active settings show the saved run values. Pauses show an `!` badge and retain the first diagnostic.
- Duplicate starts are rejected while a run is active. A worker restart cannot infer send success from an unrelated new user message. Only an explicitly identified send button is eligible; ordinary submit, stop and voice controls are excluded.

See [recovery details](docs/SEND_RECOVERY.md). Reload the extension in `chrome://extensions`, then refresh the target ChatGPT tab to replace the old content script. Handle any old unresolved send before starting a new run.

### v0.2.6: delayed timer wakeups

Button polling now reads the DOM once after a delayed timer wakeup before declaring a timeout, and revalidates the page before clicking. A confirmed pre-click failure pauses as `SEND_NOT_SENT` without consuming the send budget; inspect and clear any remaining composer text before resuming. A click with an unknown outcome still remains `SEND_UNCERTAIN` and is never automatically retried. Paused tasks no longer have their first diagnostic overwritten by periodic checks.

Older persisted `SEND_UNCERTAIN` attempts do not contain a reliable click-phase result and remain unresolved after upgrading. Inspect the conversation for the follow-up message, end the old run, and handle the remaining draft before starting a new run with the desired remaining budget.

```powershell
npm ci
npm run typecheck
npm test
npm run test:e2e
npm run build
```

The automated suite uses mocked Chrome APIs and jsdom fixtures; it does not establish real-web reliability. See [acceptance status](docs/ACCEPTANCE.md) and [contributing](CONTRIBUTING.md).
