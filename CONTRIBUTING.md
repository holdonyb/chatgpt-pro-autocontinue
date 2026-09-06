# Contributing

Please keep changes conservative. This extension can send messages in a signed-in browser session, so new selectors or completion rules need fixture coverage and an explanation of their observed page evidence.

Before opening a pull request:

```powershell
npm ci
npm run validate
npm run test:e2e
```

Do not commit ChatGPT conversation text, screenshots, cookies, tokens, raw HTML, exported extension storage, or personal diagnostic logs. Test real sends only in a dedicated test conversation.
