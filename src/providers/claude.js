import { runCommandRaw } from '../shell.js';
import { config } from '../config.js';

export async function runClaude(prompt, { cwd }) {
  const modelArg = config.claudeModel ? ` --model ${JSON.stringify(config.claudeModel)}` : '';
  const effortArg = config.claudeEffort ? ` --effort ${JSON.stringify(config.claudeEffort)}` : '';
  const continueArg = config.claudeContinue ? ' --continue' : '';
  const permissionMode = config.claudePermissionMode === 'yolo'
    ? 'bypassPermissions'
    : config.claudePermissionMode;
  const permissionArg = buildPermissionArg(permissionMode);
  const result = await runCommandRaw(
    cwd,
    `claude -p${continueArg}${modelArg}${effortArg}${permissionArg} --max-budget-usd 1 ${JSON.stringify(prompt)}`
  );

  if (result.code !== 0) {
    return [`Claude failed with exitCode=${result.code}`, result.stderr].filter(Boolean).join('\n\n');
  }

  return result.stderr
    ? `${result.stdout}\n\nstderr:\n${result.stderr}`
    : result.stdout;
}

function buildPermissionArg(permissionMode) {
  if (permissionMode === 'bypassPermissions') {
    if (!config.claudeAllowDangerousPermissions) {
      throw new Error('CLAUDE_PERMISSION_MODE=bypassPermissions/yolo requires CLAUDE_ALLOW_DANGEROUS_PERMISSIONS=true');
    }
    return ' --permission-mode bypassPermissions --dangerously-skip-permissions';
  }
  return ` --permission-mode ${JSON.stringify(permissionMode)}`;
}
