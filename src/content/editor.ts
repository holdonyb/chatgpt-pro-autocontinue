import type { ContentCommand, PageSnapshot, SendExecutionResult } from '../shared/types';
import { readSnapshot } from './chatgpt-adapter';
import { composerValue, findComposerEditor, type ComposerEditor } from './composer';

function value(el: ComposerEditor): string { return composerValue(el); }

function setValue(el: ComposerEditor, valueToSet: string): void {
  el.focus();
  if (el instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, valueToSet);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: valueToSet }));
  } else {
    const selection = window.getSelection();
    const range = document.createRange();
    // ProseMirror expects text inside its paragraph. Replacing the whole root can
    // leave an invalid document which the editor immediately rolls back.
    const textBlock = el.querySelector('p:last-child') ?? el;
    range.selectNodeContents(textBlock);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    let inserted = false;
    try { inserted = document.execCommand?.('insertText', false, valueToSet) ?? false; } catch { inserted = false; }
    if (!inserted || value(el).trim() !== valueToSet.trim()) {
      const paragraph = document.createElement('p');
      paragraph.textContent = valueToSet;
      el.replaceChildren(paragraph);
    }
    // execCommand normally emits input itself, but an explicit event is needed by
    // some controlled composer builds and is harmless when the native event fired.
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: valueToSet }));
    selection?.removeAllRanges();
  }
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function sendButton(el: ComposerEditor): HTMLButtonElement | null {
  const form = el.closest('form');
  const scope = form ?? document;
  const buttons = Array.from(scope.querySelectorAll('button'));
  return buttons.find((button) => {
    const label = `${button.getAttribute('data-testid') ?? ''} ${button.getAttribute('aria-label') ?? ''} ${button.getAttribute('title') ?? ''} ${button.textContent ?? ''}`;
    return !button.disabled && button.getAttribute('aria-disabled') !== 'true' &&
      !/stop|cancel|voice|dictat|停止|取消|语音|听写/i.test(label) &&
      /\bsend\b|\bsubmit\b|发送|提交/i.test(label);
  }) as HTMLButtonElement | null;
}

async function waitFor<T>(read: () => T | null | false, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const result = read();
    if (result) return result;
    // A background timer can wake long after its requested delay. Observe the
    // current DOM once on wakeup before deciding the condition timed out.
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
}

function composerDiagnostic(el: ComposerEditor): string {
  const scope = el.closest('form') ?? document;
  const buttons = Array.from(scope.querySelectorAll('button')).map((button) =>
    `${button.getAttribute('data-testid') ?? ''}/${button.getAttribute('aria-label') ?? ''}/${button.type}/${button.disabled ? 'disabled' : 'enabled'}`
  ).filter((label) => label.replaceAll('/', '').trim()).slice(-4).join(', ');
  return `编辑器=${el.tagName.toLowerCase()}#${el.id || '-'}[contenteditable=${el.getAttribute('contenteditable') ?? '-'}]，剩余字符=${value(el).trim().length}，按钮=${buttons || '无'}`;
}

export async function executeSend(command: ContentCommand, current: PageSnapshot, contextValid: () => boolean = () => true): Promise<SendExecutionResult> {
  const notSent = (reason: string): SendExecutionResult => ({ ok: false, clicked: false, reason });
  const valid = () => Number.isFinite(command.expiresAt) && Date.now() < command.expiresAt && contextValid();
  if (!valid()) return notSent('发送指令已过期或扩展已重新加载，尚未点击发送。');
  if (current.documentId !== command.expectedDocumentId || current.conversationKey !== command.expectedConversationKey) return notSent('页面身份已变化');
  if (current.lastAssistantAnswerId !== command.expectedParentTurnId) return notSent('回答父轮次已变化');
  if (!current.editorEmpty || current.hasPendingAttachment) return notSent('检测到用户草稿或附件');
  if (current.status !== 'READY' || current.busySignal || !current.finalSignal) return notSent('页面尚未达到可发送状态');
  const el = findComposerEditor();
  if (!el) return notSent('未找到编辑器');
  setValue(el, command.prompt);
  if (value(el).trim() !== command.prompt.trim()) return notSent('无法确认编辑器内容');
  // ChatGPT shows a voice button while the editor is empty and creates/enables the
  // send button only after its input handler has processed the new text.
  const button = await waitFor(() => sendButton(el), 2_500);
  if (!button) return notSent(`尚未点击发送：未找到可用发送按钮；${composerDiagnostic(el)}`);
  // Revalidate after the asynchronous wait; the page may have navigated or
  // started generating while the timer was suspended.
  const fresh = readSnapshot(current.documentId);
  if (fresh.conversationKey !== command.expectedConversationKey || fresh.lastAssistantAnswerId !== command.expectedParentTurnId ||
      fresh.modeFingerprint !== current.modeFingerprint || fresh.branchFingerprint !== current.branchFingerprint ||
      fresh.busySignal || fresh.errorSignal || fresh.hasPendingAttachment || !fresh.finalSignal || fresh.status !== 'READY') {
    return notSent('等待发送按钮期间页面状态变化，尚未点击发送。');
  }
  if (!el.isConnected || findComposerEditor() !== el || value(el).trim() !== command.prompt.trim() ||
      !button.isConnected || sendButton(el) !== button) return notSent('编辑器或发送按钮已变化，尚未点击发送。');
  if (!valid()) return notSent('等待期间发送指令已过期或扩展已重新加载，尚未点击发送。');
  button.click();
  const accepted = await waitFor(() => {
    const after = readSnapshot(current.documentId);
    if (after.conversationKey !== command.expectedConversationKey || after.modeFingerprint !== current.modeFingerprint || after.branchFingerprint !== current.branchFingerprint) return null;
    const newUserId = after.lastUserTurnId !== current.lastUserTurnId ? after.lastUserTurnId : null;
    if (after.busySignal) return { acceptedBy: 'busy' as const, userMessageId: newUserId };
    if (after.lastUserTurnId && after.lastUserTurnId !== current.lastUserTurnId) return { acceptedBy: 'user-turn' as const, userMessageId: after.lastUserTurnId };
    const afterEditor = findComposerEditor();
    if (afterEditor && composerValue(afterEditor).trim() === '' && !sendButton(afterEditor)) {
      return { acceptedBy: 'composer-cleared' as const, userMessageId: newUserId };
    }
    return null;
  }, 5_000);
  return accepted ? { ok: true, ...accepted } : { ok: false, clicked: true, reason: '已点击发送，但页面没有出现新的用户消息、回答状态或编辑器清空' };
}
