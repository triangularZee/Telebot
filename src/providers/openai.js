import OpenAI from 'openai';
import { config } from '../config.js';

let client = null;

function openaiClient() {
  if (!config.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is required for OpenAI provider');
  }
  if (!client) client = new OpenAI({ apiKey: config.openaiApiKey });
  return client;
}

export async function runOpenAI(prompt) {
  const response = await openaiClient().chat.completions.create({
    model: config.openaiModel,
    messages: [
      { role: 'system', content: 'You are a concise assistant responding through Telegram.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2
  });

  return response.choices[0]?.message?.content ?? '';
}
