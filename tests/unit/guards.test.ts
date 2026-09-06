import { describe, expect, it } from 'vitest';
import { canDispatch, shouldRefreshStaleBusy } from '../../src/core/guards';
import { createTask, reduceTask } from '../../src/core/reducer';
import type { PageSnapshot } from '../../src/shared/types';

const page = (now = 0): PageSnapshot => ({ conversationKey: 'c1', url: 'https://chatgpt.com/c/c1', documentId: 'd1', branchFingerprint: 'b1', modeFingerprint: 'pro', modeLabel: 'Pro', status: 'READY', lastMessageRole: 'assistant', lastUserTurnId: 'u1', lastAssistantAnswerId: 'a1', answerFingerprint: 'a1:3:end', finalSignal: true, busySignal: false, errorSignal: false, editorEmpty: true, hasPendingAttachment: false, observedAt: now });

describe('dispatch guards', () => {
  it('refreshes a stale submitted turn even when the busy button has disappeared', () => {
    const task = createTask({ conversationKey: 'c1', branchFingerprint: 'b1', tabId: 1, documentId: 'd1', modeFingerprint: 'pro', prompt: '继续', maxSends: 2, hours: 8, staleRefreshMinutes: 2, now: 0 });
    Object.assign(task, { confirmedSends: 1, lastCompletedTurnId: 'u2', consumedTurnIds: ['a1'] });
    const waiting = { ...page(), lastMessageRole: 'user' as const, lastUserTurnId: 'u2' };
    expect(canDispatch(task, waiting, 120_001).ok).toBe(false);
    expect(shouldRefreshStaleBusy(task, waiting, 119_999)).toBe(false);
    expect(shouldRefreshStaleBusy(task, waiting, 120_001)).toBe(true);
    expect(shouldRefreshStaleBusy(task, { ...waiting, lastUserTurnId: 'manual-user' }, 120_001)).toBe(false);
    expect(shouldRefreshStaleBusy(task, { ...waiting, editorEmpty: false }, 120_001)).toBe(false);
    expect(shouldRefreshStaleBusy(task, { ...waiting, lastMessageRole: 'assistant', lastAssistantAnswerId: 'a2' }, 120_001)).toBe(false);
  });
  it('requires two stable observations before dispatch', () => {
    const initial = createTask({ conversationKey: 'c1', branchFingerprint: 'b1', tabId: 1, documentId: 'd1', modeFingerprint: 'pro', prompt: '继续', maxSends: 2, hours: 8, now: 0 });
    const first = reduceTask(initial, { type: 'OBSERVATION', snapshot: page(1), now: 1 });
    expect(canDispatch(first, page(1), 1).ok).toBe(false);
    const second = reduceTask(first, { type: 'OBSERVATION', snapshot: page(12_000), now: 12_000 });
    expect(canDispatch(second, page(12_000), 12_000).ok).toBe(true);
  });

  it('rejects a changed mode or a user draft', () => {
    const task = createTask({ conversationKey: 'c1', branchFingerprint: 'b1', tabId: 1, documentId: 'd1', modeFingerprint: 'pro', prompt: '继续', maxSends: 2, hours: 8, now: 0 });
    const modeChanged = canDispatch({ ...task, stableSince: 0, lastAnswerFingerprint: 'a1:3:end' }, { ...page(20_000), modeFingerprint: 'other' }, 20_000);
    expect(modeChanged.ok).toBe(false);
    const draft = canDispatch({ ...task, stableSince: 0, lastAnswerFingerprint: 'a1:3:end' }, { ...page(20_000), editorEmpty: false }, 20_000);
    expect(draft.ok).toBe(false);
  });

  it('does not mistake the just-submitted prompt for a user draft during cooldown', () => {
    const task = createTask({ conversationKey: 'c1', branchFingerprint: 'b1', tabId: 1, documentId: 'd1', modeFingerprint: 'pro', prompt: '继续', maxSends: 2, hours: 8, now: 0 });
    const result = canDispatch({ ...task, confirmedSends: 1, nextEligibleAt: 15_000, stableSince: 0, lastAnswerFingerprint: 'a1:3:end' }, { ...page(1_000), editorEmpty: false }, 1_000);
    expect(result).toEqual({ ok: false, reason: 'COMPLETION_UNKNOWN' });
  });

  it('refreshes only a busy page that has exceeded the no-progress threshold', () => {
    const task = createTask({ conversationKey: 'c1', branchFingerprint: 'b1', tabId: 1, documentId: 'd1', modeFingerprint: 'pro', prompt: '继续', maxSends: 2, hours: 8, staleRefreshMinutes: 2, now: 0 });
    const busy = { ...page(120_001), status: 'BUSY' as const, busySignal: true, finalSignal: false };
    expect(shouldRefreshStaleBusy(task, busy, 119_999)).toBe(false);
    expect(shouldRefreshStaleBusy(task, busy, 120_001)).toBe(true);
    expect(shouldRefreshStaleBusy(task, { ...busy, busySignal: false }, 120_001)).toBe(false);
  });
});
