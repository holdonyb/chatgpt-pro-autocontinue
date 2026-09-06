# Privacy boundary

- Host access is limited to `https://chatgpt.com/*`.
- The extension operates through visible page UI. It does not read cookies, authentication tokens, private API payloads, or network responses.
- Task metadata and at most 500 bounded event records are stored in `chrome.storage.local`.
- Full assistant answers, page HTML, screenshots, attachments and custom prompt text are not written to diagnostic logs by default.
- A user action is required to bind and start a run. A failed or ambiguous send pauses; it does not click retry or submit a duplicate.
