// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { executeSend } from '../../src/content/editor';
import { readSnapshot } from '../../src/content/chatgpt-adapter';
const command = { type: 'EXECUTE_SEND' as const, runId: 'r', revision: 1, attemptId: 'x', expiresAt: 0, expectedDocumentId: 'd', expectedConversationKey: 'test', expectedParentTurnId: 'a1', prompt: '继续' };
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(command, { expiresAt: Date.now() + 20_000 });
  window.history.replaceState({}, '', '/c/test');
  document.body.innerHTML = '<button>6 Pro</button><div data-message-author-role="user" data-message-id="u1">Q</div><div data-message-author-role="assistant" data-message-id="a1" data-complete="true">A</div><form><textarea aria-label="Message"></textarea></form>';
});
it('does not touch an editor for a command delivered after expiry', async () => {
  const button = addSend();
  const clicked = vi.spyOn(button, 'click');
  const result = await executeSend({ ...command, expiresAt: Date.now() - 1 }, readSnapshot('d'));
  expect(result).toMatchObject({ ok: false, clicked: false });
  expect(document.querySelector('textarea')!.value).toBe('');
  expect(clicked).not.toHaveBeenCalled();
});
it('never clicks after a long suspension exhausts the command lease', async () => {
  const pending = executeSend(command, readSnapshot('d'));
  const button = addSend();
  const clicked = vi.spyOn(button, 'click');
  vi.setSystemTime(Date.now() + 30_000);
  await vi.advanceTimersByTimeAsync(100);
  expect(await pending).toMatchObject({ ok: false, clicked: false });
  expect(clicked).not.toHaveBeenCalled();
});
it('does not click when the extension was invalidated during the wait', async () => {
  let alive = true;
  const pending = executeSend(command, readSnapshot('d'), () => alive);
  const clicked = vi.spyOn(addSend(), 'click');
  alive = false;
  await vi.advanceTimersByTimeAsync(100);
  expect(await pending).toMatchObject({ ok: false, clicked: false });
  expect(clicked).not.toHaveBeenCalled();
});
it('does not treat an unrelated submit control as the send button', async () => {
  document.querySelector('form')!.insertAdjacentHTML('beforeend', '<button type="submit">Stop</button>');
  const clicked = vi.spyOn(document.querySelector('form button')! as HTMLButtonElement, 'click');
  const pending = executeSend(command, readSnapshot('d'));
  await vi.advanceTimersByTimeAsync(3_000);
  expect(await pending).toMatchObject({ ok: false, clicked: false });
  expect(clicked).not.toHaveBeenCalled();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
function addSend() {
  const button = document.createElement('button');
  button.dataset.testid = 'send-button';
  button.type = 'button';
  button.addEventListener('click', () => document.body.insertAdjacentHTML('beforeend', '<div data-message-author-role="user" data-message-id="u2">继续</div>'));
  document.querySelector('form')!.append(button);
  return button;
}
it('checks the button after a timer wakeup even if wall time passed the polling deadline', async () => {
  const pending = executeSend(command, readSnapshot('d'));
  const button = addSend();
  const clicked = vi.spyOn(button, 'click');
  vi.setSystemTime(Date.now() + 17_000);
  await vi.advanceTimersByTimeAsync(100);
  expect((await pending).ok).toBe(true);
  expect(clicked).toHaveBeenCalledTimes(1);
});
it('rechecks busy state before clicking a button found after waiting', async () => {
  const pending = executeSend(command, readSnapshot('d'));
  const button = addSend();
  const clicked = vi.spyOn(button, 'click');
  document.body.insertAdjacentHTML('beforeend', '<button data-testid="stop-button">Stop</button>');
  await vi.advanceTimersByTimeAsync(100);
  expect(await pending).toMatchObject({ ok: false, clicked: false });
  expect(clicked).not.toHaveBeenCalled();
});
it('reports a button timeout as definitely not clicked', async () => {
  const pending = executeSend(command, readSnapshot('d'));
  await vi.advanceTimersByTimeAsync(3_000);
  expect(await pending).toMatchObject({ ok: false, clicked: false });
});
it('leaves an unconfirmed click uncertain and does not click twice', async () => {
  const button = document.createElement('button');
  button.dataset.testid = 'send-button';
  button.type = 'button';
  document.querySelector('form')!.append(button);
  const clicked = vi.spyOn(button, 'click');
  const pending = executeSend(command, readSnapshot('d'));
  await vi.advanceTimersByTimeAsync(6_000);
  expect(await pending).toMatchObject({ ok: false, clicked: true });
  expect(clicked).toHaveBeenCalledTimes(1);
});
