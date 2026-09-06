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
| Refresh never completes identity recovery | Pause after 2 minutes; do not dispatch on incomplete identity. |
| Same awaited user turn stays stale | Allow 3 automatic refreshes at the configured interval, then pause. Rebinding or worker restart does not reset this allowance. User Resume resets recovery counters only. |
| Run expires while the page is unavailable | Finish without another page request; an unresolved send remains flagged for reconciliation. |
| Duplicate Start or old run alarm arrives | Keep the current run and budget; ignore obsolete run alarms. |
| Storage write fails before send commitment | No click is dispatched. State persistence must succeed first. |

Paused tasks show a toolbar `!`; subsequent alarms and tab events do not replace their first reason. Read-only popup requests bypass the mutation queue; popup refreshes never overlap. New observations log page visibility, focus, discard status, and snapshot age. These are diagnostic clues, not proof of a network or scheduling cause.

Known pre-click failure still leaves composer text for inspection. Clear or manually send that text as appropriate, then Resume. For legacy/uncertain attempts, inspect the conversation before ending the run and starting another; do not assume `0/N` proves nothing was sent. A task whose deadline has passed cannot be extended by Resume.

The extension cannot make progress while Chrome or the computer is stopped. Deadlines are checked when execution resumes. Completion selectors and actual long-running web behavior still require field acceptance; automatic recovery does not bypass login, verification challenges, or site usage limits.
