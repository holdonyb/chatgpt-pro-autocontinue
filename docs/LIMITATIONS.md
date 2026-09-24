# Limitations and recovery model

## Browser scheduling

The background service worker uses Chrome alarms to perform periodic checks, but the ChatGPT page is a separate renderer. Chrome may throttle hidden-page JavaScript and rendering, and may freeze or discard a tab under resource pressure. The extension cannot disable those browser policies or guarantee the ChatGPT page's live connection stays current.

Since v0.2.10, automatic refresh is blocked while generation is indicated. Recovery may reload only an identifiable, non-busy page with an incomplete awaited answer and no current-turn process or answer progress for the configured interval. Disappearance of generation controls starts a fresh interval. A final page check can cancel the reload. A stuck busy indicator requires manual inspection. DOM reads and browser reloads cannot form an atomic transaction; these checks reduce risk but cannot establish that server-side work has finished or that a reload cannot affect it.

## Completion evidence

The extension needs the latest recognizable message to be an assistant answer with independent completion evidence. Dynamic page changes can make that evidence unavailable even if the answer looks complete. In that case the extension waits or refreshes; it does not infer completion from elapsed time alone.

## Safety boundaries

- One active run only.
- The browser and machine must remain running.
- Pending sends are never automatically retried after a refresh or worker interruption.
- A changed conversation, branch, mode, detected draft/attachment, page error, deadline, or maximum sends stops automatic dispatch.
- The extension does not bypass ChatGPT limits, account controls, or human-verification challenges.
