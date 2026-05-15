import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { formatKst } from './callingbot.js';

const schedulePath = path.join(config.stateDir, 'scheduled-calls.json');
const CALL_LEAD_MS = 30_000;

async function readSchedules() {
  try {
    const text = await fs.readFile(schedulePath, 'utf8');
    const items = JSON.parse(text);
    return Array.isArray(items) ? items : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeSchedules(items) {
  await fs.mkdir(config.stateDir, { recursive: true });
  await fs.writeFile(schedulePath, JSON.stringify(items, null, 2), 'utf8');
}

export async function addScheduledCall({ chatId, job, scheduledAt }) {
  const items = await readSchedules();
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
  items.push(item);
  items.sort((a, b) => new Date(a.runAt ?? a.scheduledAt) - new Date(b.runAt ?? b.scheduledAt));
  await writeSchedules(items);
  return item;
}

export async function listScheduledCalls(chatId) {
  const items = await readSchedules();
  return items
    .filter((item) => !chatId || String(item.chatId) === String(chatId))
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
}

export async function cancelScheduledCall(chatId, id) {
  const items = await readSchedules();
  const next = items.filter((item) => !(item.id === id && String(item.chatId) === String(chatId)));
  await writeSchedules(next);
  return next.length !== items.length;
}

export function formatScheduledCall(item) {
  return [
    `id: ${item.id}`,
    `time: ${formatKst(new Date(item.scheduledAt))} KST`,
    `call starts: ${formatKst(new Date(item.runAt ?? item.scheduledAt))} KST`,
    `to: ${item.job.to}`,
    `title: ${item.job.title}`
  ].join('\n');
}

async function popDueSchedules() {
  const items = await readSchedules();
  const now = Date.now();
  const due = [];
  const pending = [];

  for (const item of items) {
    if (new Date(item.runAt ?? item.scheduledAt).getTime() <= now) due.push(item);
    else pending.push(item);
  }

  if (due.length) await writeSchedules(pending);
  return due;
}

export function startCallScheduler(bot, runner) {
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const due = await popDueSchedules();
      for (const item of due) {
        try {
          await bot.api.sendMessage(item.chatId, [
            'Scheduled call starting.',
            `time: ${formatKst(new Date(item.scheduledAt))} KST`,
            `call starts: ${formatKst(new Date(item.runAt ?? item.scheduledAt))} KST`,
            `to: ${item.job.to}`,
            `title: ${item.job.title}`
          ].join('\n'));
          const result = await runner(item.job, { chatId: item.chatId });
          await bot.api.sendMessage(item.chatId, [
            'CallingBot call started.',
            `to: ${item.job.to}`,
            `title: ${item.job.title}`,
            result.callSid ? `callSid: ${result.callSid}` : JSON.stringify(result)
          ].join('\n'));
        } catch (error) {
          await bot.api.sendMessage(item.chatId, `Scheduled call failed: ${error.message}`);
        }
      }
    } catch (error) {
      console.error('Call scheduler failed:', error);
    } finally {
      running = false;
    }
  }

  setInterval(tick, 15_000);
  setTimeout(tick, 2_000);
}
