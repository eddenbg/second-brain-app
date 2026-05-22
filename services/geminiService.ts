import { GoogleGenAI, Modality, Type } from '@google/genai';

const UNAVAILABLE_ERROR_MESSAGE = "AI features are currently unavailable. The API key may not be configured.";

let geminiInstance: GoogleGenAI | null = null;

export const getGeminiInstance = (): GoogleGenAI | null => {
    if (geminiInstance) return geminiInstance;
    const apiKey = process.env.API_KEY || (import.meta as any).env?.VITE_API_KEY;
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

export async function generateStudyOverview(
    memories: any[],
    focus: string,
    type: 'written' | 'audio' | 'video' | 'research'
): Promise<{ content: string; title: string; videoUri?: string }> {
    const ai = getGeminiInstance();
    if (!ai) return { content: UNAVAILABLE_ERROR_MESSAGE, title: focus };

    const context = memories.slice(0, 40).map(m => {
        const content = m.type === 'voice' ? m.transcript :
                        m.type === 'document' ? m.extractedText :
                        m.content || m.description || m.summary || '';
        return `[${(m.type || 'NOTE').toUpperCase()}] ${m.title || ''}: ${(content || '').slice(0, 500)}`;
    }).join('\n\n');

    const styleGuide: Record<string, string> = {
        written: 'Write structured study notes with headings, key concepts, and summaries.',
        audio:   'Write an engaging podcast-style script (spoken word, no headers) covering the key topics as if explaining to a student.',
        video:   'Write a clear, structured script for a study video covering the main concepts.',
        research:'Write a deep research overview: background, main findings, open questions, and connections between topics.',
    };

    try {
        const response = await ai.models.generateContent({
            model,
            contents: `You are a study assistant. Based on these course materials about "${focus}", create study content.\n\nStyle: ${styleGuide[type]}\n\nMATERIALS:\n${context.slice(0, 60000)}`,
        });
        return {
            content: response.text ?? 'Could not generate study content.',
            title: focus,
        };
    } catch { return { content: 'Error generating study content.', title: focus }; }
}

export async function checkVideoStatus(videoUri: string): Promise<{ done: boolean; uri: string }> {
    // Placeholder — real video generation would poll a generation API here
    void videoUri;
    return { done: true, uri: videoUri };
}

export async function answerQuestionFromContext(
    memories: any[],
    tasks: any[],
    question: string,
    calendarEvents: any[],
    onToolCall?: (call: { name: string; args: any }) => Promise<any>
): Promise<string> {
    const ai = getGeminiInstance();
    if (!ai) return UNAVAILABLE_ERROR_MESSAGE;

    const memContext = memories.slice(0, 50).map(m => {
        const content = m.type === 'voice' ? m.transcript :
                        m.type === 'document' ? m.extractedText :
                        m.type === 'web' ? m.content :
                        m.description || m.summary || '';
        return `[${(m.type || 'MEMORY').toUpperCase()}] ${m.title || '(untitled)'}: ${(content || '').slice(0, 400)}`;
    }).join('\n');

    const taskContext = tasks.slice(0, 20).map((t: any) =>
        `[TASK] ${t.title} — ${t.completed ? 'done' : 'pending'}${t.dueDate ? ` (due ${t.dueDate})` : ''}`
    ).join('\n');

    const calContext = calendarEvents.slice(0, 20).map((e: any) =>
        `[EVENT] ${e.title}: ${new Date(e.startTime).toLocaleString()}`
    ).join('\n');

    const systemPrompt = `You are a helpful AI assistant for a student's second brain. You have access to their memories, tasks, and calendar.

MEMORIES:\n${memContext || 'None.'}

TASKS:\n${taskContext || 'None.'}

CALENDAR:\n${calContext || 'None.'}

Instructions:
1. Answer based on the context when relevant. Be concise.
2. If something isn't in the context, say so honestly.
3. Reply in the user's language (Hebrew or English).
4. To schedule an event, use the createCalendarEvent tool.`;

    try {
        const response = await ai.models.generateContent({
            model,
            contents: question,
            config: {
                systemInstruction: systemPrompt,
                tools: [{
                    functionDeclarations: [{
                        name: 'createCalendarEvent',
                        description: 'Schedule a new calendar event for the user',
                        parameters: {
                            type: Type.OBJECT,
                            properties: {
                                title: { type: Type.STRING, description: 'Event title' },
                                startTime: { type: Type.STRING, description: 'ISO 8601 start datetime' },
                                endTime: { type: Type.STRING, description: 'ISO 8601 end datetime' },
                                category: { type: Type.STRING, description: 'personal or college' },
                                description: { type: Type.STRING, description: 'Optional notes' },
                            },
                            required: ['title', 'startTime', 'endTime'],
                        },
                    }],
                }],
            },
        });

        const parts = response.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
            if ((part as any).functionCall && onToolCall) {
                const call = (part as any).functionCall;
                const result = await onToolCall({ name: call.name, args: call.args });
                return result?.message ?? 'Done!';
            }
        }

        return response.text ?? 'No response generated.';
    } catch { return 'I encountered an error. Please try again.'; }
}

export async function generateTopicsForMemory(title: string, content: string): Promise<string[]> {
    const ai = getGeminiInstance();
    if (!ai) return [];
    try {
        const response = await ai.models.generateContent({
            model,
            contents: `Assign 1-3 broad topic labels to this memory. Choose only from: Study, Health, Finance, Technology, Travel, Food, Entertainment, Family, Fitness, Shopping, Social, Productivity, Creativity, Nature, Relationships, Work, News.\n\nTitle: "${title}"\nContent: ${content.substring(0, 800)}`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        topics: { type: Type.ARRAY, items: { type: Type.STRING } }
                    },
                    required: ["topics"]
                }
            }
        });
        const parsed = JSON.parse(response.text || '{}');
        return Array.isArray(parsed.topics) ? parsed.topics.slice(0, 3) : [];
    } catch { return []; }
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
