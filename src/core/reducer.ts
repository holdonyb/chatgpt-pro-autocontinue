import type { PageSnapshot, PauseReason, RunState, TaskRecord } from '../shared/types';

export type TaskEvent =
  | { type: 'OBSERVATION'; snapshot: PageSnapshot; now: number }
  | { type: 'ATTEMPT_COMMITTED'; attempt: NonNullable<TaskRecord['pendingAttempt']>; now: number }
  | { type: 'COMMAND_SENT'; now: number }
  | { type: 'SEND_NOT_SENT'; detail: string; now: number }
  | { type: 'SEND_CONFIRMED'; userMessageId: string; now: number }
  | { type: 'CONTROLLED_RELOAD_STARTED'; now: number }
  | { type: 'DOCUMENT_REBOUND'; documentId: string; now: number }
  | { type: 'PAUSE'; reason: PauseReason; detail?: string | null; now: number }
  | { type: 'RESUME'; now: number }
  | { type: 'STOP'; now: number }
  | { type: 'FINISH'; reason: PauseReason; now: number };

function bump(task: TaskRecord): TaskRecord { return { ...task, revision: task.revision + 1 }; }

export function reduceTask(task: TaskRecord, event: TaskEvent): TaskRecord {
  if (event.type === 'OBSERVATION') {
    const { snapshot, now } = event;
    const answerChanged = snapshot.answerFingerprint !== task.lastAnswerFingerprint;
    const stableSince = answerChanged ? now : task.stableSince;
    if (task.state === 'WAITING_ANSWER' && snapshot.errorSignal) return { ...bump(task), state: 'PAUSED', pauseReason: 'ERROR_ON_PAGE', lastObservationAt: now };
    return { ...task, stableSince, lastAnswerFingerprint: snapshot.answerFingerprint, lastObservationAt: now, lastProgressAt: answerChanged ? now : (task.lastProgressAt ?? now) };
  }
  if (event.type === 'ATTEMPT_COMMITTED') return { ...bump(task), state: 'SUBMITTING', pendingAttempt: event.attempt };
  if (event.type === 'COMMAND_SENT') return { ...task, state: 'VERIFYING_SUBMIT', pendingAttempt: task.pendingAttempt ? { ...task.pendingAttempt, phase: 'COMMAND_SENT' } : null };
  if (event.type === 'SEND_NOT_SENT') return { ...bump(task), state: 'PAUSED', pauseReason: 'SEND_NOT_SENT', pendingAttempt: null, statusDetail: event.detail };
  if (event.type === 'SEND_CONFIRMED') {
    const pending = task.pendingAttempt;
    const consumed = pending ? [...task.consumedTurnIds, pending.sourceAnswerId] : task.consumedTurnIds;
    return { ...bump(task), state: 'WAITING_ANSWER', pauseReason: 'NONE', pendingAttempt: null, confirmedSends: task.confirmedSends + 1, consumedTurnIds: consumed, lastCompletedTurnId: event.userMessageId, nextEligibleAt: event.now + 15_000, lastProgressAt: event.now };
  }
  if (event.type === 'CONTROLLED_RELOAD_STARTED') return { ...bump(task), controlledReloadAt: event.now };
  if (event.type === 'DOCUMENT_REBOUND') return { ...bump(task), boundDocumentId: event.documentId, controlledReloadAt: null, identityWaitSince: null, stableSince: event.now, lastProgressAt: event.now, lastObservationAt: event.now };
  if (event.type === 'PAUSE') return { ...bump(task), state: 'PAUSED', pauseReason: event.reason, statusDetail: event.detail ?? null };
  if (event.type === 'RESUME') return { ...bump(task), state: 'WAITING_ANSWER', pauseReason: 'NONE', statusDetail: null, failedPageChecks: 0, controlledReloadAt: null, identityWaitSince: null, recoveryReloads: 0, stableSince: event.now, lastProgressAt: event.now };
  if (event.type === 'STOP') return { ...bump(task), state: 'STOPPED', pauseReason: 'USER_REQUESTED' };
  return { ...bump(task), state: 'FINISHED', pauseReason: event.reason };
}

export function createTask(args: { conversationKey: string; branchFingerprint: string; tabId: number; documentId: string; modeFingerprint: string; prompt: string; maxSends: number; hours: number; staleRefreshMinutes?: number; now: number; }): TaskRecord {
  const runId = crypto.randomUUID();
  const hours = Number.isFinite(args.hours) ? Math.max(0.1, args.hours) : 8;
  const maxSends = Number.isFinite(args.maxSends) ? Math.max(1, Math.min(100, Math.floor(args.maxSends))) : 20;
  const staleRefreshMinutes = Number.isFinite(args.staleRefreshMinutes) ? Math.max(2, Math.min(120, Number(args.staleRefreshMinutes))) : 15;
  return { schemaVersion: 1, runId, revision: 0, conversationKey: args.conversationKey, branchFingerprint: args.branchFingerprint, boundTabId: args.tabId, boundDocumentId: args.documentId, modeFingerprint: args.modeFingerprint, state: 'WAITING_ANSWER', pauseReason: 'NONE', statusDetail: null, staleRefreshMs: staleRefreshMinutes * 60_000, lastProgressAt: args.now, controlledReloadAt: null, prompt: args.prompt, startedAt: args.now, deadlineAt: args.now + hours * 3_600_000, maxSends, confirmedSends: 0, lastCompletedTurnId: null, consumedTurnIds: [], pendingAttempt: null, nextEligibleAt: args.now, lastObservationAt: args.now, stableSince: null, lastAnswerFingerprint: null };
}

export function stateLabel(state: RunState, reason: PauseReason): string {
  if (state === 'PAUSED') return `已暂停（${pauseReasonLabel(reason)}）`;
  if (state === 'WAITING_ANSWER') return '等待回答';
  if (state === 'COOLDOWN') return '冷却中';
  if (state === 'SUBMITTING') return '正在发送';
  if (state === 'VERIFYING_SUBMIT') return '核对发送结果';
  if (state === 'FINISHED') return '已结束';
  if (state === 'STOPPED') return '已停止';
  return '待开始';
}

export function pauseReasonLabel(reason: PauseReason): string {
  const labels: Record<PauseReason, string> = {
    PAGE_RECOVERY_FAILED: '页面恢复失败，请检查目标页面',
    SEND_NOT_SENT: '尚未发送，请检查输入框后继续',
    NONE: '', MODE_UNKNOWN: '无法确认当前模式', MODE_CHANGED: '页面模式发生变化', CONVERSATION_CHANGED: '对话已变化', BRANCH_CHANGED: '对话分支已变化', ANSWER_NOT_COMPLETE: '等待回答完成', COMPLETION_UNKNOWN: '无法确认回答已完成', USER_DRAFT: '检测到你的草稿或附件', USER_INTERVENTION: '检测到人工操作', SEND_UNCERTAIN: '发送结果需要核对', ERROR_ON_PAGE: '页面报告错误', TAB_UNAVAILABLE: '目标页面不可用', TAB_FROZEN: '目标页面被冻结', TAB_DISCARDED: '目标页面被暂存', DEADLINE_REACHED: '运行时限已到', MAX_SENDS_REACHED: '已达到发送上限', USER_REQUESTED: '按你的操作暂停', GOAL_DONE: '对话标记为已完成', NEEDS_USER: '需要你作出决定', STORAGE_ERROR: '本地状态保存失败'
  };
  return labels[reason];
}
