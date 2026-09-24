// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('reports a DOM read exception to the background without returning private exception text', async () => {
  vi.useFakeTimers();
  let listener!: (message: unknown, sender: unknown, reply: (value: unknown) => void) => unknown;
  vi.stubGlobal('chrome', { runtime: {
    id: 'test-extension', sendMessage: vi.fn(async () => undefined),
    onMessage: { addListener: (fn: typeof listener) => { listener = fn; } }
  } });
  await import('../../src/content/index');
  vi.spyOn(document, 'querySelector').mockImplementationOnce(() => { throw new Error('private research text'); });
  const reply = vi.fn();
  expect(listener({ type: 'GET_SNAPSHOT' }, {}, reply)).toBe(false);
  expect(reply).toHaveBeenCalledWith({ ok: false, errorCode: 'SNAPSHOT_EXCEPTION' });
  // Stop the module's observer through its existing invalidation cleanup.
  (chrome.runtime as unknown as { id: string }).id = '';
  await vi.advanceTimersByTimeAsync(2_000);
});
