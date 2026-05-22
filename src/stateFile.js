import fs from 'node:fs/promises';
import path from 'node:path';

const fileQueues = new Map();

function fallbackValue(fallback) {
  return typeof fallback === 'function' ? fallback() : fallback;
}

export async function withFileLock(filePath, task) {
  const previous = fileQueues.get(filePath) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });

  fileQueues.set(filePath, previous.catch(() => {}).then(() => current));
  await previous.catch(() => {});

  try {
    return await task();
  } finally {
    release();
  }
}

export async function readJsonFile(filePath, fallback = []) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error.code === 'ENOENT') return fallbackValue(fallback);
    throw error;
  }
}

export async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  );
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tempPath, filePath);
}

export async function updateJsonFile(filePath, fallback, updater) {
  return withFileLock(filePath, async () => {
    const current = await readJsonFile(filePath, fallback);
    const { next = current, result } = await updater(current);
    await writeJsonFile(filePath, next);
    return result;
  });
}
