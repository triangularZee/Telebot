import { Bot } from 'grammy';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { listDir, readTextFile, resolveFrom, runCommand } from './shell.js';

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

function helpText() {
  return [
    'Telebot commands:',
    '/pwd',
    '/ls [path]',
    '/cd path',
    '/cat path',
    '/run command',
    '',
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

bot.on('message:text', async (ctx) => {
  await ctx.reply('Unknown command. Send /help.');
});

bot.catch((error) => {
  console.error('Telegram bot error:', error);
});

bot.start();
console.log(`Telebot started. root=${config.rootDir}`);
