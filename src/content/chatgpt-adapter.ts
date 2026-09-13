import type { PageSnapshot } from '../shared/types';
import { hasTerminalMarker } from '../core/completion';
import { composerValue, findComposerEditor } from './composer';

const MESSAGE_SELECTORS = '[data-message-author-role], [data-message-id]';
const MODEL_SELECTORS = [
  'form[data-type="unified-composer"] [data-composer-transition-slot="trailing"] button[aria-haspopup="menu"]',
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
  return /^(?:pro|(?:gpt[- ]*)?[1-9]\d*(?:\.\d+)?\s*pro)$/i.test(normalized);
}

function proModeLabel(node: Element): string | null {
  const values = [text(node), node.getAttribute('aria-label') ?? '', node.getAttribute('title') ?? ''];
  for (const value of values) {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized || normalized.length > 96) continue;
    if (isProModeLabel(normalized)) return normalized.replace(/(\d)\s*(pro)$/i, '$1 $2');
    // Accessible selector descriptions may contain surrounding UI instructions.
    // Do not extract an arbitrary substring from filenames or answer text.
    const match = normalized.match(/(?:^|[,;]\s*)(?:current model|当前模型)[:：]?\s*(.+)$/i);
    if (match && isProModeLabel(match[1])) return match[1].replace(/(\d)\s*(pro)$/i, '$1 $2');
  }
  return null;
}

function eligibleModelControl(node: Element): boolean {
  if (!node.matches('button, [role="button"]') || node.closest(
    '[data-message-author-role], [data-message-id], article, [data-testid^="conversation-turn"], nav, aside, [role="menu"], [role="menuitem"], [data-testid*="attachment" i], [data-testid*="file" i], [hidden], [aria-hidden="true"]'
  )) return false;
  // document.visibilityState is intentionally not used: a background tab is valid.
  for (let parent: Element | null = node; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  }
  return true;
}

function mode(): { label: string | null; fingerprint: string | null; detail: string } {
  const composer = Array.from(document.querySelectorAll(MODEL_SELECTORS[0])).filter(eligibleModelControl);
  const explicit = composer.length ? composer : Array.from(document.querySelectorAll(MODEL_SELECTORS.slice(1).join(','))).filter(eligibleModelControl);
  // A real selector whose value is unreadable/non-Pro blocks fallback to a badge.
  const candidates = explicit.length ? explicit : Array.from(document.querySelectorAll('button, [role="button"]'))
    .filter(eligibleModelControl).filter(node => proModeLabel(node) !== null);
  const labels = candidates.map(proModeLabel);
  const fingerprints = new Set(labels.filter((label): label is string => label !== null).map(label => label.toLowerCase().replace(/\s+/g, ' ')));
  const detail = `source=${explicit.length ? 'model-control' : 'exact-button'} scope=${composer.length ? 'composer' : 'page-controls'} candidates=${candidates.length} distinct=${fingerprints.size} unreadable=${labels.some(label => label === null)}`;
  if (labels.some(label => label === null) || fingerprints.size !== 1) return { label: null, fingerprint: null, detail };
  return { label: labels[0], fingerprint: [...fingerprints][0], detail };
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
    branchFingerprint, modeFingerprint: model.fingerprint, modeLabel: model.label, modeDetail: model.detail,
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
