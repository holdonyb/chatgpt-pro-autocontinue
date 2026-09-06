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
