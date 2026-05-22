import { GoogleGenAI } from '@google/genai';

export function getGeminiInstance(): GoogleGenAI | null {
    const apiKey = (typeof localStorage !== 'undefined' && localStorage.getItem('gemini_api_key'))
        || process.env.API_KEY;
    if (!apiKey) {
        console.error("Gemini API key not configured. Add your key in Settings → AI Features.");
        return null;
    }
    try {
        return new GoogleGenAI({ apiKey });
    } catch (error) {
        console.error("Failed to initialize GoogleGenAI:", error);
        return null;
    }
}