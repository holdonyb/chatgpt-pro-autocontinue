import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTask } from '../../src/core/reducer';
import { loadState, saveState } from '../../src/background/store';
import type { PageSnapshot } from '../../src/shared/types';

const snapshot = (overrides: Partial<PageSnapshot> = {}): PageSnapshot => ({
  conversationKey: 'c1', url: 'https://chatgpt.com/c/c1', documentId: 'd1',
  branchFingerprint: 'c1', modeFingerprint: 'pro', modeLabel: 'Pro', status: 'READY',
  lastMessageRole: 'assistant', lastUserTurnId: 'u2', lastAssistantAnswerId: 'a2',
  answerFingerprint: 'a2:complete', finalSignal: true, busySignal: false, errorSignal: false,
  editorEmpty: true, hasPendingAttachment: false, observedAt: Date.now(), ...overrides
});

let messageListener: (message: unknown, sender: chrome.runtime.MessageSender, reply: (value: unknown) => void) => unknown;
let updateListener: (id: number, change: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void;
let sendMessage: ReturnType<typeof vi.fn>;
let currentPage: PageSnapshot;
const sends = () => sendMessage.mock.calls.filter(call => call[1]?.type === 'EXECUTE_SEND');

async function observe(page = snapshot(), tabId: number | undefined = 7, frameId = 0) {
  await new Promise(resolve => messageListener({ type: 'PAGE_OBSERVATION', snapshot: page, source: 'page-change' },
    { tab: tabId === undefined ? undefined : { id: tabId } as chrome.tabs.Tab, frameId }, resolve));
}
async function navigate(tabId: number, url: string) {
  updateListener(tabId, { url }, { id: tabId } as chrome.tabs.Tab);
  const { serialized } = await import('../../src/background/coordinator');
  await serialized(async () => undefined);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  let storage: Record<string, unknown> = {};
  const event = () => ({ addListener: vi.fn() });
  currentPage = snapshot();
  sendMessage = vi.fn(async (_tabId: number, command: { type: string }) => command.type === 'GET_SNAPSHOT'
    ? structuredClone(currentPage) : { ok: true, acceptedBy: 'busy', userMessageId: 'u3' });
  vi.stubGlobal('chrome', {
    storage: { local: {
      get: vi.fn(async () => structuredClone(storage)),
      set: vi.fn(async (data: Record<string, unknown>) => { storage = { ...storage, ...structuredClone(data) }; })
    } },
    runtime: { onStartup: event(), onInstalled: event(), onMessage: { addListener: (fn: typeof messageListener) => { messageListener = fn; } } },
    alarms: { create: vi.fn(), onAlarm: event() },
    tabs: { sendMessage, onRemoved: event(), onUpdated: { addListener: (fn: typeof updateListener) => { updateListener = fn; } } }
  });
  // Re-evaluate the real listener wiring for each Chrome mock.
  vi.resetModules();
  await import('../../src/background/index');
  const task = createTask({ conversationKey: 'c1', branchFingerprint: 'c1', tabId: 7, documentId: 'd1', modeFingerprint: 'pro', prompt: '继续', maxSends: 30, hours: 8, now: 0 });
  task.confirmedSends = 2;
  task.consumedTurnIds = ['a0', 'a1'];
  task.lastAnswerFingerprint = 'a2:complete';
  task.stableSince = 80_000;
  await saveState({ task, logs: [] });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('background observation ownership', () => {
  it('refreshes again after a reload leaves only the consumed answer, then continues on a new answer', async () => {
    const state = await loadState();
    state.task!.lastCompletedTurnId = 'u2';
    state.task!.consumedTurnIds.push('a2');
    await saveState(state);
    chrome.tabs.reload = vi.fn(async () => undefined);
    const { checkAlarm } = await import('../../src/background/coordinator');
    currentPage = snapshot({ status: 'BUSY', busySignal: true, finalSignal: false, lastMessageRole: 'user' });
    vi.setSystemTime(1_000_000);
    await checkAlarm();
    expect(chrome.tabs.reload).toHaveBeenCalledTimes(1);
    currentPage = snapshot({ documentId: 'refresh', lastMessageRole: 'user', terminalMarker: 'DONE' });
    await observe(currentPage);
    expect((await loadState()).task?.state).toBe('WAITING_ANSWER');
    vi.setSystemTime(Date.now() + 900_001);
    await checkAlarm();
    expect(chrome.tabs.reload).toHaveBeenCalledTimes(2);
    expect(sends()).toHaveLength(0);
    currentPage = snapshot({ documentId: 'refresh-2', lastAssistantAnswerId: 'a3', answerFingerprint: 'a3:complete' });
    await observe(currentPage);
    vi.setSystemTime(Date.now() + 11_000);
    await checkAlarm();
    expect(sends()).toHaveLength(1);
    expect((await loadState()).task?.confirmedSends).toBe(3);
  });
  it.each(['DONE', 'NEEDS_USER'] as const)('ignores another tab even with %s, then sends round three on the bound tab', async terminalMarker => {
    const before = (await loadState()).task;
    await observe(snapshot({ conversationKey: 'other', documentId: 'other-doc', terminalMarker }), 8);
    expect((await loadState()).task).toEqual(before);
    expect((await loadState()).logs.at(-1)?.detail).toContain('tab=8 frame=0 boundTab=7');
    expect(sendMessage).not.toHaveBeenCalled();
    await observe();
    expect((await loadState()).task?.confirmedSends).toBe(3);
    expect((await loadState()).task?.state).toBe('WAITING_ANSWER');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0]).toBe(7);
  });

  it('ignores a duplicate conversation tab, a subframe, missing sender and an obsolete document', async () => {
    const before = (await loadState()).task;
    await observe(snapshot(), 8);
    await observe(snapshot(), 7, 2);
    await new Promise(resolve => messageListener({ type: 'PAGE_OBSERVATION', snapshot: snapshot() }, {}, resolve));
    await observe(snapshot({ documentId: 'old-doc', terminalMarker: 'DONE' }));
    expect((await loadState()).task).toEqual(before);
    expect(sends()).toHaveLength(0);
  });

  it('pauses genuine conversation navigation before processing its completion marker', async () => {
    await observe(snapshot({ conversationKey: 'other', terminalMarker: 'DONE' }));
    expect((await loadState()).task?.pauseReason).toBe('CONVERSATION_CHANGED');
    expect((await loadState()).task?.state).toBe('PAUSED');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('allows controlled document rebind only from the bound top-level tab', async () => {
    const state = await loadState();
    state.task!.controlledReloadAt = 99_000;
    await saveState(state);
    const page = snapshot({ documentId: 'new-doc', status: 'BUSY', busySignal: true, finalSignal: false });
    currentPage = page;
    await observe(page, 8);
    expect((await loadState()).task?.boundDocumentId).toBe('d1');
    await observe(page);
    expect((await loadState()).task?.boundDocumentId).toBe('new-doc');
    expect((await loadState()).task?.controlledReloadAt).toBeNull();
    expect((await loadState()).task?.confirmedSends).toBe(2);
    expect(sends()).toHaveLength(0);
  });

  it('ignores URL changes in other tabs and hash/query changes in the bound conversation', async () => {
    const before = (await loadState()).task;
    await navigate(8, 'https://chatgpt.com/c/other');
    await navigate(7, 'https://chatgpt.com/c/c1?model=pro#latest');
    expect((await loadState()).task).toEqual(before);
  });

  it('still pauses genuine bound-tab navigation during a controlled reload', async () => {
    const state = await loadState();
    state.task!.controlledReloadAt = 99_000;
    await saveState(state);
    await navigate(7, 'https://chatgpt.com/c/other');
    expect((await loadState()).task?.pauseReason).toBe('CONVERSATION_CHANGED');
  });

  it('preserves the budget across repeated manual refreshes and sends only after fresh stability', async () => {
    const before = (await loadState()).task!;
    for (const documentId of ['refresh-1', 'refresh-2']) {
      currentPage = snapshot({ documentId });
      await observe(currentPage);
      const task = (await loadState()).task!;
      expect(task.boundDocumentId).toBe(documentId);
      expect(task.runId).toBe(before.runId);
      expect(task.deadlineAt).toBe(before.deadlineAt);
      expect(task.maxSends).toBe(30);
      expect(task.confirmedSends).toBe(2);
      expect(task.consumedTurnIds).toEqual(before.consumedTurnIds);
      expect(sends()).toHaveLength(0);
      vi.setSystemTime(Date.now() + 5_000);
    }
    vi.setSystemTime(Date.now() + 6_000);
    await observe(currentPage);
    await observe(currentPage);
    expect((await loadState()).task?.confirmedSends).toBe(3);
    expect(sends()).toHaveLength(1);
    expect(sends()[0][1].command.expectedDocumentId).toBe('refresh-2');
  });

  it('ignores late old documents after rebinding without reverting to the old page', async () => {
    currentPage = snapshot({ documentId: 'refresh' });
    await observe(currentPage);
    const task = (await loadState()).task;
    await observe(snapshot({ terminalMarker: 'DONE' }));
    expect((await loadState()).task).toEqual(task);
    expect((await loadState()).logs.at(-1)?.event).toBe('OBSERVATION_IGNORED_DOCUMENT');
    expect(sends()).toHaveLength(0);
  });

  it('waits for identity during refresh, then resumes while the answer is still busy', async () => {
    currentPage = snapshot({ documentId: 'refresh', status: 'UNKNOWN', conversationKey: null, branchFingerprint: null, modeFingerprint: null });
    await observe(currentPage);
    expect((await loadState()).task?.state).toBe('WAITING_ANSWER');
    expect((await loadState()).task?.boundDocumentId).toBe('d1');
    currentPage = snapshot({ documentId: 'refresh', status: 'BUSY', busySignal: true, finalSignal: false });
    await observe(currentPage);
    expect((await loadState()).task?.boundDocumentId).toBe('refresh');
    expect((await loadState()).task?.confirmedSends).toBe(2);
    expect(sends()).toHaveLength(0);
  });

  it.each([
    ['conversationKey', 'CONVERSATION_CHANGED'], ['branchFingerprint', 'BRANCH_CHANGED'], ['modeFingerprint', 'MODE_CHANGED']
  ] as const)('rejects changed %s on a fresh document', async (field, reason) => {
    currentPage = snapshot({ documentId: 'refresh', [field]: 'other', terminalMarker: 'DONE' });
    await observe(currentPage);
    expect((await loadState()).task?.pauseReason).toBe(reason);
    expect((await loadState()).task?.boundDocumentId).toBe('d1');
    expect(sends()).toHaveLength(0);
  });

  it('keeps a paused task paused on refresh, and rebinds immediately when the user resumes', async () => {
    const state = await loadState();
    state.task!.state = 'PAUSED';
    state.task!.pauseReason = 'CONVERSATION_CHANGED';
    await saveState(state);
    currentPage = snapshot({ documentId: 'refresh' });
    await observe(currentPage);
    expect((await loadState()).task?.state).toBe('PAUSED');
    await new Promise(resolve => messageListener({ type: 'RESUME' }, {}, resolve));
    expect((await loadState()).task?.state).toBe('WAITING_ANSWER');
    expect((await loadState()).task?.boundDocumentId).toBe('refresh');
    expect((await loadState()).task?.confirmedSends).toBe(2);
    expect(sends()).toHaveLength(0);
  });

  it('does not resend or count an unresolved send across a refresh or resume', async () => {
    const state = await loadState();
    state.task!.state = 'VERIFYING_SUBMIT';
    state.task!.pendingAttempt = { attemptId: 'pending', sourceAnswerId: 'a2', expectedParentTurnId: 'a2', previousUserTurnId: 'u2', promptDigest: 'x', phase: 'COMMAND_SENT', createdAt: Date.now(), confirmedUserMessageId: null };
    await saveState(state);
    currentPage = snapshot({ documentId: 'refresh', lastUserTurnId: 'u3' });
    await observe(currentPage);
    await new Promise(resolve => messageListener({ type: 'RESUME' }, {}, resolve));
    expect((await loadState()).task?.pauseReason).toBe('SEND_UNCERTAIN');
    expect((await loadState()).task?.pendingAttempt?.attemptId).toBe('pending');
    expect((await loadState()).task?.confirmedSends).toBe(2);
    expect(sends()).toHaveLength(0);
  });

  it('recovers from persisted state via the periodic check without replaying a consumed answer', async () => {
    const state = await loadState();
    state.task!.consumedTurnIds.push('a2');
    await saveState(state);
    currentPage = snapshot({ documentId: 'refresh' });
    const { checkAlarm } = await import('../../src/background/coordinator');
    await checkAlarm();
    vi.setSystemTime(Date.now() + 20_000);
    await checkAlarm();
    expect((await loadState()).task?.boundDocumentId).toBe('refresh');
    expect((await loadState()).task?.confirmedSends).toBe(2);
    expect(sends()).toHaveLength(0);
  });

  it('retains the original deadline after a refresh', async () => {
    const state = await loadState();
    state.task!.deadlineAt = Date.now() - 1;
    await saveState(state);
    currentPage = snapshot({ documentId: 'refresh' });
    await observe(currentPage);
    expect((await loadState()).task?.pauseReason).toBe('DEADLINE_REACHED');
    expect((await loadState()).task?.state).toBe('FINISHED');
    expect(sends()).toHaveLength(0);
  });

  it('records a rejected draft start without hiding it behind the old stopped task', async () => {
    const state = await loadState();
    state.task!.state = 'STOPPED';
    state.task!.pauseReason = 'USER_REQUESTED';
    await saveState(state);
    currentPage = snapshot({ editorEmpty: false });
    const result = await new Promise<any>(resolve => messageListener({ type: 'START', prompt: '继续', maxSends: 3, hours: 8 }, { tab: { id: 7 } as chrome.tabs.Tab }, resolve));
    expect(result.ok).toBe(false);
    expect((await loadState()).task).toEqual(state.task);
    expect((await loadState()).logs.at(-1)?.event).toBe('START_REJECTED');
    expect((await loadState()).logs.at(-1)?.detail).toContain(result.error);
    expect(sends()).toHaveLength(0);
  });

  it.each([true, false])('starts waiting for an existing user turn with busy=%s without sending early', async busy => {
    currentPage = snapshot({ status: busy ? 'BUSY' : 'READY', busySignal: busy, finalSignal: false, lastMessageRole: 'user' });
    const result = await new Promise<any>(resolve => messageListener({ type: 'START', prompt: '继续', maxSends: 3, hours: 8 }, { tab: { id: 7 } as chrome.tabs.Tab }, resolve));
    expect(result.ok).toBe(true);
    expect((await loadState()).task?.confirmedSends).toBe(0);
    await observe(currentPage);
    vi.setSystemTime(Date.now() + 11_000);
    await observe(currentPage);
    expect(sends()).toHaveLength(0);
    currentPage = snapshot({ lastAssistantAnswerId: 'new-answer', answerFingerprint: 'new:complete' });
    await observe(currentPage);
    vi.setSystemTime(Date.now() + 11_000);
    await observe(currentPage);
    expect(sends()).toHaveLength(1);
    expect((await loadState()).task?.confirmedSends).toBe(1);
  });
});
