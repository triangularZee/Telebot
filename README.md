# Telebot

Personal Telegram remote-control bot for your own machines.

It is intentionally small and explicit:

- only responds to chat IDs listed in `TELEGRAM_ALLOWED_CHAT_IDS`
- supports basic directory inspection and shell execution
- stores no Telegram token in Git
- installer creates a visible user service named `telebot`

Use a dedicated Telegram bot token for this project. Do not reuse a token that is already used by another bot such as `cokacdir`.

## Setup

```powershell
npm install
Copy-Item .env.example .env
notepad .env
```

Required `.env`:

```env
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_ALLOWED_CHAT_IDS=123456789
TELEBOT_ROOT_DIR=C:\Users\J\Documents
TELEBOT_STATE_DIR=C:\Users\J\AppData\Local\telebot
```

Run locally:

```powershell
npm start
```

## Telegram Commands

```text
/start
/help
/pwd
/ls
/ls path
/cd path
/cat path
/run command
/call
/call schedule
/call history
/hangup [callSid]
/schedule_call
/scheduled_calls
/call_history
/cancel_schedule id
/cancel_schedule all
/ai prompt
/claude prompt
/gpt prompt
/gemini prompt
```

Examples:

```text
/ls
/cd C:\Users\J\Documents\Codex
/run git status --short
/cat README.md
/call
to=+18005551234
digits=wwww123456789#ww987654#
title=test-call
note=AI 매출, backlog, Q&A를 특히 자세히 정리
silenceTimeout=120
/hangup
/schedule_call
at=2026-05-13 16:30
to=+18005551234
meeting=123456789
password=987654
title=scheduled-call
note=가이던스와 마진 코멘트 위주로 정리
/scheduled_calls
/call schedule
/call_history
/call history
/cancel_schedule call-id
/cancel_schedule all
/ai summarize this repository
/claude summarize this repository
/gpt summarize this repository
/gemini summarize this repository
```

`/run` executes commands on the machine running Telebot. Keep the bot token private and restrict `TELEGRAM_ALLOWED_CHAT_IDS`.
By default Telebot keeps file commands inside `TELEBOT_ROOT_DIR`, writes `/run` audit events to `run-audit.log`, and blocks obviously destructive commands such as `rm -rf`, `shutdown`, disk formatting, and `Remove-Item -Recurse -Force`. Set `TELEBOT_ALLOW_DANGEROUS_RUN=true` only if you intentionally accept full remote shell risk.
`/claude` runs `claude -p` in the current working directory. Claude Code must already be installed and authenticated on the remote machine.
`CLAUDE_PERMISSION_MODE=bypassPermissions` or `yolo` is refused unless `CLAUDE_ALLOW_DANGEROUS_PERMISSIONS=true` is also set.
`/ai` uses `AI_PROVIDER`; `/claude`, `/gpt`, and `/gemini` force a specific provider.
Plain text messages are also sent to the default `AI_PROVIDER`, so `/claude` is optional when `AI_PROVIDER=claude`.

Provider environment variables:

```env
TELEBOT_ALLOW_DANGEROUS_RUN=false
TELEBOT_MAX_SCHEDULE_LAG_MS=21600000
AI_PROVIDER=claude
CLAUDE_MODEL=claude-sonnet-4-6
CLAUDE_EFFORT=medium
CLAUDE_CONTINUE=true
CLAUDE_PERMISSION_MODE=default
CLAUDE_ALLOW_DANGEROUS_PERMISSIONS=false
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
GOOGLE_AI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
CALLINGBOT_BASE_URL=http://localhost:3000
CALLINGBOT_DEFAULT_ZOOM_DIAL_IN=+82231439612
CALLINGBOT_DEFAULT_ZOOM_BOT_NAME=신한 박시은
```

## Linux Service Install

On Ubuntu/Linux after cloning the repo:

```bash
npm install
npm run setup -- --token "123456:ABC..." --chat-id "123456789" --root "$HOME"
```

Optional provider flags:

```bash
npm run setup -- \
  --token "123456:ABC..." \
  --chat-id "123456789" \
  --root "$HOME" \
  --ai-provider claude \
  --claude-model claude-sonnet-4-6 \
  --claude-effort medium \
  --claude-continue true \
  --openai-api-key "$OPENAI_API_KEY" \
  --google-ai-api-key "$GOOGLE_AI_API_KEY" \
  --callingbot-base-url "http://localhost:3000"
```

This creates:

```text
~/.config/systemd/user/telebot.service
~/.local/state/telebot/.env
~/.local/state/telebot/telebot.log
~/.local/state/telebot/telebot.error.log
```

Manage it:

```bash
systemctl --user status telebot
systemctl --user stop telebot
systemctl --user restart telebot
journalctl --user -u telebot -f
```

Remove it:

```bash
systemctl --user stop telebot
systemctl --user disable telebot
rm ~/.config/systemd/user/telebot.service
systemctl --user daemon-reload
```

## macOS Service Install

The installer also supports launchd:

```bash
npm run setup -- --token "123456:ABC..." --chat-id "123456789" --root "$HOME"
```

It creates:

```text
~/Library/LaunchAgents/com.triangular.telebot.plist
~/Library/Logs/telebot/telebot.log
~/Library/Logs/telebot/telebot.error.log
```

## Windows Service Install

On Windows, the installer registers a per-user Task Scheduler task:

```powershell
npm install
npm run setup -- --token "123456:ABC..." --chat-id "123456789" --root "$HOME"
```

It creates:

```text
%LOCALAPPDATA%\telebot\.env
%LOCALAPPDATA%\telebot\telebot.log
Task Scheduler task: Triangular Telebot
```

Manage it:

```powershell
schtasks /Query /TN "Triangular Telebot" /V /FO LIST
schtasks /End /TN "Triangular Telebot"
schtasks /Delete /TN "Triangular Telebot"
```

## Security Notes

- Use a dedicated bot token.
- Set `TELEGRAM_ALLOWED_CHAT_IDS`; leaving it empty is refused.
- Treat `/run` as full remote shell access even with the default dangerous-command filter.
- Treat `/ai`, `/claude`, `/gpt`, and `/gemini` as remote AI-agent access.
- Do not enable Claude bypass permissions unless this bot is isolated to a disposable or tightly controlled machine.
- Rotate the token in BotFather if it has been shared with another service.
