// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTask } from '../../src/core/reducer';
import type { PageSnapshot } from '../../src/shared/types';

let startAllowed = false;
beforeEach(async () => {
  vi.useFakeTimers();
  startAllowed = false;
  document.body.innerHTML = readFileSync('extension/popup.html', 'utf8');
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async (message: { type: string }) => {
    if (message.type === 'START') return startAllowed ? { ok: true } : { ok: false, error: '当前回答尚未完成，请等待页面回到可确认状态。' };
    if (message.type === 'GET_STATUS') return { state: { state: 'STOPPED', pauseReason: 'USER_REQUESTED', conversationKey: 'c1', confirmedSends: 2, maxSends: 30 }, logs: [] };
    return { snapshot: { modeLabel: 'Pro' } };
  }) } });
  vi.resetModules();
  await import('../../src/popup/index');
  await vi.advanceTimersByTimeAsync(0);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('keeps start rejection visible across polling while the old task is stopped', async () => {
  document.getElementById('start')!.click();
  await vi.advanceTimersByTimeAsync(3_000);
  expect(document.getElementById('actionError')!.hidden).toBe(false);
  expect(document.getElementById('actionError')!.textContent).toContain('当前回答尚未完成');
  expect(document.getElementById('status')!.textContent).toContain('已停止');
});

it('clears the previous action error after a successful retry', async () => {
  document.getElementById('start')!.click();
  await vi.advanceTimersByTimeAsync(0);
  startAllowed = true;
  document.getElementById('start')!.click();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(document.getElementById('actionError')!.hidden).toBe(true);
});
it('does not accumulate page queries when a page response never arrives', async () => {
  const send = vi.mocked(chrome.runtime.sendMessage);
  send.mockImplementation(async (message: any) => message.type === 'GET_PAGE_INFO' ? new Promise(() => undefined) : { state: null, logs: [] });
  send.mockClear();
  await vi.advanceTimersByTimeAsync(4_000);
  expect(send.mock.calls.filter(call => (call[0] as unknown as { type: string }).type === 'GET_PAGE_INFO')).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(4_000);
  expect(send.mock.calls.filter(call => (call[0] as unknown as { type: string }).type === 'GET_PAGE_INFO')).toHaveLength(2);
});
it('shows saved run settings instead of unrelated default inputs', async () => {
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(async (message: any) => message.type === 'GET_STATUS'
    ? { state: { runId: 'real-run', state: 'PAUSED', pauseReason: 'SEND_UNCERTAIN', conversationKey: 'c1', prompt: 'saved instruction', confirmedSends: 2, maxSends: 30, startedAt: 0, deadlineAt: 7_200_000, staleRefreshMs: 180_000 }, logs: [] }
    : { snapshot: { modeLabel: 'Pro' } });
  await vi.advanceTimersByTimeAsync(1_000);
  expect((document.getElementById('maxSends') as HTMLInputElement).value).toBe('30');
  expect((document.getElementById('hours') as HTMLInputElement).value).toBe('2');
  expect((document.getElementById('prompt') as HTMLInputElement).disabled).toBe(true);
});

function missingTurnStatus() {
  const task = createTask({ conversationKey: 'c1', branchFingerprint: 'c1', tabId: 7, documentId: 'd1', modeFingerprint: 'pro', prompt: '继续', maxSends: 20, hours: 8, now: Date.now() - 60_000 });
  task.confirmedSends = 7;
  task.consumedTurnIds = ['a0', 'a1'];
  task.lastCompletedTurnId = 'u2';
  const page: PageSnapshot = {
    conversationKey: 'c1', branchFingerprint: 'c1', documentId: 'd1', url: 'https://chatgpt.com/c/c1', modeFingerprint: 'pro', modeLabel: 'Pro', status: 'READY',
    lastMessageRole: 'assistant', lastUserTurnId: 'u1', lastAssistantAnswerId: 'a1', answerFingerprint: 'a1:complete',
    finalSignal: true, busySignal: false, errorSignal: false, editorEmpty: true, hasPendingAttachment: false, observedAt: Date.now()
  };
  return { task, page };
}

it('explains the history mismatch, requests only one explicit continuation and keeps the saved budget', async () => {
  const { task, page } = missingTurnStatus();
  let complete: (value: unknown) => void = () => undefined;
  const send = vi.mocked(chrome.runtime.sendMessage);
  send.mockImplementation(async (message: any) => {
    if (message.type === 'GET_STATUS') return { state: task, logs: [] };
    if (message.type === 'GET_PAGE_INFO') return { snapshot: page };
    return new Promise(resolve => { complete = resolve; });
  });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(document.getElementById('reason')!.textContent).toContain('当前回答已完成');
  expect(document.getElementById('reason')!.textContent).toContain('上次续发的消息未在页面显示');
  expect(document.getElementById('missingTurnRecovery')!.hidden).toBe(false);
  expect(document.getElementById('status')!.textContent).toContain('7/20');
  document.getElementById('continueCurrent')!.click();
  document.getElementById('continueCurrent')!.click();
  await vi.advanceTimersByTimeAsync(1_000);
  const requests = send.mock.calls.filter(call => (call[0] as any).type === 'CONTINUE_CURRENT');
  expect(requests).toHaveLength(1);
  expect(requests[0][0]).toEqual({ type: 'CONTINUE_CURRENT', runId: task.runId, revision: task.revision, answerId: 'a1', userTurnId: 'u1', documentId: 'd1' });
  expect((document.getElementById('continueCurrent') as HTMLButtonElement).disabled).toBe(true);
  task.manualContinuation = { answerId: 'a1', userTurnId: 'u1', documentId: 'd1' };
  complete({ ok: true });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(document.getElementById('missingTurnRecovery')!.hidden).toBe(true);
  expect(document.getElementById('reason')!.textContent).toContain('正在核对页面稳定性');
  expect(document.getElementById('status')!.textContent).toContain('7/20');
});

it.each(['draft', 'busy', 'error', 'foreign-document', 'foreign-conversation', 'reload', 'uncertain', 'stopped', 'expired', 'limit'])('hides the explicit recovery action for %s', async kind => {
  const { task, page } = missingTurnStatus();
  if (kind === 'draft') page.editorEmpty = false;
  if (kind === 'busy') page.busySignal = true;
  if (kind === 'error') page.errorSignal = true;
  if (kind === 'foreign-document') page.documentId = 'other';
  if (kind === 'foreign-conversation') page.conversationKey = 'other';
  if (kind === 'reload') task.controlledReloadAt = Date.now();
  if (kind === 'uncertain') { task.state = 'PAUSED'; task.pauseReason = 'SEND_UNCERTAIN'; }
  if (kind === 'stopped') task.state = 'STOPPED';
  if (kind === 'expired') task.deadlineAt = Date.now() - 1;
  if (kind === 'limit') task.maxSends = task.confirmedSends;
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(async (message: any) => message.type === 'GET_STATUS' ? { state: task, logs: [] } : { snapshot: page });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(document.getElementById('missingTurnRecovery')!.hidden).toBe(true);
});
