import path from 'node:path';
import { config } from './config.js';
import { formatKst } from './callingbot.js';
import { addCallHistory } from './callHistory.js';
import { readJsonFile, updateJsonFile, withFileLock } from './stateFile.js';

const schedulePath = path.join(config.stateDir, 'scheduled-calls.json');
const CALL_LEAD_MS = 30_000;

async function readSchedulesFile() {
  const items = await readJsonFile(schedulePath, []);
  return Array.isArray(items) ? items : [];
}

function sortSchedules(items) {
  return items.sort((a, b) => new Date(a.runAt ?? a.scheduledAt) - new Date(b.runAt ?? b.scheduledAt));
}

async function updateSchedules(updater) {
  return updateJsonFile(schedulePath, [], async (items) => updater(Array.isArray(items) ? items : []));
}

export async function addScheduledCall({ chatId, job, scheduledAt }) {
  return updateSchedules(async (items) => {
    const id = `call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const runAt = new Date(scheduledAt.getTime() - CALL_LEAD_MS);
    const item = {
      id,
      chatId: String(chatId),
      job,
      scheduledAt: scheduledAt.toISOString(),
      runAt: runAt.toISOString(),
      createdAt: new Date().toISOString()
    };
    return {
      next: sortSchedules([...items, item]),
      result: item
    };
  });
}

export async function listScheduledCalls(chatId) {
  return withFileLock(schedulePath, async () => {
    const items = await readSchedulesFile();
    return items
      .filter((item) => !chatId || String(item.chatId) === String(chatId))
      .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  });
}

export async function cancelScheduledCall(chatId, id) {
  return updateSchedules(async (items) => {
    const next = items.filter((item) => !(item.id === id && String(item.chatId) === String(chatId)));
    return {
      next,
      result: next.length !== items.length
    };
  });
}

export async function cancelScheduledCalls(chatId) {
  return updateSchedules(async (items) => {
    const next = items.filter((item) => String(item.chatId) !== String(chatId));
    return {
      next,
      result: items.length - next.length
    };
  });
}

export function formatScheduledCall(item) {
  return [
    `id: ${item.id}`,
    `time: ${formatKst(new Date(item.scheduledAt))} KST`,
    `call starts: ${formatKst(new Date(item.runAt ?? item.scheduledAt))} KST`,
    item.job.kind === 'zoom' ? `url: ${item.job.joinUrl}` : `to: ${item.job.to}`,
    item.job.kind === 'zoom' ? `nickname: ${item.job.botName || config.defaultZoomBotName}` : null,
    `title: ${item.job.title}`
  ].filter(Boolean).join('\n');
}

async function popDueSchedules() {
  return updateSchedules(async (items) => {
    const now = Date.now();
    const due = [];
    const stale = [];
    const pending = [];

    for (const item of items) {
      const dueAt = new Date(item.runAt ?? item.scheduledAt).getTime();
      if (dueAt > now) {
        pending.push(item);
      } else if (config.maxScheduleLagMs > 0 && now - dueAt > config.maxScheduleLagMs) {
        stale.push(item);
      } else {
        due.push(item);
      }
    }

    return {
      next: pending,
      result: { due, stale }
    };
  });
}

export function startCallScheduler(bot, runner) {
  let running = false;
  let timer = null;
  let stopped = false;

  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const { due, stale } = await popDueSchedules();
      for (const item of stale) {
        try {
          await addCallHistory({
            chatId: item.chatId,
            event: 'skipped',
            source: 'scheduled',
            job: item.job,
            scheduleId: item.id,
            scheduledAt: item.scheduledAt,
            runAt: item.runAt,
            error: `Missed scheduled run by more than ${config.maxScheduleLagMs}ms`
          });
          await bot.api.sendMessage(item.chatId, [
            'Scheduled call skipped because it was too old.',
            `time: ${formatKst(new Date(item.scheduledAt))} KST`,
            `call starts: ${formatKst(new Date(item.runAt ?? item.scheduledAt))} KST`,
            `title: ${item.job.title}`
          ].join('\n'));
        } catch (error) {
          console.error('Failed to record skipped scheduled call:', error);
        }
      }
      for (const item of due) {
        try {
          await bot.api.sendMessage(item.chatId, [
            'Scheduled call starting.',
            `time: ${formatKst(new Date(item.scheduledAt))} KST`,
            `call starts: ${formatKst(new Date(item.runAt ?? item.scheduledAt))} KST`,
            item.job.kind === 'zoom' ? `url: ${item.job.joinUrl}` : `to: ${item.job.to}`,
            item.job.kind === 'zoom' ? `nickname: ${item.job.botName || config.defaultZoomBotName}` : null,
            `title: ${item.job.title}`
          ].filter(Boolean).join('\n'));
          const result = await runner(item.job, { chatId: item.chatId });
          await addCallHistory({
            chatId: item.chatId,
            event: 'started',
            source: 'scheduled',
            job: item.job,
            scheduleId: item.id,
            scheduledAt: item.scheduledAt,
            runAt: item.runAt,
            result
          });
          await bot.api.sendMessage(item.chatId, [
            item.job.kind === 'zoom' ? 'Zoom link bot started.' : 'CallingBot call started.',
            item.job.kind === 'zoom' ? `url: ${item.job.joinUrl}` : `to: ${item.job.to}`,
            item.job.kind === 'zoom' ? `nickname: ${item.job.botName || config.defaultZoomBotName}` : null,
            `title: ${item.job.title}`,
            result.callSid ? `callSid: ${result.callSid}` : JSON.stringify(result)
          ].filter(Boolean).join('\n'));
        } catch (error) {
          await addCallHistory({
            chatId: item.chatId,
            event: 'failed',
            source: 'scheduled',
            job: item.job,
            scheduleId: item.id,
            scheduledAt: item.scheduledAt,
            runAt: item.runAt,
            error
          });
          await bot.api.sendMessage(item.chatId, `Scheduled call failed: ${error.message}`);
        }
      }
    } catch (error) {
      console.error('Call scheduler failed:', error);
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(tick, 15_000);
    }
  }

  timer = setTimeout(tick, 2_000);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
