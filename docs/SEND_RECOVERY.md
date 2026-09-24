# Send polling and recovery

The polling loop previously slept before checking the deadline again. If the renderer resumed after the deadline, the loop could return a timeout without reading a send button that was now present. A simulated 17-second wall-clock jump reproduces this race; it does not establish why a particular real renderer was delayed.

Polling now samples on wakeup before testing the deadline. Before the single click, the sender rechecks the conversation, answer, mode, branch, busy/error/attachment signals, composer text, and connected elements. These checks can refuse a send when the page changed during the wait.

The content script reports `clicked: false` only on known pre-click return paths. The coordinator then clears that attempt and pauses without counting a send. The draft is left available for user inspection. Exceptions, missing responses, and post-click uncertainty retain the pending attempt and prohibit automatic retry. Legacy attempts are not inferred to be safe from their free-text error messages.

Periodic checks return immediately for paused, stopped, and finished tasks. This preserves the original error instead of repeatedly overwriting it with a generic send timeout.

Validation uses mocked Chrome APIs and jsdom with controlled time. Real browser scheduling, page synchronization, and long-running reliability still require field verification. A gap between observation log entries cannot alone distinguish delayed alarms, a suspended machine, a delayed content-script response, or a blocked coordinator queue.

## v0.2.7 recovery rules

| Failure | Response |
| --- | --- |
| Snapshot request does not return | Stop waiting after 5 seconds; retry on later checks. Three consecutive failures pause with retained counts and instructions. |
| Send command arrives late, or waits through a long suspension | Check its absolute 20-second lease and task deadline before touching the editor and again immediately before clicking. An expired command cannot click. |
| Send reply is lost | After 25 seconds, retain the pending attempt and pause. A timeout does not prove no click occurred. Late replies do not increment counts or trigger retries. |
| Worker restarts with a pending attempt | Preserve uncertainty. A new user message alone does not prove that attempt was accepted. |
| Refresh has not completed identity recovery after 2 minutes | Read the current page once more through the normal bounded snapshot and document-verification requests. If verified, rebind and restart completion stability; otherwise pause with the current missing conditions. Old documents, changed identity, drafts and uncertain sends cannot authorize a send. |
| Same awaited user turn stays stale | Allow 3 automatic refreshes at the configured interval, then pause. Rebinding or worker restart does not reset this allowance. User Resume resets recovery counters only. |
| Run expires while the page is unavailable | Finish without another page request; an unresolved send remains flagged for reconciliation. |
| Duplicate Start or old run alarm arrives | Keep the current run and budget; ignore obsolete run alarms. |
| Storage write fails before send commitment | No click is dispatched. State persistence must succeed first. |

Paused tasks show a toolbar `!`; subsequent alarms and tab events do not replace their first reason. Read-only popup requests bypass the mutation queue; popup refreshes never overlap. New observations log page visibility, focus, discard status, and snapshot age. These are diagnostic clues, not proof of a network or scheduling cause.

Known pre-click failure still leaves composer text for inspection. Clear or manually send that text as appropriate, then Resume. For legacy/uncertain attempts, inspect the conversation before ending the run and starting another; do not assume `0/N` proves nothing was sent. A task whose deadline has passed cannot be extended by Resume.

The extension cannot make progress while Chrome or the computer is stopped. Deadlines are checked when execution resumes. Completion selectors and actual long-running web behavior still require field acceptance; automatic recovery does not bypass login, verification challenges, or site usage limits.

## v0.2.9 recovery diagnostics

`RECOVERY_FINAL_CHECK` marks a check that wakes after the recovery window. Each page request remains bounded to 5 seconds (subject to browser scheduling); verifying a new document can require a second request. A successful rebind clears recovery timestamps but preserves counts, consumed turns, refresh allowance and the original deadline. Completion still needs fresh stability before another send.

`RELOAD_WAITING_FOR_IDENTITY` records `missing=conversation,branch,mode,page-status` as applicable, plus the normal snapshot metadata and model-selection evidence. It records neither page HTML nor answer text. The timeout message uses the latest verification result, and an already established specific pause reason is retained. These diagnostics describe observed conditions; they do not prove a network disconnect or server-side failure.

## v0.2.10 progress tracking (reload policy updated in v0.2.11 below)

The earlier busy-page refresh behavior is superseded: `BUSY` or a generation control prevents automatic reload regardless of elapsed time. Current assistant-turn process text after the latest user message is hashed for progress tracking. Progress never authorizes sending; independent final-answer evidence is still required. A busy-to-idle transition restarts the inactivity window. Recovery on a non-busy incomplete answer uses a final bounded page check; newly observed progress, generation, drafts or identity changes cancel the reload. `STALE_BUSY_RELOAD` retains its historical event name, but now records `cause=awaiting-submitted-answer action=tabs.reload busy=false`.

The click attempt's normalized target and timestamp are returned with either acceptance or uncertainty and persisted as `SEND_CLICK_REPORTED`. If that reply is lost, the pending attempt remains uncertain and no click evidence can be claimed. This is not a complete browser-wide click audit. Live server-side cancellation by refresh has not been established.

## v0.2.11 inactivity recovery, including BUSY

The v0.2.10 blanket prohibition on busy-page reloads is removed. The awaited turn may be refreshed in READY or BUSY after the configured interval without current-turn answer/process progress. Generation-state transitions in either direction restart the interval, but an unchanged generation indicator does not. Before refresh a fresh snapshot is processed through the usual identity, draft, progress and completion guards; any new progress cancels that reload. `STALE_BUSY_RELOAD` records `cause=busy-no-progress action=tabs.reload busy=true` for stale busy pages and `cause=awaiting-submitted-answer ... busy=false` for idle incomplete pages.

Rebinding restarts the inactivity and completion stability windows and retains the budget and consumed turns. Pending sends are not reloaded or replayed. The existing limit of three automatic refreshes per awaited user turn still applies. Reload uses `chrome.tabs.reload`, never a Stop-generation click. The browser DOM does not prove whether silent server computation is still progressing, so this recovery policy cannot promise that every refresh is harmless.
