import type { PageSnapshot } from '../shared/types';
import { hasTerminalMarker } from '../core/completion';
import { composerValue, findComposerEditor } from './composer';

const NEW_MESSAGE = '[data-chatgpt-search-unit-key][data-chatgpt-search-message-ids]';
const MESSAGE_SELECTORS = `[data-message-author-role], [data-message-id], ${NEW_MESSAGE}`;
const MODEL_SELECTORS = [
  'form[data-type="unified-composer"] [data-composer-transition-slot="trailing"] button[aria-haspopup="menu"], form[data-chatgpt-composer] button[data-codex-intelligence-trigger="true"][aria-haspopup="menu"]',
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
  if (node.matches(NEW_MESSAGE)) {
    const ids = [...new Set((node.getAttribute('data-chatgpt-search-message-ids') ?? '').trim().split(/\s+/).filter(Boolean))];
    return ids.length === 1 ? ids[0] : null;
  }
  return node.getAttribute('data-message-id') || node.getAttribute('data-id') ||
    (node.id && /message/i.test(node.id) ? node.id : null);
}

function messageRole(node: Element | null): string | null {
  if (!node) return null;
  const key = node.getAttribute('data-chatgpt-search-unit-key');
  return node.getAttribute('data-message-author-role') || (key?.endsWith(':user') ? 'user' : key?.endsWith(':assistant') ? 'assistant' : null);
}

function messages(): Element[] { return Array.from(document.querySelectorAll(MESSAGE_SELECTORS)).filter(n => n.matches(NEW_MESSAGE) || messageId(n)); }

function controlText(node: Element): string {
  // Read text nodes from the live DOM so CSS-hidden measurement labels are not
  // accidentally revived by cloning them into a detached tree.
  function collect(current: Node): string {
    if (current.nodeType === Node.TEXT_NODE) return current.textContent ?? '';
    if (!(current instanceof Element) || current.matches('script, style, svg') || !isVisible(current)) return '';
    return Array.from(current.childNodes).map(collect).join('');
  }
  return collect(node).replace(/\s+/g, ' ').trim();
}

function controlLabel(node: Element): string {
  const ids = node.getAttribute('aria-labelledby')?.trim().split(/\s+/) ?? [];
  if (ids.length) return ids.map(id => document.getElementById(id)).filter((el): el is HTMLElement => Boolean(el && isVisible(el))).map(controlText).join(' ').trim();
  return node.getAttribute('aria-label')?.trim() || controlText(node);
}

function isVisible(node: Element): boolean {
  for (let parent: Element | null = node; parent; parent = parent.parentElement) {
    if (parent.hasAttribute('hidden') || parent.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  }
  return true;
}

function generationEvidence(lastUser: Element | null, lastAssistant: Element | null, editor: Element | null) {
  const composer = editor?.closest('form, [data-composer-body]') ?? editor?.parentElement;
  const candidates = new Set([
    ...document.querySelectorAll('button[data-testid="stop-button"], button[data-testid="composer-stop-button"]'),
    ...(composer?.querySelectorAll('button, [role="button"]') ?? [])
  ]);
  const stopControls = Array.from(candidates).filter(node => {
    // Research titles can contain "Stop" or "停止"; never read them as controls.
    if (node.closest('[data-message-author-role], [data-testid^="conversation-turn"], [data-turn-key], article, nav, aside, [role="menu"], [role="dialog"]') || !isVisible(node)) return false;
    const label = node.getAttribute('aria-label')?.replace(/\s+/g, ' ').trim() ?? '';
    if (/record|voice|audio|录音|语音|听写/i.test(label)) return false;
    return ['stop-button', 'composer-stop-button'].includes(node.getAttribute('data-testid') ?? '') ||
      /^(?:stop(?: generating| generation| response)?|停止(?:生成|回答|响应|回复)?)$/i.test(label);
  });
  const streaming = Array.from(document.querySelectorAll('[data-is-streaming="true"]')).filter(node => {
    if (!isVisible(node)) return false;
    const assistantScope = node.closest('[data-message-author-role="assistant"], [data-turn="assistant"], [data-chatgpt-search-unit-key$=":assistant"]') ||
      (lastAssistant && node.contains(lastAssistant));
    if (!assistantScope) return false;
    return lastUser ? Boolean(lastUser.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) :
      Boolean(lastAssistant && (lastAssistant.contains(node) || node.contains(lastAssistant)));
  });
  return { busy: stopControls.length > 0 || streaming.length > 0, stopControls: stopControls.length, streaming: streaming.length };
}

function activityFingerprint(lastUser: Element | null): string | null {
  if (!lastUser) return null;
  // Process/tool cards can live outside data-message-author-role nodes. Only
  // inspect assistant turns following the latest user; historical UI is irrelevant.
  const turns = Array.from(document.querySelectorAll('[data-testid^="conversation-turn"][data-turn="assistant"]'))
    .filter(node => Boolean(lastUser.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
  const pair = lastUser.closest('[data-turn-key]');
  if (pair) turns.push(...Array.from(pair.querySelectorAll('[data-chatgpt-agent-turn-start]')).map(node => node.parentElement!).filter(node => Boolean(lastUser.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)));
  if (!turns.length) return null;
  const content = turns.map(node => {
    const copy = node.cloneNode(true) as Element;
    copy.querySelectorAll('script, style, [hidden], [aria-hidden="true"]').forEach(child => child.remove());
    return text(copy).replace(/\b\d+\s*(?:ms|s|m|h)\b|\d+\s*(?:秒|分钟|小时)/g, '#');
  }).join('|');
  // Persist only a change detector, never process text or tool output.
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) hash = Math.imul(hash ^ content.charCodeAt(i), 16777619);
  return `${turns.length}:${content.length}:${(hash >>> 0).toString(16)}`;
}

function thinkingFailureId(lastUser: Element | null, editor: Element | null, busy: boolean): string | null {
  if (!lastUser || !editor || !isVisible(editor) || busy) return null;
  const pair = lastUser.closest('[data-turn-key]');
  if (pair) {
    if (pair !== Array.from(document.querySelectorAll('[data-turn-key]')).at(-1) || pair.getAttribute('data-turn-key') !== messageId(lastUser)) return null;
    if (pair.querySelector('[data-chatgpt-search-unit-key$=":assistant"]')) return null;
    const marker = pair.querySelector('[data-chatgpt-agent-turn-start]');
    if (!marker || !(lastUser.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING)) return null;
    const heading = marker.parentElement?.querySelector('button[aria-expanded][aria-labelledby]');
    if (!heading || heading.closest(NEW_MESSAGE) || !isVisible(heading) || controlLabel(heading) !== '无法思考') return null;
    return `thinking-failure:${messageId(lastUser)}:${pair.getAttribute('data-turn-key')}`;
  }
  const turn = Array.from(document.querySelectorAll('[data-testid^="conversation-turn"][data-turn="assistant"]')).at(-1);
  if (!turn || !isVisible(turn) || !(lastUser.compareDocumentPosition(turn) & Node.DOCUMENT_POSITION_FOLLOWING)) return null;
  const id = turn.getAttribute('data-turn-id');
  const userId = messageId(lastUser);
  if (!id || !userId || turn.querySelector('[data-message-author-role="assistant"]')) return null;
  // The failure heading lives outside message bodies. Never interpret research
  // prose, a tool-card label, or a historical failure as a recovery instruction.
  const node = turn.querySelector('button[aria-expanded]');
  const failed = node &&
    !node.closest('[data-message-author-role], [data-message-id]') &&
    !node.hasAttribute('aria-label') && isVisible(node) && text(node) === '无法思考';
  return failed ? `thinking-failure:${userId}:${id}` : null;
}

function isProModeLabel(value: string): boolean {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return /^(?:pro|(?:gpt[- ]*)?[1-9]\d*(?:\.\d+)?\s*pro)$/i.test(normalized);
}

function proModeLabel(node: Element): string | null {
  const values = [controlText(node), node.getAttribute('aria-label') ?? '', node.getAttribute('title') ?? ''];
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
    '[data-message-author-role], [data-message-id], [data-turn-key], [data-chatgpt-search-unit-key], article, [data-testid^="conversation-turn"], nav, aside, [role="menu"], [role="menuitem"], [data-testid*="attachment" i], [data-testid*="file" i], [hidden], [aria-hidden="true"]'
  )) return false;
  // document.visibilityState is intentionally not used: a background tab is valid.
  for (let parent: Element | null = node; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  }
  return true;
}

function mode(): { label: string | null; fingerprint: string | null; detail: string } {
  const rawComposer = Array.from(document.querySelectorAll(MODEL_SELECTORS[0]));
  const composer = rawComposer.filter(eligibleModelControl);
  const explicit = composer.length ? composer : Array.from(document.querySelectorAll(MODEL_SELECTORS.slice(1).join(','))).filter(eligibleModelControl);
  // A real selector whose value is unreadable/non-Pro blocks fallback to a badge.
  const candidates = explicit.length ? explicit : Array.from(document.querySelectorAll('button, [role="button"]'))
    .filter(eligibleModelControl).filter(node => proModeLabel(node) !== null);
  const labels = candidates.map(proModeLabel);
  const fingerprints = new Set(labels.filter((label): label is string => label !== null).map(label => label.toLowerCase().replace(/\s+/g, ' ')));
  const detail = `source=${explicit.length ? 'model-control' : 'exact-button'} scope=${composer.length ? 'composer' : 'page-controls'} candidates=${candidates.length} distinct=${fingerprints.size} unreadable=${labels.some(label => label === null)} rawComposer=${rawComposer.length} excludedComposer=${rawComposer.length - composer.length}`;
  if (labels.some(label => label === null) || fingerprints.size !== 1) return { label: null, fingerprint: null, detail };
  return { label: labels[0], fingerprint: [...fingerprints][0], detail };
}

export function readSnapshot(documentId: string): PageSnapshot {
  const all = messages();
  const last = all.at(-1) ?? null;
  const userMessages = all.filter(n => messageRole(n) === 'user');
  const assistantMessages = all.filter(n => messageRole(n) === 'assistant');
  const lastUser = userMessages.at(-1) ?? null;
  const lastAssistant = assistantMessages.at(-1) ?? null;
  let lastAssistantId = lastAssistant ? messageId(lastAssistant) : null;
  const answerBody = lastAssistant?.querySelector('[data-markdown-text-style="assistant-message"]') ?? lastAssistant;
  const answerText = text(answerBody);
  const answerRawText = rawText(answerBody);
  const editor = findComposerEditor();
  const generation = generationEvidence(lastUser, lastAssistant, editor);
  const busySignal = generation.busy;
  const failureId = thinkingFailureId(lastUser, editor, busySignal);
  const errorSignal = Boolean(document.querySelector('[role="alert"], [data-testid*="error" i]')) &&
    /error|错误|try again|重试/i.test(text(document.querySelector('[role="alert"], [data-testid*="error" i]')));
  // This is only a candidate until DOM_OBSERVATIONS records the live page's completion marker.
  const explicitComplete = Boolean(lastAssistant?.getAttribute('data-is-streaming') === 'false' || lastAssistant?.getAttribute('data-complete') === 'true');
  const assistantTurn = lastAssistant?.closest('article, [data-testid^="conversation-turn"], [data-testid*="conversation-turn"], [data-turn-key]') ?? lastAssistant;
  const newActions = assistantTurn?.querySelector('.turn-action-controls');
  const actionEvidence = lastAssistant?.matches(NEW_MESSAGE) ? Boolean(newActions && !newActions.closest(NEW_MESSAGE) &&
    newActions.querySelector('button[aria-label="复制"], button[aria-label="Copy"]') && newActions.querySelector('button[aria-label="重新生成回复"], button[aria-label="Regenerate response"]')) : Boolean(assistantTurn?.querySelector(
    '[data-testid*="copy" i], button[aria-label*="Copy" i], button[aria-label*="复制"], button[title*="Copy" i], button[title*="复制"], [data-testid*="regenerate" i], button[aria-label*="重新生成"]'
  ));
  const finalSignal = Boolean(!failureId && last === lastAssistant && lastAssistantId && answerText && !busySignal && (explicitComplete || actionEvidence));
  if (failureId) lastAssistantId = failureId;
  const model = mode();
  const branchNode = document.querySelector('[data-conversation-branch-id], [data-branch-id]');
  // Message count changes after every send, so it is not a branch identity.
  // If the live page exposes no branch marker, the first stable message is the weakest fallback.
  const branchFingerprint = branchNode?.getAttribute('data-conversation-branch-id') ||
    branchNode?.getAttribute('data-branch-id') || conversationKeyFromUrl();
  const editorValue = composerValue(editor);
  const hasPendingAttachment = Boolean(document.querySelector('[data-testid*="attachment" i], [aria-label*="attachment" i], [aria-label*="附件"]'));
  const lastRole = messageRole(last);
  return {
    conversationKey: conversationKeyFromUrl(), url: location.href, documentId,
    activityFingerprint: activityFingerprint(lastUser),
    visibility: document.visibilityState, focused: document.hasFocus(), wasDiscarded: Boolean((document as Document & { wasDiscarded?: boolean }).wasDiscarded),
    completionDetail: `chars=${answerText.length} explicit=${explicitComplete} actions=${actionEvidence} latest=${last === lastAssistant} scope=${assistantTurn?.tagName ?? '-'} buttons=${assistantTurn?.querySelectorAll('button').length ?? 0} stopControls=${generation.stopControls} streaming=${generation.streaming} thinkingFailure=${Boolean(failureId)} editor=${Boolean(editor)}`,
    branchFingerprint, modeFingerprint: model.fingerprint, modeLabel: model.label, modeDetail: model.detail,
    status: errorSignal ? 'ERROR' : busySignal ? 'BUSY' : model.fingerprint ? 'READY' : 'UNKNOWN',
    lastMessageRole: failureId ? 'assistant' : lastRole === 'user' || lastRole === 'assistant' ? lastRole : 'unknown',
    lastUserTurnId: lastUser ? messageId(lastUser) : null, lastAssistantAnswerId: lastAssistantId,
    answerFingerprint: failureId ?? (lastAssistantId && answerText ? `${lastAssistantId}:${answerText.length}:${answerText.slice(-160)}` : null),
    terminalMarker: !finalSignal ? null : hasTerminalMarker(answerRawText, 'DONE') ? 'DONE' : hasTerminalMarker(answerRawText, 'NEEDS_USER') ? 'NEEDS_USER' : null,
    thinkingFailure: Boolean(failureId), finalSignal, busySignal, errorSignal, editorEmpty: editorValue.trim().length === 0,
    hasPendingAttachment, observedAt: Date.now()
  };
}

export function adapterHealth(): { conversationKey: string | null; mode: string | null; messageCount: number; completionEvidence: boolean } {
  const snapshot = readSnapshot('health-check');
  return { conversationKey: snapshot.conversationKey, mode: snapshot.modeFingerprint, messageCount: document.querySelectorAll(MESSAGE_SELECTORS).length, completionEvidence: snapshot.finalSignal };
}
