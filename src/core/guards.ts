import type { PageSnapshot, PauseReason, TaskRecord } from '../shared/types';
import { hasContinuationEvidence, hasIndependentCompletionEvidence, isStableContinuation } from './completion';

export type DispatchGuardResult = { ok: true } | { ok: false; reason: PauseReason };

// The page is showing the very answer we already continued from, but the
// accepted user message is absent. This proves a view mismatch, not non-delivery.
export function isSubmittedTurnMissing(task: TaskRecord, page: PageSnapshot): boolean {
  return Boolean(task.confirmedSends > 0 && task.lastCompletedTurnId && !task.lastCompletedTurnId.startsWith('accepted:') &&
    page.conversationKey === task.conversationKey && page.branchFingerprint === task.branchFingerprint &&
    page.documentId === task.boundDocumentId && page.modeFingerprint === task.modeFingerprint &&
    page.lastUserTurnId && page.lastUserTurnId !== task.lastCompletedTurnId &&
    page.lastAssistantAnswerId === task.consumedTurnIds.at(-1) && hasIndependentCompletionEvidence(page));
}

function hasManualContinuation(task: TaskRecord, page: PageSnapshot): boolean {
  return Boolean(task.manualContinuation && task.manualContinuation.answerId === page.lastAssistantAnswerId &&
    task.manualContinuation.userTurnId === page.lastUserTurnId && task.manualContinuation.documentId === page.documentId);
}

export function shouldRefreshStaleBusy(task: TaskRecord, snapshot: PageSnapshot, now: number): boolean {
  const awaitedUser = Boolean(task.lastCompletedTurnId) && (snapshot.lastUserTurnId === task.lastCompletedTurnId || task.lastCompletedTurnId!.startsWith('accepted:'));
  const awaitingSubmittedAnswer = isSubmittedTurnMissing(task, snapshot) || (awaitedUser &&
    (!hasContinuationEvidence(snapshot) || !snapshot.lastAssistantAnswerId || task.consumedTurnIds.includes(snapshot.lastAssistantAnswerId)));
  return task.state === 'WAITING_ANSWER' && !task.pendingAttempt && !task.controlledReloadAt &&
    snapshot.documentId === task.boundDocumentId && snapshot.conversationKey === task.conversationKey &&
    snapshot.branchFingerprint === task.branchFingerprint && snapshot.modeFingerprint === task.modeFingerprint &&
    (snapshot.status === 'READY' || snapshot.status === 'BUSY') && !snapshot.errorSignal && snapshot.editorEmpty && !snapshot.hasPendingAttachment && now < task.deadlineAt &&
    awaitingSubmittedAnswer && now - (task.lastProgressAt ?? now) >= (task.staleRefreshMs ?? 15 * 60_000);
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
  if (!hasContinuationEvidence(snapshot)) return { ok: false, reason: 'ANSWER_NOT_COMPLETE' };
  if (snapshot.thinkingFailure && (task.consecutiveThinkingFailures ?? 0) >= 3) return { ok: false, reason: 'ERROR_ON_PAGE' };
  const stable = isStableContinuation(snapshot, {
    answerId: task.lastAnswerFingerprint ? snapshot.lastAssistantAnswerId : null,
    fingerprint: task.lastAnswerFingerprint,
    since: task.stableSince
  }, now, stableMs);
  if (!stable.complete) return { ok: false, reason: 'COMPLETION_UNKNOWN' };
  if (isSubmittedTurnMissing(task, snapshot)) return hasManualContinuation(task, snapshot) ? { ok: true } : { ok: false, reason: 'SUBMITTED_TURN_MISSING' };
  if (task.consumedTurnIds.includes(snapshot.lastAssistantAnswerId!) || (snapshot.thinkingFailure &&
    task.consumedTurnIds.some(id => id.startsWith(`thinking-failure:${snapshot.lastUserTurnId}:`)))) return { ok: false, reason: 'ANSWER_NOT_COMPLETE' };
  return { ok: true };
}
