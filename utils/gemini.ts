import { GoogleGenAI } from '@google/genai';

let aiInstance: GoogleGenAI | null = null;

export function getGeminiInstance(): GoogleGenAI | null {
    // Check for the instance first to avoid re-initializing.
    if (aiInstance) {
        return aiInstance;
    }

    // Safely access process.env. In Vite, this is replaced at build time.
    // We add a check to ensure we don't crash if accessed in a non-standard env.
    let apiKey = '';
    try {
        apiKey = process.env.API_KEY || '';
    } catch (e) {
        console.error("Error accessing process.env:", e);
    }

    if (!apiKey) {
        console.error("API_KEY environment variable not set. AI features will be disabled.");
        return null;
    }

    try {
        // Create and cache the instance for future calls.
        aiInstance = new GoogleGenAI({ apiKey });
        return aiInstance;
    } catch (error) {
        console.error("Failed to initialize GoogleGenAI:", error);
        return null;
    }
}