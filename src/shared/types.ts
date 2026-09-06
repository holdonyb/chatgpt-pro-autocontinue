export type RunState =
  | 'STOPPED'
  | 'WAITING_ANSWER'
  | 'COOLDOWN'
  | 'SUBMITTING'
  | 'VERIFYING_SUBMIT'
  | 'PAUSED'
  | 'FINISHED';

export type PauseReason =
  | 'NONE'
  | 'MODE_UNKNOWN'
  | 'MODE_CHANGED'
  | 'CONVERSATION_CHANGED'
  | 'BRANCH_CHANGED'
  | 'ANSWER_NOT_COMPLETE'
  | 'COMPLETION_UNKNOWN'
  | 'USER_DRAFT'
  | 'USER_INTERVENTION'
  | 'SEND_UNCERTAIN'
  | 'ERROR_ON_PAGE'
  | 'TAB_UNAVAILABLE'
  | 'TAB_FROZEN'
  | 'TAB_DISCARDED'
  | 'DEADLINE_REACHED'
  | 'MAX_SENDS_REACHED'
  | 'USER_REQUESTED'
  | 'GOAL_DONE'
  | 'NEEDS_USER'
  | 'STORAGE_ERROR';

export type PageStatus = 'READY' | 'BUSY' | 'UNKNOWN' | 'ERROR';

export interface PageSnapshot {
  completionDetail?: string;
  conversationKey: string | null;
  url: string;
  documentId: string;
  branchFingerprint: string | null;
  modeFingerprint: string | null;
  modeLabel: string | null;
  status: PageStatus;
  lastMessageRole: 'user' | 'assistant' | 'unknown';
  lastUserTurnId: string | null;
  lastAssistantAnswerId: string | null;
  answerFingerprint: string | null;
  terminalMarker?: 'DONE' | 'NEEDS_USER' | null;
  finalSignal: boolean;
  busySignal: boolean;
  errorSignal: boolean;
  editorEmpty: boolean;
  hasPendingAttachment: boolean;
  observedAt: number;
}

export interface PendingAttempt {
  attemptId: string;
  sourceAnswerId: string;
  expectedParentTurnId: string;
  previousUserTurnId: string | null;
  promptDigest: string;
  phase: 'DISPATCH_COMMITTED' | 'COMMAND_SENT' | 'VERIFYING';
  createdAt: number;
  confirmedUserMessageId: string | null;
}

export interface TaskRecord {
  schemaVersion: 1;
  runId: string;
  revision: number;
  conversationKey: string;
  branchFingerprint: string;
  boundTabId: number;
  boundDocumentId: string;
  modeFingerprint: string;
  state: RunState;
  pauseReason: PauseReason;
  statusDetail?: string | null;
  staleRefreshMs: number;
  lastProgressAt: number;
  controlledReloadAt: number | null;
  prompt: string;
  startedAt: number;
  deadlineAt: number;
  maxSends: number;
  confirmedSends: number;
  lastCompletedTurnId: string | null;
  consumedTurnIds: string[];
  pendingAttempt: PendingAttempt | null;
  nextEligibleAt: number;
  lastObservationAt: number;
  stableSince: number | null;
  lastAnswerFingerprint: string | null;
}

export interface PersistedState {
  task: TaskRecord | null;
  logs: Array<{ at: number; event: string; state: RunState | null; reason?: PauseReason; detail?: string }>;
}

export interface StartRequest { type: 'START'; prompt: string; maxSends: number; hours: number; staleRefreshMinutes?: number; }
export interface ControlRequest { type: 'PAUSE' | 'RESUME' | 'STOP' | 'GET_STATUS'; }
export interface PageInfoRequest { type: 'GET_PAGE_INFO'; }
export interface PageObservationRequest { type: 'PAGE_OBSERVATION'; snapshot: PageSnapshot; source?: string; }
export type SendExecutionResult =
  | { ok: true; acceptedBy: 'busy' | 'user-turn' | 'composer-cleared'; userMessageId: string | null }
  | { ok: false; reason: string };
export interface ContentCommand {
  type: 'EXECUTE_SEND';
  runId: string;
  revision: number;
  attemptId: string;
  expectedConversationKey: string;
  expectedDocumentId: string;
  expectedParentTurnId: string;
  prompt: string;
}
