import { runCommandRaw } from '../shell.js';
import { config } from '../config.js';

export async function runClaude(prompt, { cwd }) {
  const modelArg = config.claudeModel ? ` --model ${JSON.stringify(config.claudeModel)}` : '';
  const effortArg = config.claudeEffort ? ` --effort ${JSON.stringify(config.claudeEffort)}` : '';
  const result = await runCommandRaw(
    cwd,
    `claude -p${modelArg}${effortArg} --permission-mode default --max-budget-usd 1 ${JSON.stringify(prompt)} < /dev/null`
  );

  if (result.code !== 0) {
    return [`Claude failed with exitCode=${result.code}`, result.stderr].filter(Boolean).join('\n\n');
  }

  return result.stderr
    ? `${result.stdout}\n\nstderr:\n${result.stderr}`
    : result.stdout;
}
