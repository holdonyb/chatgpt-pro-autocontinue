import { describe, expect, it } from 'vitest';
import { hasTerminalMarker, isStableCompletion } from '../../src/core/completion';
import type { PageSnapshot } from '../../src/shared/types';

const snapshot = (overrides: Partial<PageSnapshot> = {}): PageSnapshot => ({
  conversationKey: 'c1', url: 'https://chatgpt.com/c/c1', documentId: 'd1', branchFingerprint: 'b1', modeFingerprint: 'pro', modeLabel: 'Pro', status: 'READY', lastMessageRole: 'assistant', lastUserTurnId: 'u1', lastAssistantAnswerId: 'a1', answerFingerprint: 'a1:10:end', finalSignal: true, busySignal: false, errorSignal: false, editorEmpty: true, hasPendingAttachment: false, observedAt: 0, ...overrides
});

describe('completion', () => {
  it('requires a stable answer and positive completion evidence', () => {
    expect(isStableCompletion(snapshot(), { answerId: null, fingerprint: null, since: null }, 10_000)).toEqual({ complete: false, since: 10_000 });
    expect(isStableCompletion(snapshot(), { answerId: 'a1', fingerprint: 'a1:10:end', since: 0 }, 10_000)).toEqual({ complete: true, since: 0 });
    expect(isStableCompletion(snapshot({ busySignal: true }), { answerId: 'a1', fingerprint: 'a1:10:end', since: 0 }, 20_000)).toEqual({ complete: false, since: null });
  });

  it('accepts only the final non-empty marker line', () => {
    expect(hasTerminalMarker('proof\n[[AUTO_CONTINUE:DONE]]', 'DONE')).toBe(true);
    expect(hasTerminalMarker('[[AUTO_CONTINUE:DONE]]\nmore', 'DONE')).toBe(false);
    expect(hasTerminalMarker('```\n[[AUTO_CONTINUE:DONE]]\n```', 'DONE')).toBe(false);
  });
});
