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

    if (mem.type === 'voice') {
      if (mem.category === 'college') {
        const courseInfo = mem.course ? ` for course "${mem.course}"` : '';
        return `--- College Lecture${courseInfo}: "${mem.title}" (Recorded on: ${date}${locationString}) ---\n${mem.transcript}\n--- End of College Lecture: "${mem.title}" ---`;
      } else {
        return `--- Personal Voice Note: "${mem.title}" (Recorded on: ${date}${locationString}) ---\n${mem.transcript}\n--- End of Personal Voice Note: "${mem.title}" ---`;
      }
    } else if (mem.type === 'web') {
      let webContext = `--- Web Clip: "${mem.title}" (Saved on: ${date}${locationString}, From: ${mem.url || 'N/A'}) ---`;
      if (mem.tags && mem.tags.length > 0) {
        webContext += `\nTags: [${mem.tags.join(', ')}]`;
      }
      webContext += `\nContent:\n${mem.content}`;
      if (mem.voiceNote) {
        webContext += `\nMy Note: ${mem.voiceNote.transcript}`;
      }
      webContext += `\n--- End of Web Clip: "${mem.title}" ---`;
      return webContext;
    } else if (mem.type === 'item') {
      let itemContext = `--- Physical Item: "${mem.title}" (Saved on: ${date}${locationString}) ---\nDescription:\n${mem.description}`;
       if (mem.voiceNote) {
        itemContext += `\nMy Note: ${mem.voiceNote.transcript}`;
      }
      itemContext += `\n--- End of Physical Item: "${mem.title}" ---`;
      return itemContext;
    } else if (mem.type === 'video') {
        let videoContext = `--- Video Item: "${mem.title}" (Recorded on: ${date}${locationString}) ---\nDescription: ${mem.description}\nTranscript of audio from video: ${mem.transcript}`;
        videoContext += `\n--- End of Video Item: "${mem.title}" ---`;
        return videoContext;
    }
    return '';
  }).join('\n\n');

  const systemInstruction = `You are a helpful personal assistant. Your task is to answer the user's question based ONLY on the provided context from their saved memories, which include college lectures, voice notes, web clippings, physical items, and video recordings with transcripts. Analyze the content and location data carefully. Do not use any external knowledge. If the anwer cannot be found, you MUST respond with: "I could not find an answer in your memories." Be concise and directly answer the question.`;

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
    const systemInstruction = "You are a title generator. Your task is to create a short, concise, and descriptive title for the provided text. The title should be 10 words or less. Respond only with the title itself, nothing else.";
    
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