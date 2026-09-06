import type { PersistedState, TaskRecord } from '../shared/types';
import { showTaskBadge } from './badge';

const KEY = 'chatgpt-pro-autocontinue/state';
const empty: PersistedState = { task: null, logs: [] };

export async function loadState(): Promise<PersistedState> {
  const result = await chrome.storage.local.get(KEY);
  const state = result[KEY] as PersistedState | undefined;
  if (!state || !Array.isArray(state.logs)) return structuredClone(empty);
  return state;
}

export async function saveState(state: PersistedState): Promise<void> {
  await chrome.storage.local.set({ [KEY]: state });
  showTaskBadge(state.task);
}

export async function updateState(mutator: (state: PersistedState) => PersistedState): Promise<PersistedState> {
  const next = mutator(await loadState());
  await saveState(next);
  return next;
}

export function addLog(state: PersistedState, event: string, task: TaskRecord | null, at = Date.now(), detail?: string): PersistedState {
  return { ...state, logs: [...state.logs, { at, event, state: task?.state ?? null, reason: task?.pauseReason, ...(detail ? { detail } : {}) }].slice(-500) };
}
