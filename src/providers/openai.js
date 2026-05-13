import OpenAI from 'openai';
import { config } from '../config.js';

export async function runOpenAI(prompt) {
  if (!config.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is required for OpenAI provider');
  }

  const client = new OpenAI({ apiKey: config.openaiApiKey });
  const response = await client.chat.completions.create({
    model: config.openaiModel,
    messages: [
      { role: 'system', content: 'You are a concise assistant responding through Telegram.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2
  });

  return response.choices[0]?.message?.content ?? '';
}
