import { pauseReasonLabel, stateLabel } from '../core/reducer';
import type { PersistedState, TaskRecord } from '../shared/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const prompt = $('prompt') as HTMLTextAreaElement;
const maxSends = $('maxSends') as HTMLInputElement;
const hours = $('hours') as HTMLInputElement;
const staleRefreshMinutes = $('staleRefreshMinutes') as HTMLInputElement;
let latestLogText = '暂无日志';

function send(message: unknown): Promise<any> { return chrome.runtime.sendMessage(message); }

async function refresh(): Promise<void> {
  const status = await send({ type: 'GET_STATUS' });
  const page = await send({ type: 'GET_PAGE_INFO' });
  const task = status?.state as TaskRecord | null;
  const logs = (status?.logs ?? []) as PersistedState['logs'];
  latestLogText = logs.length ? logs.map((entry) => {
    const time = new Date(entry.at).toLocaleTimeString('zh-CN', { hour12: false });
    return `${time} ${entry.event} state=${entry.state ?? '-'} reason=${entry.reason ?? '-'}${entry.detail ? `\n  ${entry.detail}` : ''}`;
  }).join('\n') : '暂无日志';
  $('logs').textContent = latestLogText;
  $('status').textContent = task ? `${stateLabel(task.state, task.pauseReason)} · ${task.confirmedSends}/${task.maxSends}` : '待开始';
  $('reason').textContent = task?.pauseReason && task.pauseReason !== 'NONE' ? `原因：${pauseReasonLabel(task.pauseReason)}${task.statusDetail ? `；${task.statusDetail}` : ''}` : '';
  if (task?.state === 'STOPPED') $('reason').textContent = '任务已结束，可以重新开始。';
  const pageSnapshot = page?.snapshot;
  $('target').textContent = task ? `已绑定对话 ${task.conversationKey.slice(0, 8)}…` : pageSnapshot?.conversationKey ? `当前对话 ${pageSnapshot.conversationKey.slice(0, 8)}…` : '请在目标对话页面打开此弹窗';
  $('mode').textContent = pageSnapshot?.modeLabel ? `已识别模式：${pageSnapshot.modeLabel}` : '模式未知（无法安全启动）';
  if (task?.state === 'WAITING_ANSWER' && pageSnapshot) {
    const currentAnswer = pageSnapshot.lastMessageRole === 'assistant' && pageSnapshot.finalSignal && !task.consumedTurnIds?.includes(pageSnapshot.lastAssistantAnswerId);
    $('reason').textContent = pageSnapshot.busySignal ? 'ChatGPT 正在回答，完成后会继续。' : currentAnswer ? '回答已完成，等待约 10–30 秒进行稳定确认。' : '尚未确认本轮回答完成；长时间无进展时会按设定间隔刷新核对。';
  }
  $('start').toggleAttribute('disabled', Boolean(task && !['STOPPED', 'FINISHED'].includes(task.state)));
  $('pause').toggleAttribute('disabled', !task || task.state !== 'WAITING_ANSWER');
  $('resume').toggleAttribute('disabled', !task || task.state !== 'PAUSED');
  $('stop').toggleAttribute('disabled', !task || ['STOPPED', 'FINISHED'].includes(task.state));
}

// Action feedback is separate from the polled task state so refresh cannot erase it.
$('start').addEventListener('click', async () => {
  const error = $('actionError');
  error.hidden = true;
  error.textContent = '';
  try {
    const result = await send({ type: 'START', prompt: prompt.value.trim(), maxSends: Number(maxSends.value), hours: Number(hours.value), staleRefreshMinutes: Number(staleRefreshMinutes.value) });
    if (!result?.ok) {
      error.textContent = `未能启动：${result?.error ?? '请稍后重试。'}`;
      error.hidden = false;
    }
  } catch {
    error.textContent = '未能启动：无法连接扩展后台，请重新加载扩展并刷新目标页面。';
    error.hidden = false;
  }
  await refresh();
});
$('pause').addEventListener('click', async () => { await send({ type: 'PAUSE' }); await refresh(); });
$('resume').addEventListener('click', async () => { await send({ type: 'RESUME' }); await refresh(); });
$('stop').addEventListener('click', async () => { await send({ type: 'STOP' }); await refresh(); });
$('copyLogs').addEventListener('click', async () => {
  await navigator.clipboard.writeText(latestLogText);
  $('copyLogs').textContent = '已复制';
  window.setTimeout(() => { $('copyLogs').textContent = '复制日志'; }, 1_500);
});
void refresh();
window.setInterval(() => { void refresh(); }, 1_000);
