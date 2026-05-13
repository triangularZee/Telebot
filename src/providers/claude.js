import { runCommand } from '../shell.js';
import { config } from '../config.js';

export async function runClaude(prompt, { cwd }) {
  const modelArg = config.claudeModel ? ` --model ${JSON.stringify(config.claudeModel)}` : '';
  const effortArg = config.claudeEffort ? ` --effort ${JSON.stringify(config.claudeEffort)}` : '';
  return runCommand(
    cwd,
    `claude -p${modelArg}${effortArg} --permission-mode default --max-budget-usd 1 ${JSON.stringify(prompt)} < /dev/null`
  );
}
