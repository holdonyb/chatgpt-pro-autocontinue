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

Task metadata and up to 500 bounded diagnostic events stay in extension local storage. The extension does not persist full assistant answers, page HTML, screenshots, attachments, custom prompt text, cookies, or tokens. Read [the privacy boundary](docs/PRIVACY.md) before use.

## Development

```powershell
npm ci
npm run typecheck
npm test
npm run test:e2e
npm run build
```

The automated suite uses mocked Chrome APIs and jsdom fixtures; it does not establish real-web reliability. See [acceptance status](docs/ACCEPTANCE.md) and [contributing](CONTRIBUTING.md).
