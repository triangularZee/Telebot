import path from 'node:path';
import { config } from './config.js';
import { formatKst } from './callingbot.js';
import { readJsonFile, updateJsonFile, withFileLock } from './stateFile.js';

const historyPath = path.join(config.stateDir, 'call-history.json');
const MAX_HISTORY_ITEMS = 300;

async function readHistoryFile() {
  const items = await readJsonFile(historyPath, []);
  return Array.isArray(items) ? items : [];
}

function trimHistory(items) {
  return items
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-MAX_HISTORY_ITEMS);
}

function summarizeJob(job = {}) {
  const kind = job.kind === 'zoom' ? 'zoom' : 'phone';
  return {
    kind,
    title: job.title ?? '',
    to: job.to ?? '',
    joinUrl: job.joinUrl ?? '',
    botName: job.botName ?? ''
  };
}

export async function addCallHistory({
  chatId,
  event,
  source = 'manual',
  job = {},
  scheduleId = '',
  scheduledAt = '',
  runAt = '',
  result = null,
  error = ''
}) {
  return updateJsonFile(historyPath, [], async (items) => {
    const safeItems = Array.isArray(items) ? items : [];
    const item = {
      id: `hist-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      chatId: String(chatId),
      event,
      source,
      ...summarizeJob(job),
      scheduleId,
      scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : '',
      runAt: runAt ? new Date(runAt).toISOString() : '',
      callSid: result?.callSid ?? '',
      status: result?.status ?? result?.statusCode ?? '',
      error: error instanceof Error ? error.message : String(error || ''),
      createdAt: new Date().toISOString()
    };
    return {
      next: trimHistory([...safeItems, item]),
      result: item
    };
  });
}

export async function listCallHistory(chatId, limit = 20) {
  return withFileLock(historyPath, async () => {
    const items = await readHistoryFile();
    return items
      .filter((item) => !chatId || String(item.chatId) === String(chatId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  });
}

export function formatCallHistoryItem(item) {
  const lines = [
    `[${formatKst(new Date(item.createdAt))} KST] ${item.event}${item.source ? ` (${item.source})` : ''}`,
    `type: ${item.kind}`,
    item.title ? `title: ${item.title}` : null,
    item.kind === 'zoom' ? `url: ${item.joinUrl}` : `to: ${item.to}`,
    item.kind === 'zoom' && item.botName ? `nickname: ${item.botName}` : null,
    item.scheduleId ? `scheduleId: ${item.scheduleId}` : null,
    item.scheduledAt ? `time: ${formatKst(new Date(item.scheduledAt))} KST` : null,
    item.runAt ? `call starts: ${formatKst(new Date(item.runAt))} KST` : null,
    item.callSid ? `callSid: ${item.callSid}` : null,
    item.status ? `status: ${item.status}` : null,
    item.error ? `error: ${item.error}` : null
  ];
  return lines.filter(Boolean).join('\n');
}
