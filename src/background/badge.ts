import type { TaskRecord } from '../shared/types';
import { pauseReasonLabel } from '../core/reducer';

// Badge failures must never affect the durable state or a send transaction.
export function showTaskBadge(task: TaskRecord | null): void {
  try {
    if (!chrome.action) return;
    const paused = task?.state === 'PAUSED';
    void Promise.allSettled([
      chrome.action.setBadgeText({ text: paused ? '!' : '' }),
      chrome.action.setBadgeBackgroundColor({ color: '#b45309' }),
      chrome.action.setTitle({ title: paused ? `自动续跑：${pauseReasonLabel(task.pauseReason)}` : 'ChatGPT Pro 自动续跑' })
    ]);
  } catch { /* A stale extension context must not change the transaction result. */ }
}

export function reportBackgroundFailure(error: unknown): void {
  console.error('自动续跑后台操作失败', error);
  try {
    if (!chrome.action) return;
    void Promise.allSettled([
      chrome.action.setBadgeText({ text: '!' }),
      chrome.action.setTitle({ title: '自动续跑：后台操作失败，请打开扩展检查状态' })
    ]);
  } catch { /* Chrome may itself be shutting down. */ }
}
