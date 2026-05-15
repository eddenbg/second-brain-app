import { GoogleGenAI, Modality, Type } from '@google/genai';

const UNAVAILABLE_ERROR_MESSAGE = "AI features are currently unavailable. The API key may not be configured.";

let geminiInstance: GoogleGenAI | null = null;

export const getGeminiInstance = (): GoogleGenAI | null => {
    if (geminiInstance) return geminiInstance;
    const apiKey = (typeof process !== 'undefined' && process.env?.API_KEY) || (import.meta as any).env?.VITE_API_KEY;
    if (!apiKey) return null;
    geminiInstance = new GoogleGenAI({ apiKey });
    return geminiInstance;
};

const model = 'gemini-2.5-flash';

export async function askQuestion(question: string, context: string): Promise<string> {
    const ai = getGeminiInstance();
    if (!ai) return UNAVAILABLE_ERROR_MESSAGE;
    try {
        const response = await ai.models.generateContent({
            model,
            contents: `Context:\n${context.substring(0, 50000)}\n\nQuestion: ${question}`,
        });
        return response.text ?? "I couldn't find an answer.";
    } catch (error) { return "I encountered an error while processing your question."; }
}

export async function generateTitleForContent(content: string): Promise<string> {
    const ai = getGeminiInstance();
    if (!ai) return 'Untitled';
    try {
        const response = await ai.models.generateContent({
            model,
            contents: `Generate a short, descriptive title (max 8 words) for this content. Return ONLY the title text, nothing else:\n\n${content.substring(0, 2000)}`,
        });
        return response.text?.trim().replace(/^"|"$/g, '') ?? 'Untitled';
    } catch { return 'Untitled'; }
}

export async function generateMemorySummary(memories: any[]): Promise<string> {
    const ai = getGeminiInstance();
    if (!ai) return UNAVAILABLE_ERROR_MESSAGE;
    const context = memories
        .slice(0, 20)
        .map(m => `[${m.type?.toUpperCase() || 'MEMORY'}] ${m.title || ''}\n${
            m.type === 'voice' ? (m as any).transcript : (m as any).extractedText || (m as any).summary
        }`)
        .join('\n\n');

    try {
        const response = await ai.models.generateContent({
            model,
            contents: `Summarize these memories briefly:\n\n${context.substring(0, 30000)}`,
        });
        return response.text ?? 'No summary available.';
    } catch { return 'Could not generate summary.'; }
}

export async function chatWithMemories(
    userMessage: string,
    memories: any[],
    history: Array<{ role: 'user' | 'model'; text: string }>
): Promise<string> {
    const ai = getGeminiInstance();
    if (!ai) return UNAVAILABLE_ERROR_MESSAGE;

    const memContext = memories
        .slice(0, 50)
        .map(mem => {
            const content = mem.type === 'voice' ? (mem as any).transcript : 
                           mem.type === 'document' ? (mem as any).extractedText :
                           mem.type === 'web' ? (mem as any).content :
                           mem.type === 'file' ? `[File: ${mem.title}]` :
                           (mem as any).description || (mem as any).summary || '';
            return `[${mem.type?.toUpperCase()}] ${mem.title || '(untitled)'} (${new Date(mem.date).toLocaleDateString()}):\n${content}`;
        })
        .join('\n\n---\n\n');

    const systemPrompt = `You are a helpful AI assistant for a student's second brain app. 
  You have access to their personal notes, recordings, documents, and web clips.
  
  MEMORIES/NOTES:\n${memContext.substring(0, 60000)}
  
  Instructions:
  1. Answer based on the memories above when relevant.
  2. Be concise and helpful.
  3. If something isn't in the memories, say so honestly.
  4. Format lists and key points clearly.
  5. Reply in the user's language (Hebrew or English).`;

    const contents = [
        ...history.map(h => ({ role: h.role, parts: [{ text: h.text }] })),
        { role: 'user' as const, parts: [{ text: userMessage }] }
    ];

    try {
        const response = await ai.models.generateContent({
            model,
            contents,
            config: { systemInstruction: systemPrompt },
        });
        return response.text ?? 'No response generated.';
    } catch (error) { return 'I encountered an error. Please try again.'; }
}

export async function generateSpeechFromText(text: string): Promise<string | null> {
    const ai = getGeminiInstance();
    if (!ai) return null;
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: text.substring(0, 5000) }] }],
            config: { responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
        });
        return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
    } catch (error) { return null; }
}

export async function extractTextFromImage(base64Data: string, mimeType: string): Promise<string> {
    const ai = getGeminiInstance();
    if (!ai) return UNAVAILABLE_ERROR_MESSAGE;
    try {
        const response = await ai.models.generateContent({
            model,
            contents: { 
                parts: [
                    { inlineData: { mimeType, data: base64Data } }, 
                    { text: `Extract all text from this image exactly as written. Support both printed and handwritten text in Hebrew or English. Preserve line breaks and original layout.` }
                ] 
            },
        });
        return response.text ?? "No text found.";
    } catch (error) { return "Error extracting text."; }
}

export async function analyzeVoiceNote(content: string): Promise<{ title: string; actionItems: string[] }> {
    const ai = getGeminiInstance();
    if (!ai) return { title: "Untitled", actionItems: [] };
    try {
        const response = await ai.models.generateContent({
            model,
            contents: `Note: ${content.substring(0, 4000)}. Provide Title and Action Items in JSON.`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING },
                        actionItems: { type: Type.ARRAY, items: { type: Type.STRING } }
                    },
                    required: ["title", "actionItems"]
                }
            }
        });
        return JSON.parse(response.text || "{}");
    } catch (error) { return { title: "Voice Note", actionItems: [] }; }
}

export async function processSharedUrl(
    url: string, title: string, text: string,
    availableTags?: string[]
): Promise<{ title: string; summary: string; type: 'Article' | 'Video'; takeaways: string[]; suggestedTags: string[] }> {
    const ai = getGeminiInstance();
    if (!ai) throw new Error(UNAVAILABLE_ERROR_MESSAGE);

    const tagsContext = availableTags && availableTags.length > 0
        ? `\nExisting tags to reuse if applicable: ${availableTags.join(', ')}`
        : '';

    try {
        const response = await ai.models.generateContent({
            model,
            contents: `Analyze this shared content and return JSON:\nURL: ${url}\nTitle: ${title}\nText: ${text.substring(0, 3000)}${tagsContext}`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING },
                        summary: { type: Type.STRING },
                        type: { type: Type.STRING, enum: ['Article', 'Video'] },
                        takeaways: { type: Type.ARRAY, items: { type: Type.STRING } },
                        suggestedTags: { type: Type.ARRAY, items: { type: Type.STRING } }
                    },
                    required: ["title", "summary", "type", "takeaways", "suggestedTags"]
                }
            }
        });
        return JSON.parse(response.text || '{}');
    } catch (error) { throw new Error('Failed to analyze the shared content.'); }
}
