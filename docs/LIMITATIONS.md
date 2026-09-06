# Limitations and recovery model

## Browser scheduling

The background service worker uses Chrome alarms to perform periodic checks, but the ChatGPT page is a separate renderer. Chrome may throttle hidden-page JavaScript and rendering, and may freeze or discard a tab under resource pressure. The extension cannot disable those browser policies or guarantee the ChatGPT page's live connection stays current.

If the page remains observable but makes no qualifying progress for the configured interval, the extension reloads the bound tab. It verifies the same tab, conversation, branch, and model before accepting the new document. A refresh is a recovery attempt, not an instruction to stop generation and not evidence that a server-side answer has finished.

## Completion evidence

The extension needs the latest recognizable message to be an assistant answer with independent completion evidence. Dynamic page changes can make that evidence unavailable even if the answer looks complete. In that case the extension waits or refreshes; it does not infer completion from elapsed time alone.

## Safety boundaries

- One active run only.
- The browser and machine must remain running.
- Pending sends are never automatically retried after a refresh or worker interruption.
- A changed conversation, branch, mode, detected draft/attachment, page error, deadline, or maximum sends stops automatic dispatch.
- The extension does not bypass ChatGPT limits, account controls, or human-verification challenges.
