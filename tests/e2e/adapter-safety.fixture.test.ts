// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readSnapshot } from '../../src/content/chatgpt-adapter';
import { executeSend } from '../../src/content/editor';

describe('page adapter safety fixture', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/c/test-conversation');
    document.body.innerHTML = `
      <button>6 Pro</button>
      <div data-message-author-role="user" data-message-id="u1">问题</div>
      <div data-message-author-role="assistant" data-message-id="a1" data-is-streaming="false">
        完整回答\n[[AUTO_CONTINUE:DONE]] <button aria-label="Copy">复制</button>
      </div>
      <textarea aria-label="Message"></textarea>
      <button aria-label="Send">发送</button>`;
  });

  it('extracts only explicit fixture evidence', () => {
    const snapshot = readSnapshot('d1');
    expect(snapshot.conversationKey).toBe('test-conversation');
    expect(snapshot.modeFingerprint).toBe('6 pro');
    expect(snapshot.finalSignal).toBe(true);
    expect(snapshot.terminalMarker).toBe('DONE');
    expect(snapshot.status).toBe('READY');
    expect(snapshot.editorEmpty).toBe(true);
  });

  it('does not treat an older completed answer or its terminal marker as the latest answer', () => {
    document.body.insertAdjacentHTML('beforeend', '<div data-message-author-role="user" data-message-id="u2">继续</div><div>正在搜索网页</div>');
    const page = readSnapshot('d1');
    expect(page.lastMessageRole).toBe('user');
    expect(page.lastAssistantAnswerId).toBe('a1');
    expect(page.finalSignal).toBe(false);
    expect(page.terminalMarker).toBeNull();
  });

  it('refuses to send when mode evidence is absent', async () => {
    Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '6 Pro')?.remove();
    const snapshot = readSnapshot('d1');
    expect(snapshot.modeFingerprint).toBeNull();
    expect(snapshot.status).toBe('UNKNOWN');
    const result = await executeSend({ type: 'EXECUTE_SEND', runId: 'r1', revision: 1, attemptId: 'a1', expectedConversationKey: 'test-conversation', expectedDocumentId: 'd1', expectedParentTurnId: 'a1', prompt: '继续' }, snapshot);
    expect(result.ok).toBe(false);
  });

  it('treats the compact stop button as busy', () => {
    const stop = document.createElement('button');
    stop.dataset.testid = 'stop-button';
    document.body.append(stop);
    const snapshot = readSnapshot('d1');
    expect(snapshot.busySignal).toBe(true);
    expect(snapshot.finalSignal).toBe(false);
    expect(snapshot.status).toBe('BUSY');
  });

  it('reads Pro from an accessible model control label', () => {
    Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '6 Pro')?.remove();
    const model = document.createElement('button');
    model.setAttribute('aria-label', 'Open model menu, current model 6 Pro');
    document.querySelector('textarea')?.parentElement?.append(model);
    const snapshot = readSnapshot('d1');
    expect(snapshot.modeLabel).toBe('6 Pro');
    expect(snapshot.modeFingerprint).toBe('6 pro');
  });

  it('accepts answer actions on the outer conversation turn', () => {
    const assistant = document.querySelector('[data-message-author-role="assistant"]');
    if (!assistant) throw new Error('fixture missing assistant');
    const article = document.createElement('article');
    article.dataset.testid = 'conversation-turn-2';
    assistant.replaceWith(article);
    article.append(assistant);
    assistant.removeAttribute('data-is-streaming');
    assistant.querySelector('button')?.remove();
    const copy = document.createElement('button');
    copy.dataset.testid = 'copy-turn-action-button';
    article.append(copy);
    const snapshot = readSnapshot('d1');
    expect(snapshot.finalSignal).toBe(true);
  });

  it('waits for the send button created after editor input', async () => {
    document.querySelector('button[aria-label="Send"]')?.remove();
    const textarea = document.querySelector('textarea');
    if (!textarea) throw new Error('fixture missing editor');
    let clicked = 0;
    textarea.addEventListener('input', () => {
      const send = document.createElement('button');
      send.dataset.testid = 'send-button';
      send.addEventListener('click', () => {
        clicked += 1;
        const user = document.createElement('div');
        user.dataset.messageAuthorRole = 'user';
        user.dataset.messageId = 'u2';
        user.textContent = '继续';
        document.body.append(user);
      });
      document.body.append(send);
    }, { once: true });
    const snapshot = readSnapshot('d1');
    const result = await executeSend({ type: 'EXECUTE_SEND', runId: 'r1', revision: 1, attemptId: 'x1', expectedConversationKey: 'test-conversation', expectedDocumentId: 'd1', expectedParentTurnId: 'a1', prompt: '继续' }, snapshot);
    expect(result.ok).toBe(true);
    expect(clicked).toBe(1);
  });

  it('fills a ProseMirror-style contenteditable composer and confirms submission', async () => {
    const textarea = document.querySelector('textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('fixture missing fallback textarea');
    textarea.name = 'prompt-textarea';
    textarea.className = 'wcDTda_fallbackTextarea';
    textarea.style.display = 'none';
    const editable = document.createElement('div');
    editable.id = 'prompt-textarea';
    editable.setAttribute('contenteditable', 'true');
    editable.setAttribute('role', 'textbox');
    editable.className = 'ProseMirror';
    editable.innerHTML = '<p data-empty-paragraph="true"><br></p>';
    textarea.after(editable);
    const send = document.querySelector('button[aria-label="Send"]');
    send?.addEventListener('click', () => {
      const user = document.createElement('div');
      user.dataset.messageAuthorRole = 'user';
      user.dataset.messageId = 'u2';
      user.textContent = '继续';
      document.body.append(user);
    });
    const snapshot = readSnapshot('d1');
    const result = await executeSend({ type: 'EXECUTE_SEND', runId: 'r1', revision: 1, attemptId: 'x2', expectedConversationKey: 'test-conversation', expectedDocumentId: 'd1', expectedParentTurnId: 'a1', prompt: '继续' }, snapshot);
    expect(result, result.ok ? undefined : result.reason).toEqual({ ok: true, acceptedBy: 'user-turn', userMessageId: 'u2' });
    expect(editable.textContent).toBe('继续');
  });

  it('accepts submission when the enabled send button clears the composer', async () => {
    const textarea = document.querySelector('textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('fixture missing fallback textarea');
    textarea.style.display = 'none';
    const editable = document.createElement('div');
    editable.id = 'prompt-textarea';
    editable.setAttribute('contenteditable', 'true');
    editable.setAttribute('role', 'textbox');
    editable.className = 'ProseMirror';
    editable.innerHTML = '<p data-empty-paragraph="true"><br></p>';
    textarea.after(editable);
    const send = document.querySelector('button[aria-label="Send"]');
    send?.addEventListener('click', () => {
      editable.innerHTML = '<p data-empty-paragraph="true"><br></p>';
      send.remove();
    });
    const snapshot = readSnapshot('d1');
    const result = await executeSend({ type: 'EXECUTE_SEND', runId: 'r1', revision: 1, attemptId: 'x3', expectedConversationKey: 'test-conversation', expectedDocumentId: 'd1', expectedParentTurnId: 'a1', prompt: '继续' }, snapshot);
    expect(result, result.ok ? undefined : result.reason).toEqual({ ok: true, acceptedBy: 'composer-cleared', userMessageId: 'u1' });
  });

  it('uses the conversation id as a stable branch fallback', () => {
    const first = readSnapshot('d1').branchFingerprint;
    document.querySelector('[data-message-id="u1"]')?.remove();
    const second = readSnapshot('d1').branchFingerprint;
    expect(first).toBe('test-conversation');
    expect(second).toBe(first);
  });

  it('does not treat a marker inside a fenced block as terminal', () => {
    const answer = document.querySelector('[data-message-author-role="assistant"]');
    if (!answer) throw new Error('fixture missing assistant');
    answer.textContent = '完整回答\n```\n[[AUTO_CONTINUE:DONE]]\n```';
    const snapshot = readSnapshot('d1');
    expect(snapshot.terminalMarker).toBeNull();
  });
});
