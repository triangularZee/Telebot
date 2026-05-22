import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function boolFromEnv(name, fallback = false) {
  const value = process.env[name];
  if (value == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function numberFromEnv(name, fallback, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

const telegramMessageLimit = 4096;
const maxOutputChars = numberFromEnv('TELEBOT_MAX_OUTPUT_CHARS', 3500, { min: 500 });
const telegramMessageChunkChars = numberFromEnv('TELEBOT_MESSAGE_CHUNK_CHARS', maxOutputChars, {
  min: 500,
  max: telegramMessageLimit
});

export const config = {
  repoRoot,
  botToken: required('TELEGRAM_BOT_TOKEN'),
  allowedChatIds: required('TELEGRAM_ALLOWED_CHAT_IDS')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
  rootDir: path.resolve(repoRoot, process.env.TELEBOT_ROOT_DIR ?? '.'),
  stateDir: path.resolve(process.env.TELEBOT_STATE_DIR ?? path.join(os.homedir(), '.local', 'state', 'telebot')),
  commandTimeoutMs: numberFromEnv('TELEBOT_COMMAND_TIMEOUT_MS', 60000, { min: 1000 }),
  maxOutputChars,
  telegramMessageLimit,
  telegramMessageChunkChars,
  allowDangerousRunCommands: boolFromEnv('TELEBOT_ALLOW_DANGEROUS_RUN', false),
  aiProvider: process.env.AI_PROVIDER ?? 'claude',
  claudeModel: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',
  claudeEffort: process.env.CLAUDE_EFFORT ?? 'medium',
  claudeContinue: (process.env.CLAUDE_CONTINUE ?? 'true').toLowerCase() === 'true',
  claudePermissionMode: process.env.CLAUDE_PERMISSION_MODE ?? 'default',
  claudeAllowDangerousPermissions: boolFromEnv('CLAUDE_ALLOW_DANGEROUS_PERMISSIONS', false),
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  googleAiApiKey: process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  callingBotBaseUrl: process.env.CALLINGBOT_BASE_URL ?? 'http://localhost:3000',
  defaultZoomDialIn: process.env.CALLINGBOT_DEFAULT_ZOOM_DIAL_IN ?? '+82231439612',
  defaultZoomBotName: process.env.CALLINGBOT_DEFAULT_ZOOM_BOT_NAME ?? '신한 박시은',
  maxScheduleLagMs: numberFromEnv('TELEBOT_MAX_SCHEDULE_LAG_MS', 6 * 60 * 60 * 1000, { min: 0 })
};
