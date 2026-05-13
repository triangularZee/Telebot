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
/schedule_call
/scheduled_calls
/cancel_call id
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
digits=ww123456789#ww987654#
title=test-call
/schedule_call
at=2026-05-13 16:30
to=+18005551234
meeting=123456789
password=987654
title=scheduled-call
/scheduled_calls
/cancel_call call-id
/ai summarize this repository
/claude summarize this repository
/gpt summarize this repository
/gemini summarize this repository
```

`/run` executes commands on the machine running Telebot. Keep the bot token private and restrict `TELEGRAM_ALLOWED_CHAT_IDS`.
`/claude` runs `claude -p` in the current working directory. Claude Code must already be installed and authenticated on the remote machine.
`/ai` uses `AI_PROVIDER`; `/claude`, `/gpt`, and `/gemini` force a specific provider.
Plain text messages are also sent to the default `AI_PROVIDER`, so `/claude` is optional when `AI_PROVIDER=claude`.

Provider environment variables:

```env
AI_PROVIDER=claude
CLAUDE_MODEL=claude-sonnet-4-6
CLAUDE_EFFORT=medium
CLAUDE_CONTINUE=true
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
GOOGLE_AI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
CALLINGBOT_BASE_URL=http://localhost:3000
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

## Security Notes

- Use a dedicated bot token.
- Set `TELEGRAM_ALLOWED_CHAT_IDS`; leaving it empty is refused.
- Treat `/run` as full remote shell access.
- Treat `/ai`, `/claude`, `/gpt`, and `/gemini` as remote AI-agent access.
- Rotate the token in BotFather if it has been shared with another service.
