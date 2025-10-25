import type { AnyMemory } from '../types';
import { getGeminiInstance } from '../utils/gemini';

const model = "gemini-2.5-flash";
const UNAVAILABLE_ERROR_MESSAGE = "AI features are unavailable. Please check your API key configuration.";

export async function answerQuestionFromContext(memories: AnyMemory[], question: string): Promise<string> {
  const ai = getGeminiInstance();
  if (!ai) return UNAVAILABLE_ERROR_MESSAGE;

  if (memories.length === 0) {
    return "There are no memories to search for an answer.";
  }

  const context = memories.map(mem => {
    const date = new Date(mem.date).toLocaleString();
    const locationString = mem.location
      ? ` (Location: ${mem.location.latitude.toFixed(4)}, ${mem.location.longitude.toFixed(4)})`
      : '';
    const tagsString = (mem.tags && mem.tags.length > 0)
      ? `\nTags: [${mem.tags.join(', ')}]`
      : '';

    let memoryString = '';

    if (mem.type === 'voice') {
      if (mem.category === 'college') {
        const courseInfo = mem.course ? ` for course "${mem.course}"` : '';
        memoryString = `--- College Lecture${courseInfo}: "${mem.title}" (Recorded on: ${date}${locationString}) ---${tagsString}\nTranscript:\n${mem.transcript}\n--- End of College Lecture: "${mem.title}" ---`;
      } else {
        memoryString = `--- Personal Voice Note: "${mem.title}" (Recorded on: ${date}${locationString}) ---${tagsString}\nTranscript:\n${mem.transcript}\n--- End of Personal Voice Note: "${mem.title}" ---`;
      }
    } else if (mem.type === 'web') {
      memoryString = `--- Web Clip: "${mem.title}" (Saved on: ${date}${locationString}, From: ${mem.url || 'N/A'}) ---${tagsString}\nContent:\n${mem.content}`;
      if (mem.voiceNote) {
        memoryString += `\nMy Note: ${mem.voiceNote.transcript}`;
      }
      memoryString += `\n--- End of Web Clip: "${mem.title}" ---`;
    } else if (mem.type === 'item') {
      memoryString = `--- Physical Item: "${mem.title}" (Saved on: ${date}${locationString}) ---${tagsString}\nDescription:\n${mem.description}`;
       if (mem.voiceNote) {
        memoryString += `\nMy Note: ${mem.voiceNote.transcript}`;
      }
      memoryString += `\n--- End of Physical Item: "${mem.title}" ---`;
    } else if (mem.type === 'video') {
        memoryString = `--- Video Item: "${mem.title}" (Recorded on: ${date}${locationString}) ---${tagsString}\nDescription: ${mem.description}\nTranscript of audio from video: ${mem.transcript}`;
        memoryString += `\n--- End of Video Item: "${mem.title}" ---`;
    }
    return memoryString;
  }).join('\n\n');

  const systemInstruction = `You are a helpful, bilingual personal assistant fluent in both English and Hebrew. Your task is to answer the user's question based ONLY on the provided context from their saved memories. The memories can be in English, Hebrew, or a mix of both. It is crucial that you respond in the same language as the user's question. For example, if the question is in Hebrew, your answer must be in Hebrew. If the question is in English, your answer must be in English. Do not use any external knowledge. If the answer cannot be found, you MUST respond with: "I could not find an answer in your memories." (or the Hebrew equivalent if the question was in Hebrew). Be concise and directly answer the question.`;

  try {
    const response = await ai.models.generateContent({
        model,
        contents: `CONTEXT FROM MEMORIES:\n${context}\n\nUSER'S QUESTION:\n${question}`,
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