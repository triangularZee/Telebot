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
  startCallingBotCall,
  startCallingBotZoom
} from './callingbot.js';
import { listDir, readTextFile, resolveFrom, runCommand } from './shell.js';
import { providerLabel, runProvider } from './providers/index.js';
import { addCallHistory, formatCallHistoryItem, listCallHistory } from './callHistory.js';
import {
  addScheduledCall,
  cancelScheduledCall,
  cancelScheduledCalls,
  formatScheduledCall,
  listScheduledCalls,
  startCallScheduler
} from './scheduler.js';

const bot = new Bot(config.botToken);
const cwdByChat = new Map();
const callForms = new Map();
const DEFAULT_ZOOM_DIAL_IN = '+82231439612';
const DEFAULT_ZOOM_BOT_NAME = '신한 박시은';

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
  return new Keyboard()
    .text('1. 일반 전화')
    .text('2. Zoom link')
    .row()
    .text('3. 예약 목록')
    .text('4. 통화 내역')
    .row()
    .text('/cancel')
    .resized()
    .oneTime();
}

function removeKeyboard() {
  return { remove_keyboard: true };
}

async function promptCallForm(ctx, form) {
  const prompts = {
    type: [
      '통화 유형을 선택해주세요.',
      '1. 일반 전화: 일반 컨퍼런스콜/ARS',
      '2. Zoom link: Zoom 링크로 브라우저 입장'
    ].join('\n'),
    zoomUrl: [
      'Zoom 접속 링크를 입력해주세요.',
      '예: https://us06web.zoom.us/j/5025081684?pwd=...'
    ].join('\n'),
    zoomBotName: [
      'Zoom 참가 닉네임을 입력해주세요. 선택 항목입니다.',
      `기본값: ${DEFAULT_ZOOM_BOT_NAME}`,
      '기본값을 쓰려면 /skip'
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
      '전화 접속용 숫자 PW만 가능합니다. Zoom URL의 pwd= 알파벳 값은 전화 키패드로 입력할 수 없습니다.',
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
  if (form.step === 'zoomUrl') {
    await ctx.reply(prompts[form.step]);
    return;
  }
  await ctx.reply(prompts[form.step], required ? undefined : { reply_markup: skipKeyboard() });
}

async function startCallForm(ctx) {
  const chatId = String(ctx.chat.id);
  const form = { step: 'type', data: {} };
  callForms.set(chatId, form);
  await ctx.reply([
    'CallingBot call setup을 시작합니다.',
    '예약 목록: /call schedule',
    '통화 내역: /call history',
    '중간에 취소하려면 /cancel'
  ].join('\n'));
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

function extractFirstUrl(value = '') {
  const match = String(value).match(/https?:\/\/[^\s<>"'`,}\]]+/i);
  return match ? match[0].replace(/[)>.,，。]+$/g, '') : String(value).trim();
}

function validateDtmfValue(value, label) {
  if (value && !/^[0-9*#]+$/.test(value)) {
    throw new Error(`${label}는 전화 키패드로 입력 가능한 숫자, *, #만 사용할 수 있습니다. Zoom 링크의 pwd= 값이 아니라 초대장에 표시된 숫자 PW를 넣어주세요.`);
  }
}

function buildZoomDigits({ meetingId = '', passcode = '' } = {}) {
  const meeting = normalizeZoomCode(meetingId);
  const pass = normalizeZoomCode(passcode);
  if (!meeting) return '';
  validateDtmfValue(meeting, 'Zoom Meeting ID');
  validateDtmfValue(pass, 'Zoom Passcode');
  return `ww${meeting}#ww#${pass ? `ww${pass}#` : ''}`;
}

async function finishCallForm(ctx, form) {
  const data = form.data;
  const isZoom = data.type === 'zoom';
  const isZoomLink = data.type === 'zoom_link';
  if (isZoomLink) {
    const job = {
      kind: 'zoom',
      joinUrl: data.zoomUrl,
      botName: data.zoomBotName,
      title: data.title || 'zoom-meeting',
      note: '',
      maxMinutes: 120
    };

    if (data.scheduledAt) {
      const scheduledAt = parseScheduleTime(scheduleEntriesFromInput(data.scheduledAt));
      const item = await addScheduledCall({ chatId: ctx.chat.id, job, scheduledAt });
      await addCallHistory({
        chatId: ctx.chat.id,
        event: 'scheduled',
        source: 'form',
        job,
        scheduleId: item.id,
        scheduledAt: item.scheduledAt,
        runAt: item.runAt
      });
      await ctx.reply([
        'Zoom link bot scheduled.',
        `id: ${item.id}`,
        `time: ${formatKst(scheduledAt)} KST`,
        `url: ${job.joinUrl}`,
        `nickname: ${job.botName || DEFAULT_ZOOM_BOT_NAME}`,
        `title: ${job.title}`
      ].join('\n'), { reply_markup: removeKeyboard() });
      return;
    }

    const result = await startCallingBotZoom(job, { chatId: ctx.chat.id });
    await addCallHistory({
      chatId: ctx.chat.id,
      event: 'started',
      source: 'form',
      job,
      result
    });
    await ctx.reply([
      'Zoom link bot started.',
      `url: ${job.joinUrl}`,
      `nickname: ${job.botName || DEFAULT_ZOOM_BOT_NAME}`,
      `title: ${job.title}`,
      JSON.stringify(result)
    ].join('\n'), { reply_markup: removeKeyboard() });
    return;
  }

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
    await addCallHistory({
      chatId: ctx.chat.id,
      event: 'scheduled',
      source: 'form',
      job,
      scheduleId: item.id,
      scheduledAt: item.scheduledAt,
      runAt: item.runAt
    });
    await ctx.reply([
      'CallingBot call scheduled.',
      `id: ${item.id}`,
      `time: ${formatKst(scheduledAt)} KST`,
      `to: ${job.to}`,
      `type: ${isZoom ? 'Zoom dial-in' : 'phone'}`,
      isZoom ? `meeting: ${normalizeZoomCode(data.meetingId)}` : `digits: ${job.digits || '(none)'}`,
      isZoom ? `passcode: ${normalizeZoomCode(data.passcode) || '(none)'}` : null,
      `title: ${job.title}`
    ].filter(Boolean).join('\n'), { reply_markup: removeKeyboard() });
    return;
  }

  const result = await startCallingBotCall(job, { chatId: ctx.chat.id });
  await addCallHistory({
    chatId: ctx.chat.id,
    event: 'started',
    source: 'form',
    job,
    result
  });
  await ctx.reply([
    'CallingBot call started.',
    `to: ${job.to}`,
    `type: ${isZoom ? 'Zoom dial-in' : 'phone'}`,
    isZoom ? `meeting: ${normalizeZoomCode(data.meetingId)}` : `digits: ${job.digits || '(none)'}`,
    isZoom ? `passcode: ${normalizeZoomCode(data.passcode) || '(none)'}` : null,
    `title: ${job.title}`,
    result.callSid ? `callSid: ${result.callSid}` : JSON.stringify(result)
  ].filter(Boolean).join('\n'), { reply_markup: removeKeyboard() });
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
      if (['3', '3.', '3. 예약 목록', '예약 목록', 'schedule', 'scheduled', 'schedules', '/scheduled_calls'].includes(lower)) {
        await replyScheduledCalls(ctx);
        await promptCallForm(ctx, form);
        return true;
      }
      if (['4', '4.', '4. 통화 내역', '통화 내역', 'history', 'log', 'logs', '내역', '/call_history'].includes(lower)) {
        await replyCallHistory(ctx);
        await promptCallForm(ctx, form);
        return true;
      }
      if (['1', '1.', '1. 일반 전화', '일반 전화', 'phone', '/phone'].includes(lower)) {
        form.data.type = 'phone';
      } else if (['2', '2.', '2. zoom link', 'zoom link', 'link', '/zoomlink', 'zoom', '/zoom'].includes(lower)) {
        form.data.type = 'zoom_link';
      } else {
        throw new Error('통화 유형은 1. 일반 전화, 2. Zoom link, 3. 예약 목록, 4. 통화 내역 중 하나를 선택해주세요.');
      }
      form.step = form.data.type === 'zoom_link' ? 'zoomUrl' : 'to';
    } else if (form.step === 'zoomUrl') {
      if (!text || skipped) throw new Error('Zoom 접속 링크는 필수입니다.');
      form.data.zoomUrl = extractFirstUrl(text);
      form.step = 'zoomBotName';
    } else if (form.step === 'zoomBotName') {
      if (!skipped) form.data.zoomBotName = text.slice(0, 80);
      form.step = 'scheduledAt';
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

async function replyScheduledCalls(ctx) {
  const items = await listScheduledCalls(ctx.chat.id);
  if (!items.length) {
    await ctx.reply('No scheduled calls.');
    return;
  }
  await replyLong(ctx, items.map(formatScheduledCall).join('\n\n'));
}

async function replyCallHistory(ctx) {
  const items = await listCallHistory(ctx.chat.id, 20);
  if (!items.length) {
    await ctx.reply('No call history yet.');
    return;
  }
  await replyLong(ctx, items.map(formatCallHistoryItem).join('\n\n'));
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
    '/call schedule',
    '/call history',
    '/hangup [callSid]',
    '/schedule_call',
    '/scheduled_calls',
    '/call_history',
    '/cancel_schedule id',
    '/cancel_schedule all',
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
    const arg = argText(ctx);
    const lower = arg.toLowerCase();
    if (!arg) {
      await startCallForm(ctx);
      return;
    }
    if (['schedule', 'scheduled', 'schedules', '예약', '예약목록'].includes(lower)) {
      await replyScheduledCalls(ctx);
      return;
    }
    if (['history', 'log', 'logs', '내역', '통화내역'].includes(lower)) {
      await replyCallHistory(ctx);
      return;
    }
    const entries = parseKeyValueLines(ctx.message?.text ?? '');
    const hasSchedule = ['at', 'time', 'datetime', 'in', 'after', '예약', '예약일시', '시간'].some((key) => entries[key]);
    if (hasSchedule) {
      const { job, scheduledAt } = parseScheduleCallCommand(ctx.message?.text ?? '');
      const item = await addScheduledCall({ chatId: ctx.chat.id, job, scheduledAt });
      await addCallHistory({
        chatId: ctx.chat.id,
        event: 'scheduled',
        source: 'command',
        job,
        scheduleId: item.id,
        scheduledAt: item.scheduledAt,
        runAt: item.runAt
      });
      await ctx.reply([
        'CallingBot call scheduled.',
        `id: ${item.id}`,
        `time: ${formatKst(scheduledAt)} KST`,
        `to: ${job.to}`,
        `title: ${job.title}`
      ].join('\n'));
      return;
    }
    const job = parseCallCommand(ctx.message?.text ?? '');
    const result = await startCallingBotCall(job, { chatId: ctx.chat.id });
    await addCallHistory({
      chatId: ctx.chat.id,
      event: 'started',
      source: 'command',
      job,
      result
    });
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
    await addCallHistory({
      chatId: ctx.chat.id,
      event: 'scheduled',
      source: 'command',
      job,
      scheduleId: item.id,
      scheduledAt: item.scheduledAt,
      runAt: item.runAt
    });
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
    await replyScheduledCalls(ctx);
  } catch (error) {
    await ctx.reply(`Error: ${error.message}`);
  }
});

bot.command(['call_history', 'call_logs', 'calls'], async (ctx) => {
  try {
    await replyCallHistory(ctx);
  } catch (error) {
    await ctx.reply(`Error: ${error.message}`);
  }
});

async function handleCancelSchedule(ctx) {
  try {
    const id = argText(ctx);
    if (!id) throw new Error('Usage: /cancel_schedule id\nList schedules with /scheduled_calls');
    if (['all', '*'].includes(id.toLowerCase())) {
      const items = await listScheduledCalls(ctx.chat.id);
      const count = await cancelScheduledCalls(ctx.chat.id);
      for (const item of items) {
        await addCallHistory({
          chatId: ctx.chat.id,
          event: 'cancelled',
          source: 'command',
          job: item.job,
          scheduleId: item.id,
          scheduledAt: item.scheduledAt,
          runAt: item.runAt
        });
      }
      await ctx.reply(count ? `Cancelled ${count} scheduled call(s).` : 'No scheduled calls.');
      return;
    }
    const item = (await listScheduledCalls(ctx.chat.id)).find((candidate) => candidate.id === id);
    const cancelled = await cancelScheduledCall(ctx.chat.id, id);
    if (cancelled && item) {
      await addCallHistory({
        chatId: ctx.chat.id,
        event: 'cancelled',
        source: 'command',
        job: item.job,
        scheduleId: item.id,
        scheduledAt: item.scheduledAt,
        runAt: item.runAt
      });
    }
    await ctx.reply(cancelled ? `Cancelled: ${id}` : `No scheduled call found: ${id}`);
  } catch (error) {
    await ctx.reply(`Error: ${error.message}`);
  }
}

bot.command(['cancel_schedule', 'cancel_scheduled', 'cancel_call'], handleCancelSchedule);

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

startCallScheduler(bot, (job, options) => (
  job.kind === 'zoom' ? startCallingBotZoom(job, options) : startCallingBotCall(job, options)
));
bot.start();
console.log(`Telebot started. root=${config.rootDir}`);
