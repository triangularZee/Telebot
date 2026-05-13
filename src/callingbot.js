import { config } from './config.js';

function normalizePhone(value) {
  const cleaned = String(value).replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.startsWith('010')) return `+82${cleaned.slice(1)}`;
  if (cleaned.startsWith('82')) return `+${cleaned}`;
  return cleaned;
}

export function parseKeyValueLines(text) {
  const entries = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('/')) continue;
    const match = trimmed.match(/^([^:=]+)\s*[:=]\s*(.+)$/);
    if (!match) continue;
    entries[match[1].trim().toLowerCase()] = match[2].trim();
  }
  return entries;
}

export function parseCallCommand(text) {
  const entries = parseKeyValueLines(text);
  const to = entries.to ?? entries.phone ?? entries.number ?? entries['전화번호'] ?? entries['번호'];
  const title = entries.title ?? entries.name ?? entries['제목'] ?? 'telegram-call';
  const note = entries.note ?? entries.context ?? entries.memo ?? entries['메모'] ?? entries['노트'] ?? entries['맥락'] ?? '';
  const meetingId = entries.meeting ?? entries.meetingid ?? entries['회의번호'] ?? entries['미팅번호'];
  const password = entries.password ?? entries.passcode ?? entries.pin ?? entries['비밀번호'] ?? entries['암호'];
  let digits = entries.digits ?? entries.dtmf ?? entries['입력번호'] ?? entries['누를번호'];

  if (!digits && meetingId) {
    digits = `ww${meetingId.replace(/\s+/g, '')}#`;
    if (password) {
      digits += `ww${password.replace(/\s+/g, '')}#`;
    }
  }

  if (!to) {
    throw new Error('전화번호가 필요합니다. 예: to=+18005551234');
  }

  return {
    to: normalizePhone(to),
    title,
    note,
    digits: digits ?? ''
  };
}

function kstParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function kstToDate({ year, month, day, hour, minute }) {
  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0));
}

function parseRelativeTime(value) {
  const match = String(value).trim().match(/^(\d+)\s*(m|min|minute|minutes|분|h|hr|hour|hours|시간|d|day|days|일)?$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = (match[2] ?? 'm').toLowerCase();
  const multiplier = unit.startsWith('h') || unit === '시간'
    ? 60 * 60 * 1000
    : unit.startsWith('d') || unit === '일'
      ? 24 * 60 * 60 * 1000
      : 60 * 1000;

  return new Date(Date.now() + amount * multiplier);
}

export function parseScheduleTime(entries) {
  const relative = entries.in ?? entries.after ?? entries['후'];
  if (relative) {
    const scheduledAt = parseRelativeTime(relative);
    if (!scheduledAt) throw new Error('예약 시간을 해석하지 못했습니다. 예: in=10m 또는 in=2h');
    return scheduledAt;
  }

  const raw = entries.at ?? entries.time ?? entries.datetime ?? entries['예약'] ?? entries['시간'];
  if (!raw) {
    throw new Error('예약 시간이 필요합니다. 예: at=2026-05-13 16:30 또는 in=10m');
  }

  const value = String(raw).trim();
  const nowKst = kstParts();
  let year = nowKst.year;
  let month = nowKst.month;
  let day = nowKst.day;
  let hour;
  let minute;
  let match = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s+(\d{1,2}):(\d{2})$/);

  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
    hour = Number(match[4]);
    minute = Number(match[5]);
  } else if ((match = value.match(/^(\d{1,2})[-/.](\d{1,2})\s+(\d{1,2}):(\d{2})$/))) {
    month = Number(match[1]);
    day = Number(match[2]);
    hour = Number(match[3]);
    minute = Number(match[4]);
  } else if ((match = value.match(/^(\d{1,2}):(\d{2})$/))) {
    hour = Number(match[1]);
    minute = Number(match[2]);
  } else {
    throw new Error('예약 시간 형식이 맞지 않습니다. 예: at=2026-05-13 16:30, at=16:30, in=10m');
  }

  if (hour > 23 || minute > 59 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error('예약 시간 값이 올바르지 않습니다.');
  }

  let scheduledAt = kstToDate({ year, month, day, hour, minute });
  if (/^\d{1,2}:\d{2}$/.test(value) && scheduledAt.getTime() <= Date.now()) {
    scheduledAt = new Date(scheduledAt.getTime() + 24 * 60 * 60 * 1000);
  }
  if (scheduledAt.getTime() <= Date.now()) {
    throw new Error('예약 시간은 현재보다 미래여야 합니다.');
  }

  return scheduledAt;
}

export function parseScheduleCallCommand(text) {
  const entries = parseKeyValueLines(text);
  const scheduledAt = parseScheduleTime(entries);
  return {
    job: parseCallCommand(text),
    scheduledAt
  };
}

export function formatKst(date) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

export function callCommandHelp() {
  return [
    '사용법:',
    '/call',
    'to=+18005551234',
    'meeting=123456789',
    'password=987654',
    'title=251212_FY4Q25 Broadcom',
    'note=AI 매출, backlog, Q&A를 특히 자세히 정리',
    '',
    'DTMF 전체를 알고 있으면:',
    '/call',
    'to=+18005551234',
    'digits=ww123456789#ww987654#',
    'title=board-call'
  ].join('\n');
}

export function scheduleCallCommandHelp() {
  return [
    '사용법:',
    '/schedule_call',
    'at=2026-05-13 16:30',
    'to=+18005551234',
    'meeting=123456789',
    'password=987654',
    'title=251212_FY4Q25 Broadcom',
    '',
    '상대 시간도 가능합니다:',
    '/schedule_call',
    'in=10m',
    'to=+821022414700',
    'title=test-call',
    'note=연결 테스트'
  ].join('\n');
}

export async function startCallingBotCall(job, { chatId } = {}) {
  const baseUrl = config.callingBotBaseUrl.replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/api/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...job,
      notifyChatId: chatId ? String(chatId) : ''
    })
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    throw new Error(body.error ?? `CallingBot API failed: ${response.status}`);
  }

  return body;
}
