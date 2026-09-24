import type { PageSnapshot } from '../shared/types';

export const STABLE_WINDOW_MS = 10_000;

export function hasIndependentCompletionEvidence(snapshot: PageSnapshot): boolean {
  return !snapshot.thinkingFailure && snapshot.lastMessageRole === 'assistant' && snapshot.finalSignal && !snapshot.busySignal && !snapshot.errorSignal &&
    snapshot.status === 'READY' && Boolean(snapshot.lastAssistantAnswerId) &&
    Boolean(snapshot.answerFingerprint);
}

export function hasContinuationEvidence(snapshot: PageSnapshot): boolean {
  return hasIndependentCompletionEvidence(snapshot) || Boolean(snapshot.thinkingFailure &&
    snapshot.lastMessageRole === 'assistant' && snapshot.lastUserTurnId &&
    snapshot.lastAssistantAnswerId?.startsWith(`thinking-failure:${snapshot.lastUserTurnId}:`) &&
    snapshot.answerFingerprint === snapshot.lastAssistantAnswerId &&
    snapshot.status === 'READY' && snapshot.modeFingerprint && !snapshot.busySignal && !snapshot.errorSignal);
}

export function isStableCompletion(
  snapshot: PageSnapshot,
  previous: { answerId: string | null; fingerprint: string | null; since: number | null },
  now: number,
  requiredMs = STABLE_WINDOW_MS
): { complete: boolean; since: number | null } {
  if (!hasIndependentCompletionEvidence(snapshot)) return { complete: false, since: null };
  return isStableContinuation(snapshot, previous, now, requiredMs);
}

export function isStableContinuation(
  snapshot: PageSnapshot,
  previous: { answerId: string | null; fingerprint: string | null; since: number | null },
  now: number,
  requiredMs = STABLE_WINDOW_MS
): { complete: boolean; since: number | null } {
  if (!hasContinuationEvidence(snapshot)) return { complete: false, since: null };
  const sameAnswer = snapshot.lastAssistantAnswerId === previous.answerId &&
    snapshot.answerFingerprint === previous.fingerprint;
  const since = sameAnswer && previous.since !== null ? previous.since : now;
  return { complete: now - since >= requiredMs, since };
}

export function hasTerminalMarker(text: string, marker: 'DONE' | 'NEEDS_USER'): boolean {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const target = `[[AUTO_CONTINUE:${marker}]]`;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    return line === target;
  }
  return false;
}
