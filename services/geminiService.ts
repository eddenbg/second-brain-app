
import type { AnyMemory, Task } from '../types';
import { getGeminiInstance } from '../utils/gemini';
import { Modality, Type } from '@google/genai';

// Upgraded to Gemini 3 Pro for better reasoning, summarization, and complex task handling
const model = "gemini-3-pro-preview";
const UNAVAILABLE_ERROR_MESSAGE = "AI features are unavailable. Please check your API key configuration.";

export async function answerQuestionFromContext(memories: AnyMemory[], tasks: Task[], question: string): Promise<string> {
  const ai = getGeminiInstance();
  if (!ai) return UNAVAILABLE_ERROR_MESSAGE;

  if (memories.length === 0 && tasks.length === 0) {
    return "There are no memories or tasks to search for an answer.";
  }

  // 1. Format Memories
  const memoryContext = memories.map(mem => {
    const date = new Date(mem.date).toLocaleString();
    const locationString = mem.location
      ? ` (Location: ${mem.location.latitude.toFixed(4)}, ${mem.location.longitude.toFixed(4)})`
      : '';
    const tagsString = (mem.tags && mem.tags.length > 0)
      ? `\nTags: [${mem.tags.join(', ')}]`
      : '';

    let memoryString = '';

    if (mem.type === 'voice') {
      const actionItems = mem.actionItems?.map(i => `- [${i.done ? 'x' : ' '}] ${i.text}`).join('\n') || '';
      const actionItemsStr = actionItems ? `\nAction Items (Internal to note):\n${actionItems}` : '';
      const summaryStr = mem.summary ? `\nSummary: ${mem.summary}` : '';
      
      if (mem.category === 'college') {
        const courseInfo = mem.course ? ` for course "${mem.course}"` : '';
        memoryString = `--- College Lecture${courseInfo}: "${mem.title}" (Recorded on: ${date}${locationString}) ---${tagsString}${summaryStr}\nTranscript:\n${mem.transcript}${actionItemsStr}\n--- End of College Lecture ---`;
      } else {
        memoryString = `--- Personal Voice Note: "${mem.title}" (Recorded on: ${date}${locationString}) ---${tagsString}${summaryStr}\nTranscript:\n${mem.transcript}${actionItemsStr}\n--- End of Personal Voice Note ---`;
      }
    } else if (mem.type === 'web') {
      const summaryStr = (mem as any).summary ? `\nSummary: ${(mem as any).summary}` : '';
      memoryString = `--- Web Clip: "${mem.title}" (Saved on: ${date}${locationString}, From: ${mem.url || 'N/A'}) ---${tagsString}${summaryStr}\nContent:\n${mem.content}`;
      if (mem.voiceNote) {
        memoryString += `\nMy Note: ${mem.voiceNote.transcript}`;
      }
      memoryString += `\n--- End of Web Clip ---`;
    } else if (mem.type === 'item') {
      memoryString = `--- Physical Item: "${mem.title}" (Saved on: ${date}${locationString}) ---${tagsString}\nDescription:\n${mem.description}`;
       if (mem.voiceNote) {
        memoryString += `\nMy Note: ${mem.voiceNote.transcript}`;
      }
      memoryString += `\n--- End of Physical Item ---`;
    } else if (mem.type === 'video') {
        memoryString = `--- Video Item: "${mem.title}" (Recorded on: ${date}${locationString}) ---${tagsString}\nDescription: ${mem.description}\nTranscript of audio from video: ${mem.transcript}`;
        memoryString += `\n--- End of Video Item ---`;
    } else if (mem.type === 'document') {
      const courseInfo = mem.course ? ` for course "${mem.course}"` : '';
      memoryString = `--- Scanned Document${courseInfo}: "${mem.title}" (Scanned on: ${date}${locationString}) ---${tagsString}\nExtracted Text:\n${mem.extractedText}\n--- End of Scanned Document ---`;
    }
    return memoryString;
  }).join('\n\n');

  // 2. Format Tasks (Kanban)
  const taskContext = tasks.map(t => {
      const subtasks = t.subtasks ? t.subtasks.map(s => `  - [${s.done ? 'x' : ' '}] ${s.title}`).join('\n') : '';
      const subtasksStr = subtasks ? `\nSubtasks:\n${subtasks}` : '';
      const contextInfo = t.category === 'college' ? `Course: ${t.course}` : `Category: Personal`;
      const projectInfo = t.project ? ` | Project: ${t.project}` : '';
      
      return `[TASK] Status: ${t.status.toUpperCase()} | Title: ${t.title} | ${contextInfo}${projectInfo}\nDescription: ${t.description || 'N/A'}${subtasksStr}`;
  }).join('\n');

  // Strict bilingual instruction
  const systemInstruction = `You are a helpful, bilingual personal assistant fluent in both English and Hebrew. 
  
  CORE RULE: You MUST answer the user's question in the EXACT SAME LANGUAGE that the user asked in. 
  - If the user asks in HEBREW, answer in HEBREW.
  - If the user asks in ENGLISH, answer in ENGLISH.
  - Ignore the language of the provided context/memories/tasks when deciding the output language. Only the user's question language matters.

  Your task is to answer the user's question based ONLY on the provided context. 
  The context contains "Memories" (notes, lectures, clips) and "Tasks" (from the Kanban boards).
  You can answer questions about the status of projects, specific to-dos, and details from notes.
  
  If the answer cannot be found, you MUST respond with: "I could not find an answer in your memories or tasks." (or the Hebrew equivalent). Be concise.`;

  try {
    const response = await ai.models.generateContent({
        model,
        contents: `CONTEXT FROM TASKS (KANBAN):\n${taskContext}\n\nCONTEXT FROM MEMORIES:\n${memoryContext}\n\nUSER'S QUESTION:\n${question}`,
        config: {
            systemInstruction,
        },
    });
    return response.text;
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return "Sorry, I encountered an error while trying to find an answer.";
  }
}

export async function answerFromImage(base64Data: string, mimeType: string, question: string): Promise<string> {
    const ai = getGeminiInstance();
    if (!ai) return UNAVAILABLE_ERROR_MESSAGE;

    const imagePart = {
      inlineData: {
        mimeType,
        data: base64Data,
      },
    };
    const textPart = {
      text: question,
    };

    try {
        const response = await ai.models.generateContent({
            model,
            contents: { parts: [imagePart, textPart] },
        });
        return response.text;
    } catch (error) {
        console.error("Error calling Gemini API for image question:", error);
        return "Sorry, I encountered an error while analyzing the image.";
    }
}


export async function generateTitleForContent(content: string): Promise<string> {
    const ai = getGeminiInstance();
    if (!ai) return "Untitled";

    if (!content.trim()) {
        return '';
    }
    const systemInstruction = "You are an expert title generator. Your task is to create a short, concise, and descriptive title for the provided text. The title should be in the same language as the majority of the text (either English or Hebrew). The title should be 10 words or less. Respond with the title only, nothing else.";
    
    try {
        const response = await ai.models.generateContent({
            model,
            contents: `Generate a title for this text:\n\n${content.substring(0, 4000)}`, // Truncate for safety
            config: {
                systemInstruction,
                stopSequences: ['\n']
            },
        });
        return response.text.trim().replace(/"/g, ''); // Remove quotes from title
    } catch (error) {
        console.error("Error generating title:", error);
        return "Untitled";
    }
}

export async function analyzeVoiceNote(content: string): Promise<{ title: string; actionItems: string[] }> {
    const ai = getGeminiInstance();
    if (!ai) return { title: "Untitled", actionItems: [] };

    if (!content.trim()) return { title: "Empty Note", actionItems: [] };

    try {
        const response = await ai.models.generateContent({
            model,
            contents: `Analyze the following voice note transcript. Provide a concise title (max 10 words) and a list of specific action items or to-dos mentioned or implied in the text.
            
            Transcript:
            ${content.substring(0, 4000)}`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING },
                        actionItems: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING }
                        }
                    },
                    required: ["title", "actionItems"]
                }
            }
        });
        
        const json = JSON.parse(response.text);
        return {
            title: json.title || "Untitled Voice Note",
            actionItems: json.actionItems || []
        };
    } catch (error) {
        console.error("Error analyzing voice note:", error);
        return { title: "Voice Note", actionItems: [] };
    }
}

export async function generateSummaryForContent(content: string): Promise<string> {
    const ai = getGeminiInstance();
    if (!ai) return "Could not generate summary.";

    if (!content.trim()) {
        return '';
    }
    const systemInstruction = "You are an expert at summarizing text. Your task is to create a short and concise summary for the provided lecture transcript. The summary MUST be in Hebrew. Focus on the main points and key topics. The summary should be 2-4 sentences long. Respond with the summary only, nothing else.";
    
    try {
        const response = await ai.models.generateContent({
            model,
            contents: `Summarize this lecture transcript:\n\n${content.substring(0, 8000)}`, // Truncate for safety
            config: {
                systemInstruction,
            },
        });
        return response.text.trim();
    } catch (error) {
        console.error("Error generating summary:", error);
        return "Could not generate summary.";
    }
}

// Generic summary for Web Clips (detects language)
export async function generateGeneralSummary(content: string): Promise<string> {
    const ai = getGeminiInstance();
    if (!ai) return "";

    if (!content.trim()) return '';

    const systemInstruction = "You are an expert summarizer. Summarize the provided text in 2-3 sentences. Write the summary in the SAME LANGUAGE as the provided text (English or Hebrew).";

    try {
        const response = await ai.models.generateContent({
            model,
            contents: `Summarize this content:\n\n${content.substring(0, 8000)}`,
            config: { systemInstruction },
        });
        return response.text.trim();
    } catch (error) {
        console.error("Error generating web summary:", error);
        return "";
    }
}

export async function extractTextFromImage(base64Data: string, mimeType: string): Promise<string> {
    const ai = getGeminiInstance();
    if (!ai) return UNAVAILABLE_ERROR_MESSAGE;

    const imagePart = {
      inlineData: {
        mimeType,
        data: base64Data,
      },
    };
    const textPart = {
      text: "Extract all text from this image, including text in both English and Hebrew. Preserve the original line breaks and structure as much as possible.",
    };

    try {
        const response = await ai.models.generateContent({
            model,
            contents: { parts: [imagePart, textPart] },
        });
        return response.text;
    } catch (error) {
        console.error("Error calling Gemini API for image text extraction:", error);
        return "Sorry, I encountered an error while extracting text from the image.";
    }
}

export async function generateSpeechFromText(text: string): Promise<string | null> {
    const ai = getGeminiInstance();
    if (!ai) return null;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: 'Kore' }, // A neutral voice
                    },
                },
            },
        });
        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        return base64Audio || null;

    } catch (error) {
        console.error("Error generating speech:", error);
        return null;
    }
}
