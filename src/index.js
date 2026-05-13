import { Bot } from 'grammy';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { callCommandHelp, parseCallCommand, startCallingBotCall } from './callingbot.js';
import { listDir, readTextFile, resolveFrom, runCommand } from './shell.js';
import { providerLabel, runProvider } from './providers/index.js';

const bot = new Bot(config.botToken);
const cwdByChat = new Map();

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

bot.start();
console.log(`Telebot started. root=${config.rootDir}`);
