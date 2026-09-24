import type { PageSnapshot } from '../shared/types';
import { withTimeout } from '../shared/timeout';

const READ_TIMEOUT = 'snapshot-request-timeout';

function errorCategory(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === READ_TIMEOUT) return 'timeout';
  if (/receiving end does not exist/i.test(message)) return 'receiver-missing';
  if (/message (?:port|channel).*closed|channel closed/i.test(message)) return 'channel-closed';
  if (/extension context invalidated/i.test(message)) return 'context-invalidated';
  if (/no tab with id|invalid tab id/i.test(message)) return 'tab-missing';
  return 'transport-error';
}

// Keep the full error private: it may contain arbitrary page text or URLs.
export async function probeSnapshot(tabId: number): Promise<{ snapshot: PageSnapshot | null; detail: string }> {
  const started = Date.now();
  let cause: string;
  try {
    const reply = await withTimeout(chrome.tabs.sendMessage(tabId, { type: 'GET_SNAPSHOT' }, { frameId: 0 }), 5_000, READ_TIMEOUT);
    if (reply?.errorCode === 'SNAPSHOT_EXCEPTION') cause = 'snapshot-exception';
    else if (!reply) cause = 'empty-reply';
    else if (typeof reply.documentId !== 'string' || !['READY', 'BUSY', 'UNKNOWN', 'ERROR'].includes(reply.status)) cause = 'invalid-reply';
    else return { snapshot: reply, detail: '' };
  } catch (error) { cause = errorCategory(error); }
  return { snapshot: null, detail: `cause=${cause} elapsedMs=${Math.max(0, Date.now() - started)} timeoutMs=5000` };
}

// Browser-owned tab metadata remains queryable independently of content scripts.
// This is sampled AFTER failure, not proof of the tab state throughout the request.
export async function failedTabDetail(tabId: number): Promise<string> {
  try {
    const tab = await withTimeout(chrome.tabs.get(tabId), 2_000, 'tab-metadata-timeout');
    const frozen = (tab as chrome.tabs.Tab & { frozen?: boolean }).frozen;
    return `tabProbe=ok frozen=${frozen ?? 'unknown'} discarded=${tab.discarded ?? 'unknown'} active=${tab.active ?? 'unknown'} tabStatus=${['loading', 'complete'].includes(tab.status ?? '') ? tab.status : 'unknown'}`;
  } catch { return 'tabProbe=unavailable frozen=unknown discarded=unknown active=unknown tabStatus=unknown'; }
}
