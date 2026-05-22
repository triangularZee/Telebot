import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { config } from './config.js';

const runAuditPath = path.join(config.stateDir, 'run-audit.log');
const dangerousRunPatterns = [
  { label: 'rm -rf', pattern: /(^|[;&|]\s*)rm\s+(?=[^;&|]*-[^\s;&|]*r)(?=[^;&|]*-[^\s;&|]*f)/i },
  { label: 'Remove-Item -Recurse -Force', pattern: /\bRemove-Item\b(?=[^;&|]*\b-Recurse\b)(?=[^;&|]*\b-Force\b)/i },
  { label: 'shutdown/reboot', pattern: /(^|[;&|]\s*)(shutdown|reboot|halt|poweroff)(\s|$)/i },
  { label: 'disk formatter', pattern: /(^|[;&|]\s*)(mkfs(\.\w+)?|diskpart|format(?:\.com)?)(\s|$)/i },
  { label: 'dd disk overwrite', pattern: /(^|[;&|]\s*)dd\s+(?=[^;&|]*\bif=)(?=[^;&|]*\bof=)/i }
];

export function clampOutput(text) {
  if (text.length <= config.maxOutputChars) return text;
  return `${text.slice(0, config.maxOutputChars)}\n\n[output truncated]`;
}

export function isInsideRoot(targetPath) {
  const root = path.resolve(config.rootDir);
  const resolved = path.resolve(targetPath);
  const comparableRoot = os.platform() === 'win32' ? root.toLowerCase() : root;
  const comparableResolved = os.platform() === 'win32' ? resolved.toLowerCase() : resolved;
  const relative = path.relative(comparableRoot, comparableResolved);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function assertInsideRoot(targetPath) {
  if (!isInsideRoot(targetPath)) {
    throw new Error(`Access denied: outside root directory (${config.rootDir})`);
  }
}

export function resolveFrom(cwd, target = '.') {
  const resolved = path.resolve(cwd, target);
  assertInsideRoot(resolved);
  return resolved;
}

export async function resolveExistingFrom(cwd, target = '.') {
  const resolved = resolveFrom(cwd, target);
  const realPath = await fs.realpath(resolved);
  assertInsideRoot(realPath);
  return resolved;
}

export async function listDir(cwd, target = '.') {
  const dir = await resolveExistingFrom(cwd, target);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const lines = entries
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .map((entry) => `${entry.isDirectory() ? '[D]' : '[F]'} ${entry.name}`);
  return {
    cwd: dir,
    text: lines.join('\n') || '(empty)'
  };
}

export async function readTextFile(cwd, target) {
  if (!target) throw new Error('Usage: /cat path');
  const filePath = await resolveExistingFrom(cwd, target);
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error('Not a file');
  if (stat.size > 512 * 1024) throw new Error('File is larger than 512KB');
  const text = await fs.readFile(filePath, 'utf8');
  return {
    filePath,
    text: clampOutput(text)
  };
}

export function runCommand(cwd, command) {
  if (!command) throw new Error('Usage: /run command');
  assertInsideRoot(cwd);
  const dangerous = findDangerousCommand(command);
  if (dangerous && !config.allowDangerousRunCommands) {
    const message = `Blocked dangerous command (${dangerous.label}). Set TELEBOT_ALLOW_DANGEROUS_RUN=true only if you intentionally accept full remote shell risk.`;
    void auditRunCommand({ cwd, command, outcome: 'blocked', reason: dangerous.label });
    throw new Error(message);
  }
  void auditRunCommand({ cwd, command, outcome: 'started' });

  const isWindows = os.platform() === 'win32';
  const shell = isWindows ? 'powershell.exe' : '/bin/bash';
  const args = isWindows
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]
    : ['-lc', command];

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(shell, args, {
      cwd,
      windowsHide: true
    });
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      stderr += `\n[terminated after ${config.commandTimeoutMs}ms]`;
    }, config.commandTimeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      void auditRunCommand({ cwd, command, outcome: 'finished', reason: `exitCode=${code}` });
      const combined = [
        `exitCode=${code}`,
        stdout ? `\nstdout:\n${stdout}` : '',
        stderr ? `\nstderr:\n${stderr}` : ''
      ].join('');
      resolve(clampOutput(combined));
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      void auditRunCommand({ cwd, command, outcome: 'error', reason: error.message });
      resolve(`error=${error.message}`);
    });
  });
}

export function runCommandRaw(cwd, command) {
  if (!command) throw new Error('Command is required');
  assertInsideRoot(cwd);

  const isWindows = os.platform() === 'win32';
  const shell = isWindows ? 'powershell.exe' : '/bin/bash';
  const args = isWindows
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]
    : ['-lc', command];

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(shell, args, {
      cwd,
      windowsHide: true
    });
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      stderr += `\n[terminated after ${config.commandTimeoutMs}ms]`;
    }, config.commandTimeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: clampOutput(stdout.trim()),
        stderr: clampOutput(stderr.trim())
      });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        code: 1,
        stdout: '',
        stderr: error.message
      });
    });
  });
}

function findDangerousCommand(command) {
  const normalized = String(command).replace(/\s+/g, ' ').trim();
  return dangerousRunPatterns.find(({ pattern }) => pattern.test(normalized));
}

async function auditRunCommand({ cwd, command, outcome, reason = '' }) {
  try {
    await fs.mkdir(config.stateDir, { recursive: true });
    await fs.appendFile(
      runAuditPath,
      `${JSON.stringify({
        at: new Date().toISOString(),
        cwd,
        outcome,
        reason,
        command
      })}${os.EOL}`,
      'utf8'
    );
  } catch (error) {
    console.warn('Failed to write run audit log:', error.message);
  }
}
