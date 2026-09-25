// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { readSnapshot } from '../../src/content/chatgpt-adapter';
import { createTask, reduceTask } from '../../src/core/reducer';
import { canDispatch } from '../../src/core/guards';

beforeEach(() => {
  window.history.replaceState({}, '', '/c/new-layout');
  document.body.innerHTML = `<div data-turn-key="u1">
    <div data-chatgpt-search-unit-key="fallback-turn-0:0:user" data-chatgpt-search-message-ids="u1">Continue</div>
    <div><span hidden data-chatgpt-agent-turn-start></span><div class="group/activity-header">
      <button type="button" aria-labelledby="failure-label" aria-expanded="false"></button><span id="failure-label">无法思考</span>
    </div></div>
  </div>
  <form data-chatgpt-composer><div class="ProseMirror" contenteditable="true" role="textbox"></div>
    <button type="button" aria-label="选择 ChatGPT 模型" aria-haspopup="menu" data-codex-intelligence-trigger="true"><span aria-hidden="true">思考强度</span><span>Pro</span></button>
  </form>`;
});

it('reads only the displayed model and the current failed turn in the new layout', () => {
  const page=readSnapshot('d');
  expect(page.modeFingerprint).toBe('pro');
  expect(page.modeDetail).toContain('scope=composer');
  expect(page.lastUserTurnId).toBe('u1');
  expect(page.thinkingFailure).toBe(true);
  expect(page.lastAssistantAnswerId).toBe('thinking-failure:u1:u1');
  expect(page.finalSignal).toBe(false);
});
it.each(['hidden','style="display:none"','style="visibility:hidden"'])('ignores model measurement text with %s',attr => {
  document.querySelector('form button')!.innerHTML=`<span ${attr}>思考强度</span><span>Pro</span>`;
  expect(readSnapshot('d').modeFingerprint).toBe('pro');
});
it('does not extract Pro from a visible non-Pro label or hidden Pro badge', () => {
  document.querySelector('form button')!.innerHTML='<span hidden>Pro</span><span>Thinking</span>';
  expect(readSnapshot('d').modeFingerprint).toBeNull();
});
it('excludes new message-body model examples', () => {
  document.querySelector('[data-turn-key]')!.insertAdjacentHTML('beforeend','<div data-chatgpt-search-unit-key="x:assistant" data-chatgpt-search-message-ids="a1"><button data-testid="model-example">7 Pro</button></div>');
  expect(readSnapshot('d').modeFingerprint).toBe('pro');
});
it('recognizes a completed response with stable message ID and its own action strip', () => {
  document.querySelector('.group\\/activity-header')!.remove();
  document.querySelector('[data-turn-key]')!.insertAdjacentHTML('beforeend',`<div data-chatgpt-search-unit-key="fallback-turn-0:3:assistant" data-chatgpt-search-message-ids="a1 a1"><div data-markdown-text-style="assistant-message">Completed</div></div><div class="turn-action-controls"><button aria-label="复制"></button><button aria-label="重新生成回复"></button></div>`);
  const page=readSnapshot('d');
  expect(page.lastAssistantAnswerId).toBe('a1');
  expect(page.lastMessageRole).toBe('assistant');
  expect(page.finalSignal).toBe(true);
  expect(page.thinkingFailure).toBe(false);
  document.querySelector('[data-chatgpt-search-unit-key$="assistant"]')!.setAttribute('data-chatgpt-search-message-ids','a1 a2');
  expect(readSnapshot('d').finalSignal).toBe(false);
});
it('ignores a quoted failure label and a failure from a previous user turn', () => {
  const header=document.querySelector('.group\\/activity-header')!;
  header.setAttribute('data-chatgpt-search-unit-key','x:assistant');
  header.setAttribute('data-chatgpt-search-message-ids','a1');
  expect(readSnapshot('d').thinkingFailure).toBe(false);
  header.removeAttribute('data-chatgpt-search-unit-key');
  header.removeAttribute('data-chatgpt-search-message-ids');
  document.querySelector('[data-turn-key]')!.insertAdjacentHTML('afterend','<div data-turn-key="u2"><div data-chatgpt-search-unit-key="x:user" data-chatgpt-search-message-ids="u2">Next</div></div>');
  expect(readSnapshot('d').thinkingFailure).toBe(false);
});
it('records current process progress while real stop controls prevent continuation', () => {
  const first=readSnapshot('d');
  document.querySelector('[data-chatgpt-agent-turn-start]')!.parentElement!.insertAdjacentHTML('beforeend','<p>More progress</p>');
  expect(readSnapshot('d').activityFingerprint).not.toBe(first.activityFingerprint);
  document.querySelector('form')!.insertAdjacentHTML('beforeend','<button aria-label="停止生成"></button>');
  expect(readSnapshot('d').thinkingFailure).toBe(false);
  expect(readSnapshot('d').busySignal).toBe(true);
});
it('does not resend a consumed thinking failure when its UI layout changes', () => {
  const page=readSnapshot('d');
  let task=createTask({conversationKey:'new-layout',branchFingerprint:'new-layout',tabId:1,documentId:'d',modeFingerprint:'pro',prompt:'继续',maxSends:20,hours:8,now:0});
  task=reduceTask(task,{type:'OBSERVATION',snapshot:page,now:1});
  task.consumedTurnIds=['thinking-failure:u1:old-layout-failure-id'];
  expect(canDispatch(task,page,11001)).toEqual({ok:false,reason:'ANSWER_NOT_COMPLETE'});
});

function completedPair() {
  const pair=document.querySelector('[data-turn-key]')!;
  pair.innerHTML=`<div data-chatgpt-search-unit-key="x:user" data-chatgpt-search-message-ids="u1">Continue
    <div class="turn-action-controls"><button aria-label="复制消息"></button><button aria-label="编辑消息"></button></div></div>
    <div data-chatgpt-search-unit-key="x:assistant" data-chatgpt-search-message-ids="a1 a1"><div data-markdown-text-style="assistant-message">Complete</div></div>
    <div class="turn-action-controls" id="answer-actions"><button aria-label="复制"></button><button aria-label="重新生成回复"></button></div>`;
  return pair;
}
it('finds the assistant actions after the user action strip in the real paired layout', () => {
  completedPair();
  expect(readSnapshot('d').finalSignal).toBe(true);
});
it.each(['historical','before-answer','inside-answer','hidden','split-strips'])('rejects unrelated completion controls: %s',kind => {
  const pair=completedPair();
  const actions=document.querySelector('#answer-actions')!;
  const assistant=pair.querySelector('[data-chatgpt-search-unit-key$=":assistant"]')!;
  if(kind==='historical') pair.insertAdjacentElement('beforebegin',actions);
  if(kind==='before-answer') assistant.insertAdjacentElement('beforebegin',actions);
  if(kind==='inside-answer') assistant.append(actions);
  if(kind==='hidden') actions.setAttribute('hidden','');
  if(kind==='split-strips') {
    const second=document.createElement('div'); second.className='turn-action-controls';
    second.append(actions.lastElementChild!); pair.append(second);
  }
  expect(readSnapshot('d').finalSignal).toBe(false);
});
it('does not mistake an earlier assistant segment for a completed latest segment', () => {
  const pair=completedPair();
  pair.insertAdjacentHTML('beforeend','<div data-chatgpt-search-unit-key="x:4:assistant" data-chatgpt-search-message-ids="a2">Still generating</div>');
  expect(readSnapshot('d').finalSignal).toBe(false);
});
it('keeps stop-control precedence over completed actions and waits for stable evidence', () => {
  completedPair();
  const stop=document.createElement('button'); stop.setAttribute('aria-label','停止生成'); document.querySelector('form')!.append(stop);
  expect(readSnapshot('d').finalSignal).toBe(false);
  stop.remove();
  const page=readSnapshot('d');
  let task=createTask({conversationKey:'new-layout',branchFingerprint:'new-layout',tabId:1,documentId:'d',modeFingerprint:'pro',prompt:'继续',maxSends:20,hours:8,now:0});
  task=reduceTask(task,{type:'OBSERVATION',snapshot:page,now:1});
  expect(canDispatch(task,page,2).ok).toBe(false);
  expect(canDispatch(task,page,11001).ok).toBe(true);
});
