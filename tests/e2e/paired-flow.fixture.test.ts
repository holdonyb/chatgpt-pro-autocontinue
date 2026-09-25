// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readSnapshot } from '../../src/content/chatgpt-adapter';
import { executeSend } from '../../src/content/editor';
import { loadState } from '../../src/background/store';
import { checkAlarm, continueFromCurrentAnswer, onObservation, start } from '../../src/background/coordinator';
import type { ContentCommand } from '../../src/shared/types';

// Captured from the real paired-turn DOM; all research text, URLs and IDs removed.
const pair = readFileSync('tests/fixtures/new-paired-turn.html', 'utf8');
let doc: string;
let clicks: number;
function completeAnswer() {
  document.querySelector('#turns')!.insertAdjacentHTML('beforeend', pair.replaceAll('u-live',`u-${clicks}`).replaceAll('a-live',`a-${clicks}`));
  document.querySelector('form button[data-testid]')?.remove();
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  doc='d1'; clicks=0;
  window.history.replaceState({},'', '/c/paired-test');
  document.body.innerHTML='<div id="turns"></div><form data-chatgpt-composer><div class="ProseMirror" contenteditable="true" role="textbox"><p></p></div><button type="button" data-codex-intelligence-trigger="true" aria-haspopup="menu"><span aria-hidden="true">思考强度</span>Pro</button></form>';
  completeAnswer();
  const form=document.querySelector('form')!;
  const editor=document.querySelector('.ProseMirror')!;
  editor.addEventListener('input',()=>{
    if(form.querySelector('[data-testid]')) return;
    const send=document.createElement('button'); send.type='button'; send.dataset.testid='send-button'; send.setAttribute('aria-label','发送提示词');
    send.addEventListener('click',()=>{
      clicks++;
      editor.textContent=''; send.remove();
      document.querySelector('#turns')!.insertAdjacentHTML('beforeend',`<div data-turn-key="pending-${clicks}"><div data-chatgpt-search-unit-key="new:user" data-chatgpt-search-message-ids="u-${clicks}">Continue</div></div>`);
      const stop=document.createElement('button'); stop.type='button'; stop.dataset.testid='stop-button'; stop.setAttribute('aria-label','停止生成'); form.append(stop);
    });
    form.append(send);
  });
  let storage: Record<string,unknown>={};
  vi.stubGlobal('chrome',{
    storage:{local:{get:vi.fn(async()=>structuredClone(storage)),set:vi.fn(async(value)=>{storage={...storage,...structuredClone(value)};})}},
    alarms:{create:vi.fn()},
    tabs:{sendMessage:vi.fn(async(_id:number,message:{type:string;command?:ContentCommand})=>message.type==='GET_SNAPSHOT'?readSnapshot(doc):message.type==='EXECUTE_SEND'?executeSend(message.command!,readSnapshot(doc)):{ok:true})}
  });
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

it('recognizes the sanitized real answer, ignoring the preceding user action bar',()=>{
  const page=readSnapshot(doc);
  expect(page).toMatchObject({finalSignal:true,busySignal:false,lastAssistantAnswerId:'a-0',lastUserTurnId:'u-0',modeFingerprint:'pro'});
  expect(page.completionDetail).toContain('actionStrips=2 eligibleStrips=1');
});

it('runs adapter, coordinator and guarded editor through two sends, refresh and final limit',async()=>{
  expect((await start(7,{type:'START',prompt:'Continue',maxSends:2,hours:8})).ok).toBe(true);
  await checkAlarm(); expect(clicks).toBe(0);
  await vi.advanceTimersByTimeAsync(11000);
  await checkAlarm(); expect(clicks).toBe(1);
  expect((await loadState()).task?.confirmedSends).toBe(1);
  for(let i=0;i<2;i++) await checkAlarm();
  expect(clicks).toBe(1);
  const deadline=(await loadState()).task?.deadlineAt;
  await vi.advanceTimersByTimeAsync(16000);
  completeAnswer();
  doc='d2';
  await onObservation({type:'PAGE_OBSERVATION',snapshot:readSnapshot(doc),source:'page-change'},{tabId:7,frameId:0});
  expect(clicks).toBe(1);
  expect((await loadState()).task?.deadlineAt).toBe(deadline);
  await vi.advanceTimersByTimeAsync(11000);
  await checkAlarm(); expect(clicks).toBe(2);
  expect((await loadState()).task?.confirmedSends).toBe(2);
  await vi.advanceTimersByTimeAsync(16000);
  completeAnswer(); await checkAlarm();
  await vi.advanceTimersByTimeAsync(11000); await checkAlarm();
  expect((await loadState()).task).toMatchObject({state:'FINISHED',pauseReason:'MAX_SENDS_REACHED',confirmedSends:2});
  await checkAlarm(); expect(clicks).toBe(2);
  expect((await loadState()).logs.filter(log=>log.event==='SEND_CLICK_REPORTED')).toHaveLength(2);
});

it('requires explicit recovery after a confirmed DOM send disappears on refresh, then clicks once through the normal editor', async () => {
  await start(7, { type: 'START', prompt: 'Continue', maxSends: 2, hours: 8 });
  await vi.advanceTimersByTimeAsync(11_000);
  await checkAlarm();
  expect(clicks).toBe(1);
  // A reloaded page exposes the prior completed answer, with the accepted turn absent.
  document.querySelector('[data-turn-key="pending-1"]')!.remove();
  document.querySelector('form [data-testid="stop-button"]')!.remove();
  doc = 'd2';
  await vi.advanceTimersByTimeAsync(16_000);
  await checkAlarm();
  await vi.advanceTimersByTimeAsync(11_000);
  await checkAlarm();
  expect(clicks).toBe(1);
  const task = (await loadState()).task!;
  expect(task).toMatchObject({ confirmedSends: 1, lastCompletedTurnId: 'u-1', consumedTurnIds: ['a-0'] });
  expect((await loadState()).logs.at(-1)?.detail).toContain('SUBMITTED_TURN_MISSING');
  expect(await continueFromCurrentAnswer({ type: 'CONTINUE_CURRENT', runId: task.runId, revision: task.revision, documentId: doc, answerId: 'a-0', userTurnId: 'u-0' })).toEqual({ ok: true });
  await checkAlarm(); expect(clicks).toBe(1);
  await vi.advanceTimersByTimeAsync(11_000);
  await checkAlarm();
  expect(clicks).toBe(2);
  expect((await loadState()).task).toMatchObject({ confirmedSends: 2, deadlineAt: task.deadlineAt, manualContinuation: null, consumedTurnIds: ['a-0', 'a-0'] });
  await vi.advanceTimersByTimeAsync(16_000);
  completeAnswer(); await checkAlarm();
  await vi.advanceTimersByTimeAsync(11_000); await checkAlarm();
  expect(clicks).toBe(2);
  expect((await loadState()).task).toMatchObject({ state: 'FINISHED', pauseReason: 'MAX_SENDS_REACHED' });
});
