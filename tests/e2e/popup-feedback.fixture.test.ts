// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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
