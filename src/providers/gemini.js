import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';

let ai = null;

function geminiClient() {
  if (!config.googleAiApiKey) {
    throw new Error('GOOGLE_AI_API_KEY or GEMINI_API_KEY is required for Gemini provider');
  }
  if (!ai) ai = new GoogleGenAI({ apiKey: config.googleAiApiKey });
  return ai;
}

export async function runGemini(prompt) {
  const response = await geminiClient().models.generateContent({
    model: config.geminiModel,
    contents: prompt
  });

  return response.text ?? '';
}
