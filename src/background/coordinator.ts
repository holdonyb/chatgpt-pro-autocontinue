import type { ContentCommand, PageObservationRequest, PageSnapshot, PauseReason, StartRequest, TaskRecord } from '../shared/types';
import { canDispatch, shouldRefreshStaleBusy } from '../core/guards';
import { hasIndependentCompletionEvidence, isStableCompletion } from '../core/completion';
import { createTask, reduceTask } from '../core/reducer';
import { addLog, loadState, saveState } from './store';

export const STABILITY_ALARM_PREFIX = 'chatgpt-pro-autocontinue/stability/';

let queue = Promise.resolve();
export function serialized<T>(work: () => Promise<T>): Promise<T> { const result = queue.then(work, work); queue = result.then(() => undefined, () => undefined); return result; }

function short(value: string | null | undefined): string { return value ? value.slice(0, 12) : '-'; }
function snapshotDetail(snapshot: PageSnapshot, task: TaskRecord | null, source = 'unknown', now = Date.now()): string {
  const stableMs = task?.stableSince === null || task?.stableSince === undefined ? 0 : Math.max(0, now - task.stableSince);
  return `source=${source} status=${snapshot.status} final=${snapshot.finalSignal} busy=${snapshot.busySignal} error=${snapshot.errorSignal} editorEmpty=${snapshot.editorEmpty} attachment=${snapshot.hasPendingAttachment} role=${snapshot.lastMessageRole} assistant=${short(snapshot.lastAssistantAnswerId)} user=${short(snapshot.lastUserTurnId)} branch=${short(snapshot.branchFingerprint)} mode=${snapshot.modeFingerprint ?? '-'} stableMs=${stableMs}${snapshot.completionDetail ? ` completion=[${snapshot.completionDetail}]` : ''}`;
}

async function observeTab(tabId: number): Promise<PageSnapshot | null> {
  try { return await chrome.tabs.sendMessage(tabId, { type: 'GET_SNAPSHOT' }, { frameId: 0 }); } catch { return null; }
}

export async function start(tabId: number, request: StartRequest): Promise<{ ok: boolean; state?: TaskRecord; error?: string }> {
  async function reject(error: string, snapshot?: PageSnapshot | null) {
    const state = await loadState();
    await saveState(addLog(state, 'START_REJECTED', state.task, Date.now(), `tab=${tabId} error=${error}${snapshot ? ` ${snapshotDetail(snapshot, null, 'start-rejected')}` : ''}`));
    return { ok: false, error };
  }
  if (!request.prompt.trim()) return reject('请输入续研指令。');
  if (!Number.isFinite(request.maxSends) || request.maxSends < 1 || !Number.isFinite(request.hours) || request.hours <= 0 || !Number.isFinite(request.staleRefreshMinutes ?? 15) || (request.staleRefreshMinutes ?? 15) < 2) return reject('轮数、时长和卡住刷新时间必须是有效数值；刷新时间至少 2 分钟。');
  const snapshot = await observeTab(tabId);
  if (!snapshot) return reject('无法连接目标页面，请刷新该页面后再试。');
  if (!snapshot.conversationKey || !snapshot.branchFingerprint || !snapshot.modeFingerprint) return reject('当前页面缺少可确认的对话、分支或 Pro 模式标志，已拒绝启动。', snapshot);
  if (snapshot.errorSignal) return reject('页面报告错误，请先处理后再启动。', snapshot);
  if (!snapshot.editorEmpty || snapshot.hasPendingAttachment) return reject('输入框有草稿或附件，请先处理后再启动。', snapshot);
  const now = Date.now();
  const task = createTask({ conversationKey: snapshot.conversationKey, branchFingerprint: snapshot.branchFingerprint, tabId, documentId: snapshot.documentId, modeFingerprint: snapshot.modeFingerprint, prompt: request.prompt, maxSends: request.maxSends, hours: request.hours, staleRefreshMinutes: request.staleRefreshMinutes, now });
  task.lastAnswerFingerprint = snapshot.answerFingerprint;
  // The current user turn is the waiting baseline, not an automatic send.
  task.lastCompletedTurnId = snapshot.lastUserTurnId;
  task.stableSince = snapshot.answerFingerprint ? now : null;
  let state = addLog({ task, logs: [] }, 'START', task, now, snapshotDetail(snapshot, task, 'start', now));
  await saveState(state);
  // A completed answer produces no further DOM mutations. Schedule a dedicated
  // second observation in the page, with an alarm as a service-worker fallback.
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'SCHEDULE_STABILITY_RECHECK', delayMs: 10_500 });
    state = addLog(state, 'STABILITY_RECHECK_SCHEDULED', task, Date.now(), 'page=10500ms alarm=fallback');
    await saveState(state);
  } catch (error) {
    state = addLog(state, 'STABILITY_RECHECK_PAGE_FAILED', task, Date.now(), error instanceof Error ? error.message : String(error));
    await saveState(state);
  }
  await chrome.alarms.create(`${STABILITY_ALARM_PREFIX}${task.runId}`, { when: now + 10_500 });
  return { ok: true, state: task };
}

export async function control(type: 'PAUSE' | 'RESUME' | 'STOP', pauseReason: PauseReason = 'USER_REQUESTED', detail?: string | null): Promise<TaskRecord | null> {
  const state = await loadState();
  if (!state.task) return null;
  const now = Date.now();
  if (type === 'RESUME' && state.task.pendingAttempt) {
    return control('PAUSE', 'SEND_UNCERTAIN', '上次发送尚未确认，请先核对页面；不会自动重发。');
  }
  const event = type === 'PAUSE' ? { type: 'PAUSE' as const, reason: pauseReason, detail, now } : type === 'RESUME' ? { type: 'RESUME' as const, now } : { type: 'STOP' as const, now };
  const task = reduceTask(state.task, event);
  await saveState(addLog({ ...state, task }, type, task, now, detail ?? undefined));
  if (type === 'RESUME') {
    await checkAlarm('resume');
    return (await loadState()).task;
  }
  return task;
}

async function dispatch(task: TaskRecord, snapshot: PageSnapshot): Promise<void> {
  const now = Date.now();
  const attemptId = crypto.randomUUID();
  const attempt = { attemptId, sourceAnswerId: snapshot.lastAssistantAnswerId!, expectedParentTurnId: snapshot.lastAssistantAnswerId!, previousUserTurnId: snapshot.lastUserTurnId, promptDigest: `${task.prompt.length}:${task.prompt.slice(0, 32)}`, phase: 'DISPATCH_COMMITTED' as const, createdAt: now, confirmedUserMessageId: null };
  let state = await loadState();
  if (!state.task || state.task.runId !== task.runId || state.task.revision !== task.revision) return;
  state = { ...state, task: reduceTask(state.task, { type: 'ATTEMPT_COMMITTED', attempt, now }) };
  await saveState(addLog(state, 'DISPATCH_COMMITTED', state.task, now));
  const command: ContentCommand = { type: 'EXECUTE_SEND', runId: state.task!.runId, revision: state.task!.revision, attemptId, expectedConversationKey: state.task!.conversationKey, expectedDocumentId: state.task!.boundDocumentId, expectedParentTurnId: attempt.expectedParentTurnId, prompt: state.task!.prompt };
  try {
    const result = await chrome.tabs.sendMessage(state.task!.boundTabId, { type: 'EXECUTE_SEND', command });
    if (!result?.ok) { await control('PAUSE', 'SEND_UNCERTAIN', result?.reason ?? '页面未确认发送'); return; }
    state = await loadState();
    if (!state.task || state.task.pendingAttempt?.attemptId !== attemptId) return;
    let confirmedTask = reduceTask(state.task, { type: 'COMMAND_SENT', now: Date.now() });
    state = addLog({ ...state, task: confirmedTask }, 'SEND_ACCEPTED', confirmedTask, Date.now(), `acceptedBy=${result.acceptedBy} user=${short(result.userMessageId)}`);
    const confirmedUserId = result.userMessageId ?? `accepted:${attemptId}`;
    confirmedTask = reduceTask(confirmedTask, { type: 'SEND_CONFIRMED', userMessageId: confirmedUserId, now: Date.now() });
    await saveState(addLog({ ...state, task: confirmedTask }, 'SEND_CONFIRMED', confirmedTask, Date.now(), `user=${short(confirmedUserId)}`));
  } catch (error) { await control('PAUSE', 'SEND_UNCERTAIN', error instanceof Error ? error.message : String(error)); }
}

// Transport identity is supplied by Chrome, never trusted from the page payload.
export interface ObservationSender { tabId: number | undefined; frameId: number | undefined; }

export async function onObservation(message: PageObservationRequest, sender: ObservationSender): Promise<void> {
  let state = await loadState();
  if (!state.task) return;
  let before = state.task;
  const now = Date.now();
  const transportDetail = `tab=${sender.tabId ?? '-'} frame=${sender.frameId ?? '-'} boundTab=${before.boundTabId} document=${short(message.snapshot.documentId)} boundDocument=${short(before.boundDocumentId)} conversation=${short(message.snapshot.conversationKey)}`;
  const ignored = sender.tabId !== before.boundTabId || sender.frameId !== 0
    ? 'OBSERVATION_IGNORED_SOURCE' : null;
  if (ignored) {
    const previous = state.logs.at(-1);
    if (previous?.event !== ignored || previous.detail !== transportDetail) {
      await saveState(addLog(state, ignored, before, now, transportDetail));
    }
    return;
  }
  if (['PAUSED', 'STOPPED', 'FINISHED'].includes(before.state)) return;
  if (message.snapshot.documentId !== before.boundDocumentId) {
    // A delayed observation cannot authorize a rebind. Query the current top-level
    // content script and require it to agree with the candidate document.
    const current = await observeTab(before.boundTabId);
    if (!current?.documentId || current.documentId !== message.snapshot.documentId) {
      await saveState(addLog(state, 'OBSERVATION_IGNORED_DOCUMENT', before, now, transportDetail));
      return;
    }
    message = { ...message, snapshot: current };
    if (before.pendingAttempt) {
      await control('PAUSE', 'SEND_UNCERTAIN', '发送确认期间页面已刷新，请核对上次消息是否已发送。');
      return;
    }
    // Check known changes immediately; allow incomplete loading evidence to settle.
    const mismatch: PauseReason | null = current.conversationKey && current.conversationKey !== before.conversationKey ? 'CONVERSATION_CHANGED'
      : current.branchFingerprint && current.branchFingerprint !== before.branchFingerprint ? 'BRANCH_CHANGED'
      : current.modeFingerprint && current.modeFingerprint !== before.modeFingerprint ? 'MODE_CHANGED' : null;
    if (mismatch) { await control('PAUSE', mismatch, transportDetail); return; }
    if (!current.conversationKey || !current.branchFingerprint || !current.modeFingerprint || current.status === 'UNKNOWN') {
      await saveState(addLog(state, 'RELOAD_WAITING_FOR_IDENTITY', before, now, transportDetail));
      return;
    }
    const reloadKind = before.controlledReloadAt != null ? 'controlled' : 'page-refresh';
    before = reduceTask(before, { type: 'DOCUMENT_REBOUND', documentId: current.documentId, now });
    state = addLog({ ...state, task: before }, 'DOCUMENT_REBOUND', before, now, `kind=${reloadKind} ${transportDetail}`);
    await saveState(state);
    await chrome.alarms.create(`${STABILITY_ALARM_PREFIX}${before.runId}`, { when: now + 10_500 });
  }
  // Identity must be checked before completion markers, fingerprints or counters.
  if (message.snapshot.conversationKey !== before.conversationKey &&
      !(before.controlledReloadAt != null && !message.snapshot.conversationKey)) {
    await control('PAUSE', 'CONVERSATION_CHANGED', transportDetail);
    return;
  }
  let task = reduceTask(before, { type: 'OBSERVATION', snapshot: message.snapshot, now });
  state = addLog({ ...state, task }, 'OBSERVATION', task, now, `${transportDetail} ${snapshotDetail(message.snapshot, task, message.source, now)}`);
  await saveState(state);
  if (hasIndependentCompletionEvidence(message.snapshot) && message.snapshot.terminalMarker === 'DONE') {
    task = reduceTask(task, { type: 'FINISH', reason: 'GOAL_DONE', now: Date.now() });
    await saveState(addLog({ ...state, task }, 'GOAL_DONE', task));
    return;
  }
  if (hasIndependentCompletionEvidence(message.snapshot) && message.snapshot.terminalMarker === 'NEEDS_USER') {
    task = reduceTask(task, { type: 'PAUSE', reason: 'NEEDS_USER', now: Date.now() });
    await saveState(addLog({ ...state, task }, 'NEEDS_USER', task));
    return;
  }
  if (now >= task.deadlineAt && task.state === 'WAITING_ANSWER') {
    task = reduceTask(task, { type: 'FINISH', reason: 'DEADLINE_REACHED', now });
    await saveState(addLog({ ...state, task }, 'DEADLINE_REACHED', task));
    return;
  }
  if ((before.state === 'SUBMITTING' || before.state === 'VERIFYING_SUBMIT') && before.pendingAttempt && message.snapshot.lastUserTurnId && message.snapshot.lastUserTurnId !== before.pendingAttempt.previousUserTurnId) {
    task = reduceTask(task, { type: 'SEND_CONFIRMED', userMessageId: message.snapshot.lastUserTurnId, now: Date.now() });
    await saveState(addLog({ ...state, task }, 'SEND_CONFIRMED', task));
    return;
  }
  const guard = canDispatch(task, message.snapshot, Date.now());
  if (guard.ok) {
    await saveState(addLog(state, 'GUARD_PASSED', task, Date.now(), 'dispatch=true'));
    await dispatch(task, message.snapshot);
  }
  else if (guard.reason === 'MAX_SENDS_REACHED' && task.confirmedSends >= task.maxSends && message.snapshot.lastAssistantAnswerId && !task.consumedTurnIds.includes(message.snapshot.lastAssistantAnswerId)) {
    const stable = isStableCompletion(message.snapshot, { answerId: message.snapshot.lastAssistantAnswerId, fingerprint: task.lastAnswerFingerprint, since: task.stableSince }, now);
    if (stable.complete) {
      task = reduceTask(task, { type: 'FINISH', reason: 'MAX_SENDS_REACHED', now });
      await saveState(addLog({ ...state, task }, 'MAX_SENDS_REACHED', task));
    }
  }
  else if (task.state !== 'PAUSED' && (guard.reason === 'ERROR_ON_PAGE' || guard.reason === 'MODE_CHANGED' || guard.reason === 'CONVERSATION_CHANGED' || guard.reason === 'BRANCH_CHANGED' || guard.reason === 'USER_DRAFT' || guard.reason === 'TAB_UNAVAILABLE')) {
    task = reduceTask(task, { type: 'PAUSE', reason: guard.reason, now: Date.now() });
    await saveState(addLog({ ...state, task }, 'PAUSE_GUARD', task));
  }
  else await saveState(addLog(state, 'GUARD_BLOCKED', task, Date.now(), `reason=${guard.reason}`));
}

export async function checkAlarm(source = 'periodic'): Promise<void> {
  const state = await loadState();
  if (!state.task) return;
  const snapshot = await observeTab(state.task.boundTabId);
  if (!snapshot) {
    if (state.task.pendingAttempt) await control('PAUSE', 'TAB_UNAVAILABLE');
    return;
  }
  await onObservation({ type: 'PAGE_OBSERVATION', snapshot, source: `alarm:${source}` }, { tabId: state.task.boundTabId, frameId: 0 });
  let refreshed = await loadState();
  if (refreshed.task && shouldRefreshStaleBusy(refreshed.task, snapshot, Date.now())) {
    const now = Date.now();
    const reloading = reduceTask(refreshed.task, { type: 'CONTROLLED_RELOAD_STARTED', now });
    refreshed = addLog({ ...refreshed, task: reloading }, 'STALE_BUSY_RELOAD', reloading, now, `cause=${snapshot.busySignal ? 'busy' : 'awaiting-submitted-answer'} idleMs=${now - (refreshed.task.lastProgressAt ?? now)} thresholdMs=${refreshed.task.staleRefreshMs ?? 15 * 60_000}`);
    await saveState(refreshed);
    try { await chrome.tabs.reload(reloading.boundTabId); }
    catch (error) { await control('PAUSE', 'TAB_UNAVAILABLE', error instanceof Error ? error.message : String(error)); }
    return;
  }
  const pending = refreshed.task?.pendingAttempt;
  // A worker restart or page refresh can leave the click outcome unknown. Reconcile once
  // from the page; after a bounded grace period, stop instead of retrying.
  if (pending && Date.now() - pending.createdAt >= 30_000) await control('PAUSE', 'SEND_UNCERTAIN');
}
