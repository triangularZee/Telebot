import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';

export async function runGemini(prompt) {
  if (!config.googleAiApiKey) {
    throw new Error('GOOGLE_AI_API_KEY or GEMINI_API_KEY is required for Gemini provider');
  }

  const ai = new GoogleGenAI({ apiKey: config.googleAiApiKey });
  const response = await ai.models.generateContent({
    model: config.geminiModel,
    contents: prompt
  });

  return response.text ?? '';
}
