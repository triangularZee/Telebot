import { runCommand } from '../shell.js';

export async function runClaude(prompt, { cwd }) {
  return runCommand(
    cwd,
    `claude -p --permission-mode default --max-budget-usd 1 ${JSON.stringify(prompt)} < /dev/null`
  );
}
