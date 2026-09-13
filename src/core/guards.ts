import type { PageSnapshot, PauseReason, TaskRecord } from '../shared/types';
import { hasIndependentCompletionEvidence, isStableCompletion } from './completion';

export type DispatchGuardResult = { ok: true } | { ok: false; reason: PauseReason };

export function shouldRefreshStaleBusy(task: TaskRecord, snapshot: PageSnapshot, now: number): boolean {
  const awaitedUser = Boolean(task.lastCompletedTurnId) && (snapshot.lastUserTurnId === task.lastCompletedTurnId || task.lastCompletedTurnId!.startsWith('accepted:'));
  const awaitingSubmittedAnswer = awaitedUser &&
    (!hasIndependentCompletionEvidence(snapshot) || !snapshot.lastAssistantAnswerId || task.consumedTurnIds.includes(snapshot.lastAssistantAnswerId));
  return task.state === 'WAITING_ANSWER' && !task.pendingAttempt && !task.controlledReloadAt &&
    snapshot.documentId === task.boundDocumentId && snapshot.conversationKey === task.conversationKey &&
    snapshot.branchFingerprint === task.branchFingerprint && snapshot.modeFingerprint === task.modeFingerprint &&
    !snapshot.errorSignal && snapshot.editorEmpty && !snapshot.hasPendingAttachment && now < task.deadlineAt &&
    (snapshot.busySignal || awaitingSubmittedAnswer) && now - (task.lastProgressAt ?? now) >= (task.staleRefreshMs ?? 15 * 60_000);
}

export function canDispatch(task: TaskRecord, snapshot: PageSnapshot, now: number, stableMs = 10_000): DispatchGuardResult {
  if (task.state === 'PAUSED' || task.state === 'STOPPED' || task.state === 'FINISHED') return { ok: false, reason: task.pauseReason };
  if (task.pendingAttempt) return { ok: false, reason: 'SEND_UNCERTAIN' };
  if (task.controlledReloadAt != null || task.identityWaitSince != null) return { ok: false, reason: 'COMPLETION_UNKNOWN' };
  if (now >= task.deadlineAt) return { ok: false, reason: 'DEADLINE_REACHED' };
  if (task.confirmedSends >= task.maxSends) return { ok: false, reason: 'MAX_SENDS_REACHED' };
  if (snapshot.conversationKey !== task.conversationKey) return { ok: false, reason: 'CONVERSATION_CHANGED' };
  if (snapshot.documentId !== task.boundDocumentId) return { ok: false, reason: 'TAB_UNAVAILABLE' };
  if (snapshot.branchFingerprint !== task.branchFingerprint) return { ok: false, reason: 'BRANCH_CHANGED' };
  if (!snapshot.modeFingerprint) return { ok: false, reason: 'MODE_UNKNOWN' };
  if (snapshot.modeFingerprint !== task.modeFingerprint) return { ok: false, reason: 'MODE_CHANGED' };
  // Right after a confirmed click, ChatGPT can briefly expose the prompt we just
  // inserted before clearing the composer. During this bounded cooldown it is not
  // evidence of a new user draft.
  if (task.nextEligibleAt > now) return { ok: false, reason: 'COMPLETION_UNKNOWN' };
  if (snapshot.editorEmpty === false || snapshot.hasPendingAttachment) return { ok: false, reason: 'USER_DRAFT' };
  if (!hasIndependentCompletionEvidence(snapshot)) return { ok: false, reason: 'ANSWER_NOT_COMPLETE' };
  const stable = isStableCompletion(snapshot, {
    answerId: task.lastAnswerFingerprint ? snapshot.lastAssistantAnswerId : null,
    fingerprint: task.lastAnswerFingerprint,
    since: task.stableSince
  }, now, stableMs);
  if (!stable.complete) return { ok: false, reason: 'COMPLETION_UNKNOWN' };
  if (task.consumedTurnIds.includes(snapshot.lastAssistantAnswerId!)) return { ok: false, reason: 'ANSWER_NOT_COMPLETE' };
  return { ok: true };
}
