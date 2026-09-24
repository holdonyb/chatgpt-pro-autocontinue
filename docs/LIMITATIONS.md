# Limitations and recovery model

## Browser scheduling

The background service worker uses Chrome alarms to perform periodic checks, but the ChatGPT page is a separate renderer. Chrome may throttle hidden-page JavaScript and rendering, and may freeze or discard a tab under resource pressure. The extension cannot disable those browser policies or guarantee the ChatGPT page's live connection stays current.

Since v0.2.11, recovery may reload an identifiable READY or BUSY page with an incomplete awaited answer and no current-turn process or answer progress for the configured interval (default 15 minutes). An unchanged busy indicator does not prevent recovery. A change in generation state starts a fresh interval, and a final page check can cancel the reload if progress or other conditions change. Long silent computation is indistinguishable from a stale page using this evidence; adjust the inactivity threshold for the workload. DOM reads and browser reloads cannot form an atomic transaction or establish whether server-side work has finished. Recovery remains limited to three automatic refreshes per awaited user turn, after which manual inspection is required.

## Completion evidence

The extension needs the latest recognizable message to be an assistant answer with independent completion evidence. Dynamic page changes can make that evidence unavailable even if the answer looks complete. In that case the extension waits or refreshes; it does not infer completion from elapsed time alone.

## Safety boundaries

- One active run only.
- The browser and machine must remain running.
- Pending sends are never automatically retried after a refresh or worker interruption.
- A changed conversation, branch, mode, detected draft/attachment, page error, deadline, or maximum sends stops automatic dispatch.
- The extension does not bypass ChatGPT limits, account controls, or human-verification challenges.
