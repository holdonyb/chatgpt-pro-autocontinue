import type { ControlRequest, PageInfoRequest, PageObservationRequest, StartRequest } from '../shared/types';
import { control, onObservation, serialized, start, checkAlarm, STABILITY_ALARM_PREFIX } from './coordinator';
import { loadState } from './store';
import { conversationKeyFromUrl } from '../shared/conversation';

const ALARM = 'chatgpt-pro-autocontinue/check';
void chrome.alarms.create(ALARM, { periodInMinutes: 1 });
chrome.runtime.onStartup.addListener(() => { void chrome.alarms.create(ALARM, { periodInMinutes: 1 }); });
chrome.runtime.onInstalled.addListener(() => { void chrome.alarms.create(ALARM, { periodInMinutes: 1 }); });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM || alarm.name.startsWith(STABILITY_ALARM_PREFIX)) void serialized(() => checkAlarm(alarm.name));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void serialized(async () => {
    const task = (await loadState()).task;
    if (task?.boundTabId === tabId) await control('PAUSE', 'TAB_UNAVAILABLE');
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void serialized(async () => {
    const task = (await loadState()).task;
    if (!task || task.boundTabId !== tabId) return;
    if (tab.discarded) await control('PAUSE', 'TAB_DISCARDED');
    else if (changeInfo.url && conversationKeyFromUrl(changeInfo.url) !== task.conversationKey) await control('PAUSE', 'CONVERSATION_CHANGED', `tab=${tabId} source=tab-url-change`);
    else if ((tab as chrome.tabs.Tab & { frozen?: boolean }).frozen) await control('PAUSE', 'TAB_FROZEN');
  });
});

chrome.runtime.onMessage.addListener((message: StartRequest | ControlRequest | PageInfoRequest | PageObservationRequest, sender, sendResponse) => {
  void serialized(async () => {
    if (message.type === 'GET_STATUS') {
      const persisted = await loadState();
      return { ok: true, state: persisted.task, logs: persisted.logs };
    }
    if (message.type === 'GET_PAGE_INFO') {
      const tabId = sender.tab?.id ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
      if (tabId === undefined) return { ok: false, error: '没有找到当前标签页' };
      try { return { ok: true, snapshot: await chrome.tabs.sendMessage(tabId, { type: 'GET_SNAPSHOT' }) }; }
      catch { return { ok: false, error: '当前页面还没有加载扩展脚本' }; }
    }
    if (message.type === 'START') return start(sender.tab?.id ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id ?? -1, message);
    if (message.type === 'PAGE_OBSERVATION') {
      await onObservation(message, { tabId: sender.tab?.id, frameId: sender.frameId });
      return { ok: true };
    }
    return { ok: Boolean(await control(message.type)) };
  }).then(sendResponse, (error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});
