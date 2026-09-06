import { describe, expect, it } from 'vitest';
import { createTask, reduceTask } from '../../src/core/reducer';
import type { PageSnapshot } from '../../src/shared/types';

const base = (answer = 'a1'): PageSnapshot => ({ conversationKey: 'c1', url: 'https://chatgpt.com/c/c1', documentId: 'd1', branchFingerprint: 'b1', modeFingerprint: 'pro', modeLabel: 'Pro', status: 'READY', lastMessageRole: 'assistant', lastUserTurnId: 'u1', lastAssistantAnswerId: answer, answerFingerprint: `${answer}:10:end`, finalSignal: true, busySignal: false, errorSignal: false, editorEmpty: true, hasPendingAttachment: false, observedAt: 0 });

describe('task reducer', () => {
  it('preserves budget and records a confirmed send', () => {
    const task = createTask({ conversationKey: 'c1', branchFingerprint: 'b1', tabId: 2, documentId: 'd1', modeFingerprint: 'pro', prompt: '继续', maxSends: 2, hours: 8, now: 0 });
    const committed = reduceTask(task, { type: 'ATTEMPT_COMMITTED', now: 10, attempt: { attemptId: 'x', sourceAnswerId: 'a1', expectedParentTurnId: 'a1', previousUserTurnId: 'u1', promptDigest: '2:继续', phase: 'DISPATCH_COMMITTED', createdAt: 10, confirmedUserMessageId: null } });
    const verifying = reduceTask(committed, { type: 'COMMAND_SENT', now: 11 });
    const confirmed = reduceTask(verifying, { type: 'SEND_CONFIRMED', userMessageId: 'u2', now: 12 });
    expect(confirmed.confirmedSends).toBe(1);
    expect(confirmed.consumedTurnIds).toEqual(['a1']);
    expect(confirmed.pendingAttempt).toBeNull();
    expect(confirmed.nextEligibleAt).toBe(15_012);
  });

  it('does not make a user intervention look like an automatic send', () => {
    const task = createTask({ conversationKey: 'c1', branchFingerprint: 'b1', tabId: 2, documentId: 'd1', modeFingerprint: 'pro', prompt: '继续', maxSends: 2, hours: 8, now: 0 });
    const changed = reduceTask(task, { type: 'OBSERVATION', snapshot: base(), now: 100 });
    expect(changed.confirmedSends).toBe(0);
  });

  it('keeps malformed numeric input bounded', () => {
    const task = createTask({ conversationKey: 'c1', branchFingerprint: 'b1', tabId: 2, documentId: 'd1', modeFingerprint: 'pro', prompt: '继续', maxSends: Number.NaN, hours: Number.NaN, now: 0 });
    expect(task.maxSends).toBe(20);
    expect(task.deadlineAt).toBe(28_800_000);
    expect(task.staleRefreshMs).toBe(900_000);
  });

  it('rebinds the document after a controlled reload', () => {
    const task = createTask({ conversationKey: 'c1', branchFingerprint: 'b1', tabId: 2, documentId: 'd1', modeFingerprint: 'pro', prompt: '继续', maxSends: 2, hours: 8, now: 0 });
    const reloading = reduceTask(task, { type: 'CONTROLLED_RELOAD_STARTED', now: 120_000 });
    const rebound = reduceTask(reloading, { type: 'DOCUMENT_REBOUND', documentId: 'd2', now: 121_000 });
    expect(rebound.boundDocumentId).toBe('d2');
    expect(rebound.controlledReloadAt).toBeNull();
    expect(rebound.lastProgressAt).toBe(121_000);
  });
});
