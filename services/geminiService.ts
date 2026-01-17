import { GoogleGenAI, Modality, Type, FunctionDeclaration } from "@google/genai";
import { getGeminiInstance } from '../utils/gemini';
import type { AnyMemory, Task, CalendarEvent } from '../types';

const model = "gemini-3-pro-preview";
const videoModel = "veo-3.1-fast-generate-preview";
const UNAVAILABLE_ERROR_MESSAGE = "AI features are unavailable. Please check your API key configuration.";

// Fix: Support 'research' type in generateStudyOverview to match UI capabilities in FilesView.tsx
export async function generateStudyOverview(
    memories: AnyMemory[], 
    focus: string, 
    type: 'written' | 'audio' | 'video' | 'research'
): Promise<{ content: string, title: string, videoUri?: string }> {
    const ai = getGeminiInstance();
    if (!ai) throw new Error("AI Unavailable");

    const context = memories.map(m => `[SOURCE: ${m.title}] ${
        m.type === 'voice' ? (m as any).transcript : (m as any).extractedText || (m as any).summary
    }`).join('\n\n---\n\n');

    const titleRes = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Create a 3-word title for this collection of notes: ${context.substring(0, 1000)}`
    });
    const title = titleRes.text?.trim() || "Study Session";

    if (type === 'video') {
        // Step 1: Generate a visual prompt
        const promptRes = await ai.models.generateContent({
            model,
            contents: `CONTEXT:\n${context}\n\nTASK: Create a cinematic, educational prompt for a 5-second video explainer. 
            The video should visually represent the core concept of these notes. 
            FOCUS: ${focus || 'Key concepts'}. 
            Style: Academic, high-quality 3D motion graphics.`,
        });
        const videoPrompt = promptRes.text || "An educational abstract concept video.";

        // Step 2: Call Veo
        let operation = await ai.models.generateVideos({
            model: videoModel,
            prompt: videoPrompt,
            config: { numberOfVideos: 1, resolution: '720p', aspectRatio: '16:9' }
        });

        // Polling handled by UI to keep thread open
        return { content: videoPrompt, title, videoUri: (operation as any).name }; 
    }

    let prompt = "";
    if (type === 'written') {
        prompt = `Create a structured academic deep-dive. FOCUS: ${focus || 'General synthesis'}.`;
    } else if (type === 'research') {
        // Fix: Added prompt for research type
        prompt = `Synthesize these sources for a deep research session. Identify non-obvious links and areas for further inquiry. FOCUS: ${focus || 'Synthesis and connections'}.`;
    } else {
        prompt = `Write a script for a "Study Podcast". The host should be engaging. FOCUS: ${focus || 'Key takeaways'}.`;
    }

    const response = await ai.models.generateContent({
        model,
        contents: `CONTEXT:\n${context}\n\nGOAL: ${prompt}`,
        config: { systemInstruction: "You are an advanced education research assistant specializing in cross-document connections." }
    });

    return { content: response.text || "Summary failed.", title };
}

export async function checkVideoStatus(operationName: string): Promise<{ done: boolean, uri?: string }> {
    const ai = getGeminiInstance();
    if (!ai) return { done: false };
    const operation = await ai.operations.getVideosOperation({ operation: { name: operationName } as any });
    if (operation.done) {
        return { done: true, uri: operation.response?.generatedVideos?.[0]?.video?.uri };
    }
    return { done: false };
}

export async function answerQuestionFromContext(
    memories: AnyMemory[], 
    tasks: Task[], 
    question: string,
    calendarEvents: CalendarEvent[] = [],
    onToolCall?: (toolCall: any) => Promise<any>
): Promise<string> {
  const ai = getGeminiInstance();
  if (!ai) return UNAVAILABLE_ERROR_MESSAGE;

  const memoryContext = memories.map(mem => `[MEM_ID: ${mem.id}] [COURSE: ${mem.course || 'Personal'}] [TITLE: ${mem.title}] CONTENT: ${
      mem.type === 'voice' ? (mem as any).transcript : 
      mem.type === 'document' ? (mem as any).extractedText : 
      (mem as any).summary || (mem as any).content || ''
  }`).join('\n\n---\n\n');

  const systemInstruction = `You are a personal research assistant for a student.
  Current Date/Time: ${new Date().toLocaleString()}
  
  CONTEXT: The provided text is the user's ENTIRE Second Brain. 
  
  TASK: 
  1. Answer the question using the primary documents provided.
  2. DEEP RECALL: Proactively look for connections in OTHER memories not mentioned in the question. 
  3. If you find a connection (e.g., "This relates to a Biology note you took last month"), explicitly point it out.
  4. Always cite the Note Title when referencing information.
  5. Reply in the user's language (Hebrew or English).`;

  try {
    const response = await ai.models.generateContent({
        model,
        contents: `KNOWLEDGE BASE:\n${memoryContext}\n\nUSER QUESTION:\n${question}`,
        config: { systemInstruction },
    });
    return response.text ?? "I couldn't find a connection.";
  } catch (error) {
    return "Error querying your brain.";
  }
}

export async function generateTitleForContent(content: string): Promise<string> {
    const ai = getGeminiInstance();
    if (!ai || !content.trim()) return "Untitled";
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Short, uppercase 2-3 word title for: ${content.substring(0, 1000)}`,
            config: { stopSequences: ['\n'] },
        });
        return (response.text ?? "Untitled").trim().replace(/"/g, ''); 
    } catch (error) { return "Untitled"; }
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
                    { text: `Extract text precisely. Hebrew/English.` }
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

export async function processSharedUrl(url: string, title: string, text: string): Promise<{ 
    title: string; 
    summary: string; 
    type: 'Article' | 'Video'; 
    takeaways: string[] 
}> {
    const ai = getGeminiInstance();
    if (!ai) throw new Error("AI Unavailable");
    try {
        const response = await ai.models.generateContent({
            model,
            contents: `URL: ${url}. Analyze and return JSON with summary and takeaways.`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING },
                        summary: { type: Type.STRING },
                        type: { type: Type.STRING, enum: ['Article', 'Video'] },
                        takeaways: { type: Type.ARRAY, items: { type: Type.STRING } }
                    },
                    required: ["title", "summary", "type", "takeaways"]
                }
            }
        });
        return JSON.parse(response.text || "{}");
    } catch (error) { return { title: title || "Shared Link", summary: text, type: 'Article', takeaways: [] }; }
}