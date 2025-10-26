import { GoogleGenAI } from '@google/genai';

let aiInstance: GoogleGenAI | null = null;

export function getGeminiInstance(): GoogleGenAI | null {
    // Check for the instance first to avoid re-initializing.
    if (aiInstance) {
        return aiInstance;
    }

    // FIX: Use process.env for environment variables. This resolves the TypeScript error 'Property 'env' does not exist on type 'ImportMeta''.
    const apiKey = process.env.API_KEY;
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