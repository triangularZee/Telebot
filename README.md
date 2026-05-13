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
/claude prompt
```

Examples:

```text
/ls
/cd C:\Users\J\Documents\Codex
/run git status --short
/cat README.md
/claude summarize this repository
```

`/run` executes commands on the machine running Telebot. Keep the bot token private and restrict `TELEGRAM_ALLOWED_CHAT_IDS`.
`/claude` runs `claude -p` in the current working directory. Claude Code must already be installed and authenticated on the remote machine.

## Linux Service Install

On Ubuntu/Linux after cloning the repo:

```bash
npm install
npm run setup -- --token "123456:ABC..." --chat-id "123456789" --root "$HOME"
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
- Treat `/claude` as remote AI-agent access to the current directory.
- Rotate the token in BotFather if it has been shared with another service.
