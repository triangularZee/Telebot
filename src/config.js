import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export const config = {
  repoRoot,
  botToken: required('TELEGRAM_BOT_TOKEN'),
  allowedChatIds: required('TELEGRAM_ALLOWED_CHAT_IDS')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
  rootDir: path.resolve(repoRoot, process.env.TELEBOT_ROOT_DIR ?? '.'),
  commandTimeoutMs: Number(process.env.TELEBOT_COMMAND_TIMEOUT_MS ?? 60000),
  maxOutputChars: Number(process.env.TELEBOT_MAX_OUTPUT_CHARS ?? 3500),
  aiProvider: process.env.AI_PROVIDER ?? 'claude',
  claudeModel: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',
  claudeEffort: process.env.CLAUDE_EFFORT ?? 'medium',
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  googleAiApiKey: process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
};
