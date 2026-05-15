import { Bot, Keyboard } from 'grammy';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import {
  callCommandHelp,
  buildDigitsFromCodes,
  formatKst,
  hangupCallingBotCall,
  normalizePhone,
  parseCallCommand,
  parseKeyValueLines,
  parseScheduleCallCommand,
  parseScheduleTime,
  scheduleCallCommandHelp,
  startCallingBotCall
} from './callingbot.js';
import { listDir, readTextFile, resolveFrom, runCommand } from './shell.js';
import { providerLabel, runProvider } from './providers/index.js';
import {
  addScheduledCall,
  cancelScheduledCall,
  formatScheduledCall,
  listScheduledCalls,
  startCallScheduler
} from './scheduler.js';

const bot = new Bot(config.botToken);
const cwdByChat = new Map();
const callForms = new Map();
const DEFAULT_ZOOM_DIAL_IN = '+16694449171';

function isAllowed(ctx) {
  return config.allowedChatIds.includes(String(ctx.chat?.id));
}

function cwdFor(ctx) {
  const chatId = String(ctx.chat.id);
  if (!cwdByChat.has(chatId)) cwdByChat.set(chatId, config.rootDir);
  return cwdByChat.get(chatId);
}

function argText(ctx) {
  return (ctx.message?.text ?? '').replace(/^\/\S+\s*/, '').trim();
}

function skipKeyboard() {
  return new Keyboard().text('/skip').text('/cancel').resized().oneTime();
}

function callTypeKeyboard() {
  return new Keyboard().text('1. Zoom dial-in').text('2. 일반 전화').text('/cancel').resized().oneTime();
}

function removeKeyboard() {
  return { remove_keyboard: true };
}

async function promptCallForm(ctx, form) {
  const prompts = {
    type: [
      '통화 유형을 선택해주세요.',
      '1. Zoom dial-in: Zoom 전화 접속 번호로 입장',
      '2. 일반 전화: 일반 컨퍼런스콜/ARS'
    ].join('\n'),
    to: form.data.type === 'zoom'
      ? [
        'Zoom dial-in 전화번호를 입력해주세요. 선택 항목입니다.',
        `기본값: ${DEFAULT_ZOOM_DIAL_IN}`,
        '초대장에 별도 dial-in 번호가 있으면 그 번호를 입력하고, 기본값을 쓰려면 /skip'
      ].join('\n')
      : '전화번호를 입력해주세요.\n예: +821022414700 또는 01022414700',
    code1: [
      '입력코드1을 입력해주세요. 선택 항목입니다.',
      '입력하면 자동으로 앞에 ww가 붙습니다.',
      '예: 572648# -> ww572648#',
      '없으면 /skip'
    ].join('\n'),
    code2: [
      '입력코드2를 입력해주세요. 선택 항목입니다.',
      '입력하면 자동으로 앞에 ww가 붙습니다.',
      '없으면 /skip'
    ].join('\n'),
    meetingId: [
      'Zoom Meeting ID를 입력해주세요.',
      '예: 1234567890 또는 123 456 7890'
    ].join('\n'),
    passcode: [
      'Zoom Passcode를 입력해주세요. 선택 항목입니다.',
      '없으면 /skip'
    ].join('\n'),
    scheduledAt: [
      '예약일시를 입력해주세요. 선택 항목입니다.',
      '예: 2026-05-15 16:30, 05-15 16:30, 16:30, in=10m',
      '바로 전화하려면 /skip'
    ].join('\n'),
    title: [
      '제목을 입력해주세요.',
      '예: 251212_FY4Q25 Broadcom',
      '기본값을 쓰려면 /skip'
    ].join('\n')
  };

  if (form.step === 'type') {
    await ctx.reply(prompts[form.step], { reply_markup: callTypeKeyboard() });
    return;
  }

  const required = form.step === 'meetingId' || (form.step === 'to' && form.data.type !== 'zoom');
  await ctx.reply(prompts[form.step], required ? undefined : { reply_markup: skipKeyboard() });
}

async function startCallForm(ctx) {
  const chatId = String(ctx.chat.id);
  const form = { step: 'type', data: {} };
  callForms.set(chatId, form);
  await ctx.reply('CallingBot call setup을 시작합니다. 중간에 취소하려면 /cancel 을 보내주세요.');
  await promptCallForm(ctx, form);
}

function scheduleEntriesFromInput(value) {
  const text = String(value).trim();
  if (/^\w+\s*=/.test(text)) return parseKeyValueLines(text);
  if (/^\d+\s*(m|min|minute|minutes|분|h|hr|hour|hours|시간|d|day|days|일)$/i.test(text)) {
    return { in: text };
  }
  return { at: text };
}

function normalizeZoomCode(value = '') {
  return String(value).trim().replace(/\s+/g, '');
}

function buildZoomDigits({ meetingId = '', passcode = '' } = {}) {
  const meeting = normalizeZoomCode(meetingId);
  const pass = normalizeZoomCode(passcode);
  if (!meeting) return '';
  return `ww${meeting}#ww#${pass ? `ww${pass}#` : ''}`;
}

async function finishCallForm(ctx, form) {
  const data = form.data;
  const isZoom = data.type === 'zoom';
  const job = {
    to: normalizePhone(data.to),
    title: data.title || 'telegram-call',
    note: '',
    silenceTimeout: 120,
    digits: isZoom
      ? buildZoomDigits({ meetingId: data.meetingId, passcode: data.passcode })
      : buildDigitsFromCodes({ code1: data.code1, code2: data.code2 })
  };

  if (data.scheduledAt) {
    const scheduledAt = parseScheduleTime(scheduleEntriesFromInput(data.scheduledAt));
    const item = await addScheduledCall({ chatId: ctx.chat.id, job, scheduledAt });
    await ctx.reply([
      'CallingBot call scheduled.',
      `id: ${item.id}`,
      `time: ${formatKst(scheduledAt)} KST`,
      `to: ${job.to}`,
      `type: ${isZoom ? 'Zoom dial-in' : 'phone'}`,
      `digits: ${job.digits || '(none)'}`,
      `title: ${job.title}`
    ].join('\n'), { reply_markup: removeKeyboard() });
    return;
  }

  const result = await startCallingBotCall(job, { chatId: ctx.chat.id });
  await ctx.reply([
    'CallingBot call started.',
    `to: ${job.to}`,
    `type: ${isZoom ? 'Zoom dial-in' : 'phone'}`,
    `digits: ${job.digits || '(none)'}`,
    `title: ${job.title}`,
    result.callSid ? `callSid: ${result.callSid}` : JSON.stringify(result)
  ].join('\n'), { reply_markup: removeKeyboard() });
}

async function handleCallFormMessage(ctx) {
  const chatId = String(ctx.chat.id);
  const form = callForms.get(chatId);
  if (!form) return false;

  const text = ctx.message.text.trim();
  const lower = text.toLowerCase();
  if (lower === '/cancel') {
    callForms.delete(chatId);
    await ctx.reply('CallingBot call setup cancelled.', { reply_markup: removeKeyboard() });
    return true;
  }

  const skipped = lower === '/skip';
  try {
    if (form.step === 'type') {
      if (['1', '1.', '1. zoom dial-in', 'zoom dial-in', 'zoom', '/zoom'].includes(lower)) {
        form.data.type = 'zoom';
      } else if (['2', '2.', '2. 일반 전화', '일반 전화', 'phone', '/phone'].includes(lower)) {
        form.data.type = 'phone';
      } else {
        throw new Error('통화 유형은 1. Zoom dial-in 또는 2. 일반 전화 중 하나를 선택해주세요.');
      }
      form.step = 'to';
    } else if (form.step === 'to') {
      if (form.data.type === 'zoom' && skipped) {
        form.data.to = DEFAULT_ZOOM_DIAL_IN;
      } else {
        if (skipped || !text) throw new Error('전화번호는 필수입니다.');
        form.data.to = text;
      }
      form.step = form.data.type === 'zoom' ? 'meetingId' : 'code1';
    } else if (form.step === 'meetingId') {
      if (skipped || !text) throw new Error('Zoom Meeting ID는 필수입니다.');
      form.data.meetingId = text;
      form.step = 'passcode';
    } else if (form.step === 'passcode') {
      if (!skipped) form.data.passcode = text;
      form.step = 'scheduledAt';
    } else if (form.step === 'code1') {
      if (!skipped) form.data.code1 = text;
      form.step = skipped ? 'scheduledAt' : 'code2';
    } else if (form.step === 'code2') {
      if (!skipped) form.data.code2 = text;
      form.step = 'scheduledAt';
    } else if (form.step === 'scheduledAt') {
      if (!skipped) form.data.scheduledAt = text;
      form.step = 'title';
    } else if (form.step === 'title') {
      if (!skipped) form.data.title = text;
      callForms.delete(chatId);
      await finishCallForm(ctx, form);
      return true;
    }

    await promptCallForm(ctx, form);
  } catch (error) {
    await ctx.reply(`Error: ${error.message}`);
    await promptCallForm(ctx, form);
  }
  return true;
}

async function replyLong(ctx, text) {
  const safe = text || '(no output)';
  for (let i = 0; i < safe.length; i += 3900) {
    await ctx.reply(safe.slice(i, i + 3900));
  }
}

async function startProgress(ctx, label) {
  const frames = [
    `${label} is processing`,
    `${label} is processing.`,
    `${label} is processing..`,
    `${label} is processing...`,
    `${label} is processing....`,
    `${label} is processing.....`
  ];
  const message = await ctx.reply(frames[0]);
  let index = 1;
  const timer = setInterval(async () => {
    try {
      await ctx.api.editMessageText(ctx.chat.id, message.message_id, frames[index % frames.length]);
      index += 1;
    } catch {
      clearInterval(timer);
    }
  }, 1200);

  return {
    stop: async (finalText = null) => {
      clearInterval(timer);
      try {
        if (finalText) {
          await ctx.api.editMessageText(ctx.chat.id, message.message_id, finalText);
          return;
        }
        await ctx.api.deleteMessage(ctx.chat.id, message.message_id);
      } catch {
        if (finalText) await ctx.reply(finalText);
      }
    }
  };
}

function helpText() {
  return [
    'Telebot commands:',
    '/pwd',
    '/ls [path]',
    '/cd path',
    '/cat path',
    '/run command',
    '/call',
    '/hangup [callSid]',
    '/schedule_call',
    '/scheduled_calls',
    '/cancel_call id',
    '/ai prompt',
    '/claude prompt',
    '/gpt prompt',
    '/gemini prompt',
    '',
    `Default AI provider: ${providerLabel()}`,
    `CallingBot API: ${config.callingBotBaseUrl}`,
    'This bot only accepts configured chat IDs.'
  ].join('\n');
}

bot.use(async (ctx, next) => {
  if (!isAllowed(ctx)) {
    if (ctx.chat?.id) console.warn(`Rejected chat ${ctx.chat.id}`);
    return;
  }
  await next();
});

bot.command(['start', 'help'], async (ctx) => {
  await ctx.reply(helpText());
});

bot.command('pwd', async (ctx) => {
  await ctx.reply(cwdFor(ctx));
});

bot.command('ls', async (ctx) => {
  try {
    const result = await listDir(cwdFor(ctx), argText(ctx) || '.');
    await replyLong(ctx, `${result.cwd}\n\n${result.text}`);
  } catch (error) {
    await ctx.reply(`Error: ${error.message}`);
  }
});

bot.command('cd', async (ctx) => {
  try {
    const target = argText(ctx);
    if (!target) throw new Error('Usage: /cd path');
    const nextCwd = resolveFrom(cwdFor(ctx), target);
    const stat = await fs.stat(nextCwd);
    if (!stat.isDirectory()) throw new Error('Not a directory');
    cwdByChat.set(String(ctx.chat.id), nextCwd);
    await ctx.reply(nextCwd);
  } catch (error) {
    await ctx.reply(`Error: ${error.message}`);
  }
});

bot.command('cat', async (ctx) => {
  try {
    const result = await readTextFile(cwdFor(ctx), argText(ctx));
    await replyLong(ctx, `${result.filePath}\n\n${result.text}`);
  } catch (error) {
    await ctx.reply(`Error: ${error.message}`);
  }
});

bot.command('run', async (ctx) => {
  try {
    const output = await runCommand(cwdFor(ctx), argText(ctx));
    await replyLong(ctx, output);
  } catch (error) {
    await ctx.reply(`Error: ${error.message}`);
  }
});

bot.command('call', async (ctx) => {
  try {
    if (!argText(ctx)) {
      await startCallForm(ctx);
      return;
    }
    const job = parseCallCommand(ctx.message?.text ?? '');
    const result = await startCallingBotCall(job, { chatId: ctx.chat.id });
    await ctx.reply([
      'CallingBot call started.',
      `to: ${job.to}`,
      `title: ${job.title}`,
      result.callSid ? `callSid: ${result.callSid}` : JSON.stringify(result)
    ].join('\n'));
  } catch (error) {
    await ctx.reply(`${error.message}\n\n${callCommandHelp()}`);
  }
});

bot.command('hangup', async (ctx) => {
  try {
    const callSid = argText(ctx);
    const result = await hangupCallingBotCall(callSid);
    if (!result.count) {
      await ctx.reply('No active CallingBot calls found.');
      return;
    }
    await ctx.reply([
      'CallingBot call hangup requested.',
      `count: ${result.count}`,
      ...result.calls.map((call) => `${call.sid}: ${call.status}`)
    ].join('\n'));
  } catch (error) {
    await ctx.reply(`Error: ${error.message}`);
  }
});

bot.command('schedule_call', async (ctx) => {
  try {
    const { job, scheduledAt } = parseScheduleCallCommand(ctx.message?.text ?? '');
    const item = await addScheduledCall({ chatId: ctx.chat.id, job, scheduledAt });
    await ctx.reply([
      'CallingBot call scheduled.',
      `id: ${item.id}`,
      `time: ${formatKst(scheduledAt)} KST`,
      `to: ${job.to}`,
      `title: ${job.title}`
    ].join('\n'));
  } catch (error) {
    await ctx.reply(`${error.message}\n\n${scheduleCallCommandHelp()}`);
  }
});

bot.command('scheduled_calls', async (ctx) => {
  try {
    const items = await listScheduledCalls(ctx.chat.id);
    if (!items.length) {
      await ctx.reply('No scheduled calls.');
      return;
    }
    await replyLong(ctx, items.map(formatScheduledCall).join('\n\n'));
  } catch (error) {
    await ctx.reply(`Error: ${error.message}`);
  }
});

bot.command('cancel_call', async (ctx) => {
  try {
    const id = argText(ctx);
    if (!id) throw new Error('Usage: /cancel_call id');
    const cancelled = await cancelScheduledCall(ctx.chat.id, id);
    await ctx.reply(cancelled ? `Cancelled: ${id}` : `No scheduled call found: ${id}`);
  } catch (error) {
    await ctx.reply(`Error: ${error.message}`);
  }
});

async function handleAi(ctx, provider) {
  let progress = null;
  try {
    const prompt = argText(ctx);
    const selected = providerLabel(provider);
    if (!prompt) throw new Error(`Usage: /${selected === config.aiProvider ? 'ai' : selected} prompt`);
    progress = await startProgress(ctx, selected);
    const output = await runProvider(selected, prompt, { cwd: cwdFor(ctx) });
    await progress.stop();
    await replyLong(ctx, output);
  } catch (error) {
    if (progress) await progress.stop('Processing failed.');
    await ctx.reply(`Error: ${error.message}`);
  }
}

bot.command('ai', async (ctx) => {
  await handleAi(ctx, config.aiProvider);
});

bot.command('claude', async (ctx) => {
  await handleAi(ctx, 'claude');
});

bot.command('gpt', async (ctx) => {
  await handleAi(ctx, 'openai');
});

bot.command('gemini', async (ctx) => {
  await handleAi(ctx, 'gemini');
});

bot.on('message:text', async (ctx) => {
  if (await handleCallFormMessage(ctx)) return;

  const text = ctx.message.text.trim();
  if (text.startsWith('/')) {
    await ctx.reply('Unknown command. Send /help.');
    return;
  }
  await handleAi(ctx, config.aiProvider);
});

bot.catch((error) => {
  console.error('Telegram bot error:', error);
});

startCallScheduler(bot, startCallingBotCall);
bot.start();
console.log(`Telebot started. root=${config.rootDir}`);
