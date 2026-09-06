import type { PageSnapshot } from '../shared/types';
import { hasTerminalMarker } from '../core/completion';
import { composerValue, findComposerEditor } from './composer';

const MESSAGE_SELECTORS = '[data-message-author-role], [data-message-id]';
const MODEL_SELECTORS = [
  '[data-testid*="model"]', '[data-testid*="Model"]',
  'button[aria-label*="model" i]', 'button[aria-label*="模型"]'
];

function text(node: Element | null): string { return node?.textContent?.replace(/\s+/g, ' ').trim() ?? ''; }
function rawText(node: Element | null): string {
  if (!node) return '';
  const copy = node.cloneNode(true) as Element;
  copy.querySelectorAll('button, script, style').forEach((child) => child.remove());
  return copy.textContent?.replace(/\r\n/g, '\n').trim() ?? '';
}

export function conversationKeyFromUrl(url = location.href): string | null {
  const match = url.match(/\/c\/([a-zA-Z0-9-]+)/);
  return match?.[1] ?? null;
}

function messageId(node: Element): string | null {
  return node.getAttribute('data-message-id') || node.getAttribute('data-id') ||
    (node.id && /message/i.test(node.id) ? node.id : null);
}

function messages(): Element[] { return Array.from(document.querySelectorAll(MESSAGE_SELECTORS)).filter((n) => messageId(n)); }

function isProModeLabel(value: string): boolean {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return /^(?:pro|(?:gpt[- ]*)?\d+(?:\.\d+)?\s+pro)$/i.test(normalized);
}

function proModeLabel(node: Element): string | null {
  const values = [text(node), node.getAttribute('aria-label') ?? '', node.getAttribute('title') ?? ''];
  for (const value of values) {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized || normalized.length > 96) continue;
    if (isProModeLabel(normalized)) return normalized;
    const match = normalized.match(/(?:gpt[- ]*)?\d+(?:\.\d+)?\s+pro/i);
    if (match) return match[0];
  }
  return null;
}

function mode(): { label: string | null; fingerprint: string | null } {
  const candidates = new Set<Element>();
  for (const selector of MODEL_SELECTORS) {
    document.querySelectorAll(selector).forEach((node) => candidates.add(node));
  }
  // Current ChatGPT can render the composer model control as a compact button such
  // as "6 Pro" without a model-specific data-testid or aria-label.
  document.querySelectorAll('button, [role="button"]').forEach((node) => {
    if (proModeLabel(node)) candidates.add(node);
  });
  const editor = findComposerEditor();
  let composerScope: Element | null = editor;
  for (let i = 0; i < 6 && composerScope?.parentElement; i += 1) composerScope = composerScope.parentElement;
  composerScope?.querySelectorAll('button, [role="button"], [aria-label], [title], span').forEach((node) => {
    if (proModeLabel(node)) candidates.add(node);
  });
  for (const node of candidates) {
    const value = proModeLabel(node);
    if (!value) continue;
    // Keep this deliberately strict. A subscription badge or prose mentioning Pro is not evidence.
    return { label: value, fingerprint: value.toLowerCase().replace(/\s+/g, ' ') };
  }
  return { label: null, fingerprint: null };
}

export function readSnapshot(documentId: string): PageSnapshot {
  const all = messages();
  const last = all.at(-1) ?? null;
  const userMessages = all.filter((n) => n.getAttribute('data-message-author-role') === 'user');
  const assistantMessages = all.filter((n) => n.getAttribute('data-message-author-role') === 'assistant');
  const lastUser = userMessages.at(-1) ?? null;
  const lastAssistant = assistantMessages.at(-1) ?? null;
  const lastAssistantId = lastAssistant ? messageId(lastAssistant) : null;
  const answerText = text(lastAssistant);
  const answerRawText = rawText(lastAssistant);
  const busySignal = Boolean(document.querySelector('[data-is-streaming="true"], [data-testid*="stop" i], button[aria-label*="Stop" i], button[aria-label*="停止"]'));
  const errorSignal = Boolean(document.querySelector('[role="alert"], [data-testid*="error" i]')) &&
    /error|错误|try again|重试/i.test(text(document.querySelector('[role="alert"], [data-testid*="error" i]')));
  // This is only a candidate until DOM_OBSERVATIONS records the live page's completion marker.
  const explicitComplete = Boolean(lastAssistant?.getAttribute('data-is-streaming') === 'false' || lastAssistant?.getAttribute('data-complete') === 'true');
  const assistantTurn = lastAssistant?.closest('article, [data-testid^="conversation-turn"], [data-testid*="conversation-turn"]') ?? lastAssistant;
  const actionEvidence = Boolean(assistantTurn?.querySelector(
    '[data-testid*="copy" i], button[aria-label*="Copy" i], button[aria-label*="复制"], button[title*="Copy" i], button[title*="复制"], [data-testid*="regenerate" i], button[aria-label*="重新生成"]'
  ));
  const finalSignal = Boolean(last === lastAssistant && lastAssistantId && answerText && !busySignal && (explicitComplete || actionEvidence));
  const model = mode();
  const branchNode = document.querySelector('[data-conversation-branch-id], [data-branch-id]');
  // Message count changes after every send, so it is not a branch identity.
  // If the live page exposes no branch marker, the first stable message is the weakest fallback.
  const branchFingerprint = branchNode?.getAttribute('data-conversation-branch-id') ||
    branchNode?.getAttribute('data-branch-id') || conversationKeyFromUrl();
  const editor = findComposerEditor();
  const editorValue = composerValue(editor);
  const hasPendingAttachment = Boolean(document.querySelector('[data-testid*="attachment" i], [aria-label*="attachment" i], [aria-label*="附件"]'));
  const lastRole = last?.getAttribute('data-message-author-role');
  return {
    conversationKey: conversationKeyFromUrl(), url: location.href, documentId,
    visibility: document.visibilityState, focused: document.hasFocus(), wasDiscarded: Boolean((document as Document & { wasDiscarded?: boolean }).wasDiscarded),
    completionDetail: `chars=${answerText.length} explicit=${explicitComplete} actions=${actionEvidence} latest=${last === lastAssistant} scope=${assistantTurn?.tagName ?? '-'} buttons=${assistantTurn?.querySelectorAll('button').length ?? 0}`,
    branchFingerprint, modeFingerprint: model.fingerprint, modeLabel: model.label,
    status: errorSignal ? 'ERROR' : busySignal ? 'BUSY' : model.fingerprint ? 'READY' : 'UNKNOWN',
    lastMessageRole: lastRole === 'user' || lastRole === 'assistant' ? lastRole : 'unknown',
    lastUserTurnId: lastUser ? messageId(lastUser) : null, lastAssistantAnswerId: lastAssistantId,
    answerFingerprint: lastAssistantId && answerText ? `${lastAssistantId}:${answerText.length}:${answerText.slice(-160)}` : null,
    terminalMarker: !finalSignal ? null : hasTerminalMarker(answerRawText, 'DONE') ? 'DONE' : hasTerminalMarker(answerRawText, 'NEEDS_USER') ? 'NEEDS_USER' : null,
    finalSignal, busySignal, errorSignal, editorEmpty: editorValue.trim().length === 0,
    hasPendingAttachment, observedAt: Date.now()
  };
}

export function adapterHealth(): { conversationKey: string | null; mode: string | null; messageCount: number; completionEvidence: boolean } {
  const snapshot = readSnapshot('health-check');
  return { conversationKey: snapshot.conversationKey, mode: snapshot.modeFingerprint, messageCount: document.querySelectorAll(MESSAGE_SELECTORS).length, completionEvidence: snapshot.finalSignal };
}
