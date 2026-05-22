import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const testRoot = path.join(os.tmpdir(), 'telebot-test-root');
const stateRoot = path.join(os.tmpdir(), 'telebot-test-state');

process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_ALLOWED_CHAT_IDS = '1234';
process.env.TELEBOT_ROOT_DIR = testRoot;
process.env.TELEBOT_STATE_DIR = stateRoot;
process.env.CALLINGBOT_DEFAULT_ZOOM_DIAL_IN = '+15551234567';

await fs.rm(testRoot, { recursive: true, force: true });
await fs.rm(stateRoot, { recursive: true, force: true });
await fs.mkdir(path.join(testRoot, 'subdir'), { recursive: true });

const {
  buildZoomDigits,
  normalizePhone,
  parseCallCommand,
  parseScheduleTime
} = await import('../src/callingbot.js');
const { addCallHistory, listCallHistory } = await import('../src/callHistory.js');
const { resolveFrom, runCommand } = await import('../src/shell.js');

test('normalizes Korean local phone numbers', () => {
  assert.equal(normalizePhone('010-2241-4700'), '+821022414700');
  assert.equal(normalizePhone('821022414700'), '+821022414700');
});

test('builds Zoom DTMF digits and rejects non-keypad passcodes', () => {
  assert.equal(
    buildZoomDigits({ meetingId: '123 456 789', passcode: '987654' }),
    'ww123456789#ww#ww987654#'
  );
  assert.throws(
    () => buildZoomDigits({ meetingId: '123abc', passcode: '' }),
    /Zoom Meeting ID/
  );
});

test('uses configured default Zoom dial-in when omitted', () => {
  const job = parseCallCommand([
    '/call',
    'type=zoom',
    'meeting=123 456 789',
    'passcode=987654',
    'title=Zoom smoke test'
  ].join('\n'));

  assert.equal(job.to, '+15551234567');
  assert.equal(job.digits, 'ww123456789#ww#ww987654#');
});

test('parses relative schedule times in the future', () => {
  const before = Date.now();
  const scheduledAt = parseScheduleTime({ in: '1m' });
  const delta = scheduledAt.getTime() - before;

  assert.ok(delta >= 59_000);
  assert.ok(delta <= 61_000);
});

test('keeps resolved paths inside TELEBOT_ROOT_DIR', () => {
  assert.equal(resolveFrom(testRoot, 'subdir'), path.join(testRoot, 'subdir'));
  assert.throws(() => resolveFrom(testRoot, '..'), /Access denied/);
});

test('blocks obviously dangerous /run commands by default', () => {
  assert.throws(() => runCommand(testRoot, 'rm -rf /'), /Blocked dangerous command/);
});

test('serializes concurrent call history writes', async () => {
  await Promise.all(Array.from({ length: 10 }, (_, index) => addCallHistory({
    chatId: '1234',
    event: 'started',
    source: 'test',
    job: {
      title: `call-${index}`,
      to: '+15550000000'
    }
  })));

  const items = await listCallHistory('1234', 20);
  assert.equal(items.length, 10);
});
