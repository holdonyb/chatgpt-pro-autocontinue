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

The “stale refresh” setting is a recovery probe, not a keep-alive. Since v0.2.11, an incomplete awaited answer may trigger a refresh after no observable answer or current-turn process progress for the configured interval (default 15 minutes), even while the page still displays generation. Progress and changes in generation state restart this interval. A final probe must still pass before reloading. The extension excludes stop-generation controls from sending. Page evidence cannot distinguish silent computation from a stale connection; a refresh is not proof of completion or guaranteed harmless to server-side work.

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

### v0.2.17: recover when a confirmed follow-up disappears from the page

When a refresh shows the same completed answer already continued from, but no longer shows the accepted user turn, the popup now explains that mismatch. The extension checks again using the configured stale-refresh interval, with the existing three-refresh limit. If the new turn and answer reappear, ordinary continuation resumes. The accepted-send ledger and original count/deadline remain intact.

If the message remains absent, **确认从当前回答续发一次** explicitly authorizes one new follow-up from the displayed answer. The server may still be working on the earlier message; absence in the page does not prove non-delivery. This action rechecks the bound page and a fresh stability window, preserves the budget, and cannot override a pending uncertain attempt. Ordinary Resume does not authorize this extra send. Reload the extension and refresh the original tab after updating; live background acceptance is still pending.

### v0.2.16: fix completed-answer ownership and false disconnect pauses

Paired turns have separate user and assistant action bars. Completion now checks all bars, requires the assistant's copy/regenerate controls in the same visible bar after the latest answer, and excludes user, historical, hidden and in-answer controls. Diagnostic logs report total and eligible bar counts. Fresh observations from the bound page reset consecutive read-failure counts; unrelated tabs and stale samples cannot reset them. Streaming DOM changes are sampled at most once per 250 ms, while explicit reads and pre-send checks remain immediate.

Validation includes a sanitized structural capture of the reported live completed turn and a joined adapter/coordinator/editor simulation of two accepted follow-ups, refresh, deduplication and the send limit. These tests do not substitute for a live installed-extension/background run. After updating, reload the extension and refresh the target tab to replace the old content script.

### v0.2.15: support the alternate composer and conversation layout

Model parsing excludes hidden measurement text, so a visible Pro button with an aria-hidden sizing label remains Pro. The alternate composer selector, message-ID attributes, paired user/assistant turns, labelled thinking-failure heading, action strip and process progress are now supported alongside the previous layout. Ambiguous message IDs cannot confirm completion. Manual Resume can reconcile generic Pro and versioned Pro labels on the same conversation/branch without resetting budget or deadline; two different explicit model versions remain blocked. Consumed thinking failures remain deduplicated by user turn across layout changes.

### v0.2.14: continue after an explicit thinking failure

The current assistant turn's visible “无法思考” heading is recognized as a failed attempt, not a completed answer. With an idle composer, verified Pro mode and stable turn identity, the extension sends the configured follow-up through its normal guarded send path. Each accepted follow-up counts against the original budget; the same failed turn is consumed once and ambiguous sends are never retried. After three consecutive failure follow-ups without a normal answer, the run pauses for review. Hidden, historical, quoted and nested tool labels do not authorize a send. A page-recovery pause still requires Resume after the page is readable; missing model evidence is never replaced with a cached model. Model diagnostics now include raw/excluded composer-control counts.

### v0.2.13: distinguish generation controls from research titles

Research-card titles containing “Stop” or “停止” no longer mark the page as generating. Busy detection uses exact known stop-control IDs outside message/navigation content, or exact generation-stop labels in the composer; hidden controls are excluded. Streaming evidence is limited to assistant content after the latest user message. Diagnostics include matched stop-control and streaming-marker counts without storing titles. The inactivity refresh and completion-stability rules remain unchanged.

### v0.2.12: distinguish page-read failures

Read failures now record a normalized cause (timeout, missing receiver, closed channel, invalid extension context, missing tab, snapshot exception or invalid reply) and elapsed time. A separate browser-owned tab query records frozen/discarded/active/loading state when available, even if the page script does not reply. Raw exception text and URLs are not logged. This diagnoses loss of communication; it does not automatically imply a network failure or stopped ChatGPT response.

After reloading the extension, also refresh the target ChatGPT page to replace its content script, then Resume. Automatic recovery thresholds and send deduplication are unchanged.

### v0.2.11: recover a stuck generation indicator

Automatic refresh remains available while the page displays generation, once the configured inactivity threshold is reached. This supersedes v0.2.10's blanket busy-page exclusion. Current-turn process progress and final-answer changes reset the timer; a fresh pre-reload probe cancels recovery if progress or generation state changed. Identity checks, draft protection, the three-refresh allowance per awaited turn, and uncertain-send deduplication remain in force. Logs distinguish `cause=busy-no-progress` from `cause=awaiting-submitted-answer`. Refresh itself never counts as completion and does not send a follow-up.

### v0.2.10: progress tracking and click diagnostics (refresh policy superseded above)

Current-turn tool/progress text contributes a hashed activity fingerprint; it never counts as answer-completion evidence. When generation controls disappear, a full stale interval starts before recovery can reload. Page state is checked again immediately before committing a reload.

`SEND_CLICK_REPORTED` records the intended send control, click-attempt time and reported outcome when a content-script reply arrives. A missing reply still means uncertainty; absence of this log is not proof of no click. No research text is included.

### v0.2.9: recovery timeout recheck

After the two-minute recovery window, the next check reads the current page before pausing. If the original conversation, branch and model are verified, it resumes waiting with a fresh completion stability window and preserves the run budget. It does not treat the old document or an uncertain send as recovered.

Recovery logs now list missing identity conditions and model-selection evidence. If the final check fails, the popup distinguishes an unresponsive page, the old document, and missing conversation/branch/model/page status. Reload the extension, refresh the original tab, then Resume the paused task.

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
