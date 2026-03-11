import { GoogleGenAI } from '@google/genai';

// Guideline: Create a new GoogleGenAI instance right before making an API call 
// to ensure it always uses the most up-to-date API key. Avoid caching in a singleton.
export function getGeminiInstance(): GoogleGenAI | null {
    // Guideline: The API key must be obtained exclusively from process.env.API_KEY.
    // Assume this variable is pre-configured and valid.
    if (!process.env.API_KEY) {
        console.error("API_KEY environment variable not set. AI features will be disabled.");
        return null;
    }

    try {
        // Guideline: Use the process.env.API_KEY string directly during initialization.
        // Must use named parameter: new GoogleGenAI({ apiKey: ... }).
        return new GoogleGenAI({ apiKey: process.env.API_KEY });
    } catch (error) {
        console.error("Failed to initialize GoogleGenAI:", error);
        return null;
    }
}