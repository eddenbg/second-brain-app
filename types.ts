
export interface BaseMemory {
  id: string;
  date: string;
  title: string;
  category: 'college' | 'personal';
  tags?: string[];
  course?: string;
  voiceNote?: {
    transcript: string;
  };
  location?: {
    latitude: number;
    longitude: number;
  };
}

export interface TranscriptSegment {
  speakerId: number;
  text: string;
}

export interface VoiceMemory extends BaseMemory {
  type: 'voice';
  transcript: string;
  summary?: string;
  structuredTranscript?: TranscriptSegment[];
  speakerMappings?: { [key: number]: string };
  actionItems?: { text: string; done: boolean }[];
}

export interface WebMemory extends BaseMemory {
  type: 'web';
  url: string;
  content: string;
  contentType?: string;
}

export interface PhysicalItemMemory extends BaseMemory {
  type: 'item';
  description: string;
  imageDataUrl: string;
}

export interface VideoItemMemory extends BaseMemory {
  type: 'video';
  description: string;
  videoDataUrl: string;
  transcript: string;
}

export interface DocumentMemory extends BaseMemory {
  type: 'document';
  extractedText: string;
  imageDataUrl: string;
}

export type AnyMemory = VoiceMemory | WebMemory | PhysicalItemMemory | VideoItemMemory | DocumentMemory;

export type TaskStatus = 'idea' | 'todo' | 'in-progress' | 'done';

export interface SubTask {
    id: string;
    title: string;
    done: boolean;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  category: 'college' | 'personal';
  course?: string; // For college
  project?: string; // For personal or college projects
  subtasks?: SubTask[];
  dueDate?: string;
  linkedMemoryIds?: string[]; // IDs of memories linked to this task
  createdAt: string;
}
