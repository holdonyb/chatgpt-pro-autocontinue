// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

afterEach(async () => {
  vi.restoreAllMocks();
  if (typeof chrome !== 'undefined') (chrome.runtime as unknown as {id:string}).id='';
  await vi.advanceTimersByTimeAsync(2000);
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

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

it('coalesces mutation bursts without delaying explicit reads or starving continuous progress', async () => {
  vi.useFakeTimers(); vi.resetModules();
  document.body.innerHTML='<button>Pro</button><div data-message-author-role="assistant" data-message-id="a1">A</div>';
  let listener!: (message: unknown, sender: unknown, reply: (value: unknown) => void) => unknown;
  const publish=vi.fn(async()=>undefined);
  vi.stubGlobal('chrome',{runtime:{id:'test-extension',sendMessage:publish,onMessage:{addListener:(fn:typeof listener)=>{listener=fn;}}}});
  await import('../../src/content/index');
  expect(publish).toHaveBeenCalledTimes(1);
  const answer=document.querySelector('[data-message-id]')!;
  for(let burst=0;burst<3;burst++) {
    for(let i=0;i<5;i++) {
      answer.textContent=`Progress ${burst}:${i}`;
      await vi.advanceTimersByTimeAsync(40);
    }
    const reply=vi.fn(); listener({type:'GET_SNAPSHOT'},{},reply);
    expect(reply.mock.calls[0][0].answerFingerprint).toContain(`Progress ${burst}:4`);
    expect(publish).toHaveBeenCalledTimes(1+burst);
    await vi.advanceTimersByTimeAsync(51);
    expect(publish).toHaveBeenCalledTimes(2+burst);
  }
  (chrome.runtime as unknown as {id:string}).id='';
  await vi.advanceTimersByTimeAsync(2000);
});
