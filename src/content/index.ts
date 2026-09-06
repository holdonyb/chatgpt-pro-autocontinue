import type { ContentCommand, PageObservationRequest } from '../shared/types';
import { adapterHealth, readSnapshot } from './chatgpt-adapter';
import { executeSend } from './editor';

const documentId = crypto.randomUUID();
let lastFingerprint = '';
let alive = true;
let observer: MutationObserver | null = null;
let timer: number | null = null;
let stabilityTimer: number | null = null;
const onPopState = (): void => publish();

function snapshot() { return readSnapshot(documentId); }
function stopStaleScript(): void {
  alive = false;
  observer?.disconnect();
  if (timer !== null) window.clearInterval(timer);
  if (stabilityTimer !== null) window.clearTimeout(stabilityTimer);
  window.removeEventListener('popstate', onPopState);
}
function scheduleStabilityRecheck(delayMs = 10_500): void {
  if (stabilityTimer !== null) window.clearTimeout(stabilityTimer);
  stabilityTimer = window.setTimeout(() => {
    stabilityTimer = null;
    publish(true);
  }, delayMs);
}
function publish(force = false, source = force ? 'stability-recheck' : 'page-change'): void {
  try {
    if (!alive || !chrome.runtime?.id) { stopStaleScript(); return; }
  } catch { stopStaleScript(); return; }
  const value = snapshot();
  const fingerprint = JSON.stringify([value.conversationKey, value.branchFingerprint, value.modeFingerprint, value.lastAssistantAnswerId, value.answerFingerprint, value.lastUserTurnId, value.status, value.finalSignal, value.busySignal, value.editorEmpty, value.hasPendingAttachment]);
  if (fingerprint === lastFingerprint && !force) return;
  lastFingerprint = fingerprint;
  const message: PageObservationRequest = { type: 'PAGE_OBSERVATION', snapshot: value, source };
  try { void chrome.runtime.sendMessage(message).catch(() => undefined); }
  catch { stopStaleScript(); }
  if (!force && value.finalSignal && !value.busySignal) scheduleStabilityRecheck();
}

chrome.runtime.onMessage.addListener((message: { type: string; command?: ContentCommand; delayMs?: number }, _sender, sendResponse) => {
  if (message.type === 'GET_SNAPSHOT') { sendResponse(snapshot()); return false; }
  if (message.type === 'GET_HEALTH') { sendResponse(adapterHealth()); return false; }
  if (message.type === 'SCHEDULE_STABILITY_RECHECK') {
    const delay = typeof message.delayMs === 'number' ? message.delayMs : 10_500;
    scheduleStabilityRecheck(Math.max(10_000, delay));
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'EXECUTE_SEND' && message.command) {
    const current = snapshot();
    void executeSend(message.command, current).then((result) => {
      try {
        if (!alive || !chrome.runtime?.id) { stopStaleScript(); return; }
        sendResponse(result);
        if (result.ok) window.setTimeout(() => publish(true, 'after-send'), 250);
      } catch { stopStaleScript(); }
    }).catch((error) => {
      try { sendResponse({ ok: false, reason: error instanceof Error ? error.message : String(error) }); }
      catch { stopStaleScript(); }
    });
    return true;
  }
  return false;
});

observer = new MutationObserver(() => publish());
observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-is-streaming', 'data-complete', 'disabled'] });
window.addEventListener('popstate', onPopState);
timer = window.setInterval(publish, 2_000);
publish();
