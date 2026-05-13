import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { config } from './config.js';

export function clampOutput(text) {
  if (text.length <= config.maxOutputChars) return text;
  return `${text.slice(0, config.maxOutputChars)}\n\n[output truncated]`;
}

export function resolveFrom(cwd, target = '.') {
  return path.resolve(cwd, target);
}

export async function listDir(cwd, target = '.') {
  const dir = resolveFrom(cwd, target);
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
  const filePath = resolveFrom(cwd, target);
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
      const combined = [
        `exitCode=${code}`,
        stdout ? `\nstdout:\n${stdout}` : '',
        stderr ? `\nstderr:\n${stderr}` : ''
      ].join('');
      resolve(clampOutput(combined));
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve(`error=${error.message}`);
    });
  });
}

export function runCommandRaw(cwd, command) {
  if (!command) throw new Error('Command is required');

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
