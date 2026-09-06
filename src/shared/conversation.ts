export function conversationKeyFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://chatgpt.com') return null;
    return parsed.pathname.match(/\/c\/([a-zA-Z0-9-]+)(?:\/|$)/)?.[1] ?? null;
  } catch { return null; }
}
