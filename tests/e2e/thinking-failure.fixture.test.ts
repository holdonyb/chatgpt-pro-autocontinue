// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readSnapshot } from '../../src/content/chatgpt-adapter';
import { canDispatch } from '../../src/core/guards';
import { createTask, reduceTask } from '../../src/core/reducer';
import { hasIndependentCompletionEvidence } from '../../src/core/completion';
import { executeSend } from '../../src/content/editor';

function fixture() {
  document.body.innerHTML = `<button>6 Pro</button>
    <section data-testid="conversation-turn-1" data-turn="assistant"><div data-message-author-role="assistant" data-message-id="old">Old answer<button aria-label="Copy">Copy</button></div></section>
    <section data-testid="conversation-turn-2" data-turn="user"><div data-message-author-role="user" data-message-id="u2">Continue</div></section>
    <section data-testid="conversation-turn-3" data-turn="assistant" data-turn-id="f1"><div><button type="button" aria-expanded="false">无法思考</button></div></section>
    <form><textarea></textarea><button type="submit" data-testid="send-button" aria-label="发送提示词">Send</button></form>`;
}

describe('explicit thinking failure recovery', () => {
  beforeEach(() => { window.history.pushState({}, '', '/c/c1'); fixture(); });
  it('uses the current failed turn as a deduplicated continuation source, never a completed answer', () => {
    const page = readSnapshot('d1');
    expect(page.thinkingFailure).toBe(true);
    expect(page.lastAssistantAnswerId).toBe('thinking-failure:u2:f1');
    expect(page.finalSignal).toBe(false);
    expect(page.terminalMarker).toBeNull();
    expect(hasIndependentCompletionEvidence(page)).toBe(false);
    const task = createTask({ conversationKey:'c1', branchFingerprint:'c1', documentId:'d1', tabId:1, modeFingerprint:'6 pro', prompt:'继续', maxSends:20, hours:8, now:0 });
    const first = reduceTask(task,{type:'OBSERVATION',snapshot:page,now:1});
    expect(canDispatch(first,page,1).ok).toBe(false);
    expect(canDispatch(first,page,11001).ok).toBe(true);
    expect(canDispatch({...first,consumedTurnIds:[page.lastAssistantAnswerId!]},page,11001).ok).toBe(false);
    expect(canDispatch(first,{...page,modeFingerprint:null,status:'UNKNOWN'},11001).ok).toBe(false);
    expect(canDispatch(first,{...page,editorEmpty:false},11001).ok).toBe(false);
    expect(canDispatch({...first,consecutiveThinkingFailures:3},page,11001)).toEqual({ok:false,reason:'ERROR_ON_PAGE'});
  });
  it.each(['hidden','nested','history','busy','missing-id','later-turn','prose','tool-title','completed'])('ignores invalid failure evidence: %s', kind => {
    const turn = document.querySelector('[data-turn-id="f1"]')!;
    if (kind==='hidden') turn.setAttribute('hidden','');
    if (kind==='nested') turn.innerHTML='<div data-message-author-role="assistant" data-message-id="a2"><button aria-expanded="false">无法思考</button></div>';
    if (kind==='history') document.body.append(document.querySelector('[data-turn="user"]')!);
    if (kind==='busy') document.querySelector('form')!.insertAdjacentHTML('beforeend','<button data-testid="stop-button">Stop</button>');
    if (kind==='missing-id') turn.removeAttribute('data-turn-id');
    if (kind==='later-turn') turn.insertAdjacentHTML('afterend','<section data-testid="conversation-turn-4" data-turn="assistant"><p>Still working</p></section>');
    if (kind==='prose') turn.innerHTML='<p>无法思考</p>';
    if (kind==='tool-title') turn.insertAdjacentHTML('afterbegin','<button aria-expanded="true">思考中</button>');
    if (kind==='completed') turn.insertAdjacentHTML('beforeend','<div data-message-author-role="assistant" data-message-id="a2" data-is-streaming="false">Completed answer</div>');
    expect(readSnapshot('d1').thinkingFailure).toBe(false);
  });
  it('sends once through the normal send control and confirms the new user turn', async () => {
    let clicks=0;
    document.querySelector('form')!.addEventListener('submit',event=>event.preventDefault());
    document.querySelector('[data-testid="send-button"]')!.addEventListener('click',()=>{
      clicks++;
      document.querySelector('textarea')!.value='';
      document.querySelector('[data-turn-id="f1"]')!.insertAdjacentHTML('afterend','<div data-message-author-role="user" data-message-id="u3">继续</div>');
    });
    const page=readSnapshot('d1');
    const result=await executeSend({type:'EXECUTE_SEND',runId:'r1',revision:1,attemptId:'x',expiresAt:Date.now()+20000,expectedConversationKey:'c1',expectedDocumentId:'d1',expectedParentTurnId:page.lastAssistantAnswerId!,prompt:'继续'},page);
    expect(result.ok).toBe(true);
    expect(clicks).toBe(1);
  });
});
