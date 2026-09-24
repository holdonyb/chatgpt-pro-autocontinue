# Privacy boundary

- Host access is limited to `https://chatgpt.com/*`.
- The extension operates through visible page UI. It does not read cookies, authentication tokens, private API payloads, or network responses.
- Task metadata and at most 500 bounded event records are stored in `chrome.storage.local`.
- Page-read failures log normalized cause, elapsed time and browser-owned tab state (frozen, discarded, active, loading). Raw exceptions, tab titles and URLs from the tab diagnostic are not persisted.
- Current-turn process activity is stored only as a count/length/hash change detector, without process text. Reported click diagnostics include a normalized send-control identifier, button type, attempt timestamp and outcome, not arbitrary button labels.
- Saved run settings include your follow-up instruction. The answer fingerprint includes the answer ID, text length, and up to 160 trailing characters. These are local recovery state, not diagnostic log fields. Uninstalling the extension removes its local storage.
- Full assistant answers, page HTML, screenshots, attachments and custom prompt text are not written to diagnostic logs by default.
- A user action is required to bind and start a run. A failed or ambiguous send pauses; it does not click retry or submit a duplicate.
