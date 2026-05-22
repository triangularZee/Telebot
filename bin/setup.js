#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const homeDir = os.homedir();
const serviceName = 'telebot';

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function requireArg(args, name) {
  if (!args[name] || args[name] === true) {
    throw new Error(`Missing required --${name}`);
  }
  return String(args[name]);
}

function escapeSystemdArg(value) {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '$$')
    .replace(/%/g, '%%')}"`;
}

function escapeSystemdPath(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\s/g, '\\x20')
    .replace(/%/g, '%%')
    .replace(/\$/g, '$$');
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapePowerShellString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function defaultEnvDir() {
  if (os.platform() === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'telebot');
  }
  if (os.platform() === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'), 'telebot');
  }
  return path.join(process.env.XDG_STATE_HOME || path.join(homeDir, '.local', 'state'), 'telebot');
}

function writeEnv(target, values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  fs.writeFileSync(target, `${lines.join('\n')}\n`, { mode: 0o600 });
}

function setupLinux(envPath) {
  const serviceDir = path.join(homeDir, '.config', 'systemd', 'user');
  const stateDir = path.join(process.env.XDG_STATE_HOME || path.join(homeDir, '.local', 'state'), 'telebot');
  const serviceFile = path.join(serviceDir, `${serviceName}.service`);
  fs.mkdirSync(serviceDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });

  const nodePath = process.execPath;
  const service = `[Unit]
Description=Triangular Telebot
After=network.target

[Service]
Type=simple
WorkingDirectory=${escapeSystemdPath(repoRoot)}
EnvironmentFile=${escapeSystemdPath(envPath)}
ExecStart=${escapeSystemdArg(nodePath)} ${escapeSystemdArg(path.join(repoRoot, 'src', 'index.js'))}
Restart=always
RestartSec=5
StandardOutput=append:${stateDir.replace(/%/g, '%%')}/telebot.log
StandardError=append:${stateDir.replace(/%/g, '%%')}/telebot.error.log

[Install]
WantedBy=default.target
`;

  if (fs.existsSync(serviceFile)) {
    spawnSync('systemctl', ['--user', 'stop', serviceName], { stdio: 'inherit' });
  }
  fs.writeFileSync(serviceFile, service, { mode: 0o600 });
  spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
  spawnSync('systemctl', ['--user', 'enable', serviceName], { stdio: 'inherit' });
  spawnSync('systemctl', ['--user', 'restart', serviceName], { stdio: 'inherit' });
  spawnSync('loginctl', ['enable-linger', os.userInfo().username], { stdio: 'ignore' });

  console.log(`Service file: ${serviceFile}`);
  console.log(`Status: systemctl --user status ${serviceName}`);
  console.log(`Logs: tail -f ${stateDir}/telebot.log`);
}

function setupMac(envPath) {
  const label = 'com.triangular.telebot';
  const agentDir = path.join(homeDir, 'Library', 'LaunchAgents');
  const logDir = path.join(homeDir, 'Library', 'Logs', 'telebot');
  const plistFile = path.join(agentDir, `${label}.plist`);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>WorkingDirectory</key>
  <string>${escapeXml(repoRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DOTENV_CONFIG_PATH</key>
    <string>${escapeXml(envPath)}</string>
  </dict>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(process.execPath)}</string>
    <string>-r</string>
    <string>dotenv/config</string>
    <string>${escapeXml(path.join(repoRoot, 'src', 'index.js'))}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(logDir)}/telebot.log</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logDir)}/telebot.error.log</string>
</dict>
</plist>
`;

  spawnSync('launchctl', ['bootout', `gui/${process.getuid()}/${label}`], { stdio: 'ignore' });
  fs.writeFileSync(plistFile, plist, { mode: 0o600 });
  spawnSync('launchctl', ['bootstrap', `gui/${process.getuid()}`, plistFile], { stdio: 'inherit' });
  spawnSync('launchctl', ['enable', `gui/${process.getuid()}/${label}`], { stdio: 'inherit' });

  console.log(`Plist file: ${plistFile}`);
  console.log(`Status: launchctl list | grep ${label}`);
  console.log(`Logs: tail -f ${logDir}/telebot.log`);
}

function setupWindows(envPath) {
  const taskName = 'Triangular Telebot';
  const logDir = path.join(process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'), 'telebot');
  const logPath = path.join(logDir, 'telebot.log');
  fs.mkdirSync(logDir, { recursive: true });

  const command = [
    `$env:DOTENV_CONFIG_PATH=${escapePowerShellString(envPath)}`,
    `Set-Location ${escapePowerShellString(repoRoot)}`,
    `& ${escapePowerShellString(process.execPath)} -r dotenv/config ${escapePowerShellString(path.join(repoRoot, 'src', 'index.js'))} *>> ${escapePowerShellString(logPath)}`
  ].join('; ');
  const taskRun = `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command ${JSON.stringify(command)}`;

  spawnSync('schtasks', ['/Create', '/TN', taskName, '/SC', 'ONLOGON', '/TR', taskRun, '/RL', 'LIMITED', '/F'], { stdio: 'inherit' });
  spawnSync('schtasks', ['/Run', '/TN', taskName], { stdio: 'inherit' });

  console.log(`Task Scheduler task: ${taskName}`);
  console.log(`Status: schtasks /Query /TN "${taskName}" /V /FO LIST`);
  console.log(`Logs: ${logPath}`);
}

const args = parseArgs();
const token = requireArg(args, 'token');
const chatId = requireArg(args, 'chat-id');
const root = path.resolve(args.root ? String(args.root) : homeDir);
const timeout = String(args.timeout ?? 60000);
const maxOutput = String(args['max-output'] ?? 3500);
const allowDangerousRun = String(args['allow-dangerous-run'] ?? process.env.TELEBOT_ALLOW_DANGEROUS_RUN ?? 'false');
const aiProvider = String(args['ai-provider'] ?? 'claude');
const claudeModel = String(args['claude-model'] ?? process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6');
const claudeEffort = String(args['claude-effort'] ?? process.env.CLAUDE_EFFORT ?? 'medium');
const claudeContinue = String(args['claude-continue'] ?? process.env.CLAUDE_CONTINUE ?? 'true');
const claudePermissionMode = String(args['claude-permission-mode'] ?? process.env.CLAUDE_PERMISSION_MODE ?? 'default');
const claudeAllowDangerousPermissions = String(args['claude-allow-dangerous-permissions'] ?? process.env.CLAUDE_ALLOW_DANGEROUS_PERMISSIONS ?? 'false');
const openaiApiKey = String(args['openai-api-key'] ?? process.env.OPENAI_API_KEY ?? '');
const openaiModel = String(args['openai-model'] ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini');
const googleAiApiKey = String(args['google-ai-api-key'] ?? process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY ?? '');
const geminiModel = String(args['gemini-model'] ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash');
const callingBotBaseUrl = String(args['callingbot-base-url'] ?? process.env.CALLINGBOT_BASE_URL ?? 'http://localhost:3000');
const defaultZoomDialIn = String(args['default-zoom-dial-in'] ?? process.env.CALLINGBOT_DEFAULT_ZOOM_DIAL_IN ?? '+82231439612');
const defaultZoomBotName = String(args['default-zoom-bot-name'] ?? process.env.CALLINGBOT_DEFAULT_ZOOM_BOT_NAME ?? '신한 박시은');
const maxScheduleLag = String(args['max-schedule-lag-ms'] ?? process.env.TELEBOT_MAX_SCHEDULE_LAG_MS ?? 6 * 60 * 60 * 1000);
const envDir = defaultEnvDir();
const envPath = path.join(envDir, '.env');

fs.mkdirSync(envDir, { recursive: true });
writeEnv(envPath, {
  TELEGRAM_BOT_TOKEN: token,
  TELEGRAM_ALLOWED_CHAT_IDS: chatId,
  TELEBOT_ROOT_DIR: root,
  TELEBOT_STATE_DIR: envDir,
  TELEBOT_COMMAND_TIMEOUT_MS: timeout,
  TELEBOT_MAX_OUTPUT_CHARS: maxOutput,
  TELEBOT_ALLOW_DANGEROUS_RUN: allowDangerousRun,
  AI_PROVIDER: aiProvider,
  CLAUDE_MODEL: claudeModel,
  CLAUDE_EFFORT: claudeEffort,
  CLAUDE_CONTINUE: claudeContinue,
  CLAUDE_PERMISSION_MODE: claudePermissionMode,
  CLAUDE_ALLOW_DANGEROUS_PERMISSIONS: claudeAllowDangerousPermissions,
  OPENAI_API_KEY: openaiApiKey,
  OPENAI_MODEL: openaiModel,
  GOOGLE_AI_API_KEY: googleAiApiKey,
  GEMINI_MODEL: geminiModel,
  CALLINGBOT_BASE_URL: callingBotBaseUrl,
  CALLINGBOT_DEFAULT_ZOOM_DIAL_IN: defaultZoomDialIn,
  CALLINGBOT_DEFAULT_ZOOM_BOT_NAME: defaultZoomBotName,
  TELEBOT_MAX_SCHEDULE_LAG_MS: maxScheduleLag
});

if (os.platform() === 'linux') setupLinux(envPath);
else if (os.platform() === 'darwin') setupMac(envPath);
else if (os.platform() === 'win32') setupWindows(envPath);
else throw new Error(`Unsupported platform: ${os.platform()}. Run npm start manually with DOTENV_CONFIG_PATH=${envPath}.`);
