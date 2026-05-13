import { config } from '../config.js';
import { runClaude } from './claude.js';
import { runGemini } from './gemini.js';
import { runOpenAI } from './openai.js';

export function providerLabel(provider = config.aiProvider) {
  return provider.toLowerCase();
}

export async function runProvider(provider, prompt, options) {
  const selected = providerLabel(provider);
  if (selected === 'claude') return runClaude(prompt, options);
  if (selected === 'openai' || selected === 'gpt') return runOpenAI(prompt, options);
  if (selected === 'gemini') return runGemini(prompt, options);
  throw new Error(`Unknown AI provider: ${provider}`);
}
