import { GoogleGenAI, Modality, Type } from '@google/genai';

export const UNAVAILABLE_ERROR_MESSAGE = "AI features are currently unavailable. The API key may not be configured.";
// Distinguishable from other failure text (see UNAVAILABLE_ERROR_MESSAGE and the
// generic catch-all below) so callers that care — e.g. WebClipListenButtons in
// PersonalView.tsx — can tell "the model hung and we gave up" apart from "the
// model answered but the answer wasn't useful" and show a real error state
// instead of quietly speaking/displaying this sentence as if it were content.
export const AI_TIMEOUT_ERROR_MESSAGE = "That took too long to generate — please try again.";

let geminiInstance: GoogleGenAI | null = null;

export const getGeminiInstance = (): GoogleGenAI | null => {
    if (geminiInstance) return geminiInstance;
    // utils/gemini.ts (used by Recorder.tsx's live transcription) checks
    // localStorage['gemini_api_key'] before the build-time env var; this copy
    // didn't, which would silently degrade every other Gemini feature (TTS,
    // summarization, vision/OCR, My Belongings AI-generate) relative to live
    // transcription the moment a Settings UI exists to set that key. Matching
    // the precedence now so the two can't drift again.
    const apiKey = (typeof localStorage !== 'undefined' && localStorage.getItem('gemini_api_key'))
        || process.env.API_KEY
        || (import.meta as any).env?.VITE_API_KEY;
    if (!apiKey) return null;
    geminiInstance = new GoogleGenAI({ apiKey });
    return geminiInstance;
};

const model = 'gemini-2.5-flash';

const QA_TIMEOUT_MS = 15000;

export async function askQuestion(question: string, context: string): Promise<string> {
    const ai = getGeminiInstance();
    if (!ai) return UNAVAILABLE_ERROR_MESSAGE;
    try {
        // Same class of bug as generateSpeechFromText below: the SDK call has no
        // timeout of its own, so a slow/hung response left any caller awaiting
        // this (e.g. WebClipListenButtons' "Play Gist", which summarizes via
        // this function before it can even start generating audio) stuck
        // forever with no rejection to catch. Race it so the caller always
        // gets a result within a bounded time.
        const response = await Promise.race([
            ai.models.generateContent({
                model,
                contents: `Context:\n${context.substring(0, 50000)}\n\nQuestion: ${question}`,
            }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('QA_TIMEOUT')), QA_TIMEOUT_MS)),
        ]);
        return response.text ?? "I couldn't find an answer.";
    } catch (error: any) {
        if (error?.message === 'QA_TIMEOUT') return AI_TIMEOUT_ERROR_MESSAGE;
        return "I encountered an error while processing your question.";
    }
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

// Was 30s. That's still a long time to stare at a bare spinner even with a
// bound on it, and it stacks with whatever fetch/summarize step ran before
// this (e.g. WebClipListenButtons fetching the article, then summarizing it,
// then finally reaching this call) — so it's tightened to 20s here, and the
// callers most exposed to the stacking (WebClipListenButtons) additionally
// show a progressive "Fetching…" / "Summarizing…" / "Generating audio…"
// status and an overall dead-man's-switch on top of this.
const TTS_TIMEOUT_MS = 20000;

export async function generateSpeechFromText(text: string): Promise<string | null> {
    const ai = getGeminiInstance();
    if (!ai) return null;
    try {
        // The SDK call itself has no timeout, so a slow/hung TTS response left
        // every "Read Aloud"/"Play" button spinning indefinitely with no way
        // out. Race it against a timeout so the caller gets null (and its own
        // "couldn't generate audio" handling) instead of a dead spinner.
        const response = await Promise.race([
            ai.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: text.substring(0, 5000) }] }],
                config: { responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
            }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('TTS request timed out')), TTS_TIMEOUT_MS)),
        ]);
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
                    { text: `Extract all text from this image exactly as written. Hebrew is the default and primary language — when a mark or word is ambiguous or unclear, read it as Hebrew rather than English. Only read a word as English when it clearly cannot be Hebrew. Support both printed and handwritten text. Preserve line breaks and original layout. Return text in the language it was written.` }
                ] 
            },
        });
        return response.text ?? "No text found.";
    } catch (error) { return "Error extracting text."; }
}

export async function generateItemDetailsFromImage(base64Data: string, mimeType: string): Promise<{ title: string; description: string }> {
    const ai = getGeminiInstance();
    if (!ai) return { title: 'Untitled', description: '' };
    try {
        const response = await ai.models.generateContent({
            model,
            contents: {
                parts: [
                    { inlineData: { mimeType, data: base64Data } },
                    { text: `Look at this photo/video frame of a physical object or item. Return a short, descriptive title (max 8 words) and a one-to-two sentence description covering what it is, notable features (color, brand, condition), and its location if visible or inferable. Hebrew is the default and primary language for any visible text — when text is ambiguous, read it as Hebrew rather than English.` }
                ]
            },
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING },
                        description: { type: Type.STRING },
                    },
                    required: ['title', 'description'],
                },
            },
        });
        const parsed = JSON.parse(response.text || '{}');
        return {
            title: (parsed.title || 'Untitled').toString().trim(),
            description: (parsed.description || '').toString().trim(),
        };
    } catch (error) {
        console.error('Error generating item details from image:', error);
        return { title: 'Untitled', description: '' };
    }
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

export async function summarizeLectureTranscript(
    transcript: string
): Promise<{ summary: string; actionItems: Array<{ text: string; done: boolean }> }> {
    const ai = getGeminiInstance();
    if (!ai) return { summary: '', actionItems: [] };
    try {
        const response = await ai.models.generateContent({
            model,
            contents: `Analyze this lecture transcript and provide:
1. A concise summary (3-5 bullet points) of the key concepts covered
2. Any action items, deadlines, or assignments mentioned (e.g., "Read Chapter 5", "Assignment due Friday")

Transcript:
${transcript.substring(0, 30000)}`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        summary: {
                            type: Type.STRING,
                            description: "Bullet-point summary of key concepts (3-5 points)"
                        },
                        actionItems: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING },
                            description: "List of assignments, readings, or action items mentioned"
                        }
                    },
                    required: ["summary", "actionItems"]
                }
            }
        });
        const parsed = JSON.parse(response.text || '{}');
        const actionItems = (Array.isArray(parsed.actionItems) ? parsed.actionItems : [])
            .map((item: string) => ({ text: item, done: false }));
        return {
            summary: parsed.summary || '',
            actionItems
        };
    } catch (error) {
        console.error('Error summarizing lecture:', error);
        return { summary: '', actionItems: [] };
    }
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

export async function extractHandwritingFromImage(base64Data: string): Promise<string> {
    const ai = getGeminiInstance();
    if (!ai) return UNAVAILABLE_ERROR_MESSAGE;
    try {
        const response = await ai.models.generateContent({
            model,
            contents: [
                {
                    parts: [
                        { inlineData: { mimeType: 'image/png', data: base64Data } },
                        { text: `Extract all handwritten text from this image. Hebrew (RTL) is the default and primary language — when a mark or word is ambiguous or unclear, read it as Hebrew rather than English. Only read a word as English when it clearly cannot be Hebrew. Return the text exactly as written, preserving line breaks and layout when possible. If there are multiple sections, separate them with line breaks. Return ONLY the extracted text, no explanations.` }
                    ]
                }
            ]
        });
        return response.text ?? "No text found in image.";
    } catch (error) {
        console.error('Error extracting handwriting:', error);
        return "Error extracting text from image.";
    }
}

export async function transcribeAudioFile(
    file: File,
    onProgress?: (progress: number) => void
): Promise<string> {
    const ai = getGeminiInstance();
    if (!ai) return UNAVAILABLE_ERROR_MESSAGE;

    try {
        onProgress?.(10);

        // Convert file to base64
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        const base64Data = Array.from(uint8Array)
            .map((byte) => String.fromCharCode(byte))
            .join('');
        const encodedData = btoa(base64Data);

        onProgress?.(30);

        // Determine MIME type
        const mimeType = file.type || 'audio/mp4';

        // Call Gemini with audio file
        const response = await ai.models.generateContent({
            model,
            contents: [
                {
                    parts: [
                        { inlineData: { mimeType, data: encodedData } },
                        { text: 'Transcribe this audio file completely and accurately. Support both Hebrew (RTL) and English. Return the full transcript, preserving all spoken words and natural pauses. Do not add interpretations, only transcribed speech.' }
                    ]
                }
            ]
        });

        onProgress?.(100);
        return response.text ?? "No transcript could be generated from the audio file.";
    } catch (error) {
        console.error('Error transcribing audio:', error);
        return "Error transcribing audio file. Please try again or check file format.";
    }
}
