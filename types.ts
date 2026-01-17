export interface BaseMemory {
  id: string;
  date: string;
  title: string;
  category: 'college' | 'personal';
  tags?: string[];
  course?: string;
  isHidden?: boolean;
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

export interface StrokePoint {
    x: number;
    y: number;
    t: number;
}

export interface DrawingStroke {
    points: StrokePoint[];
    color: string;
    width: number;
}

export interface NotebookData {
    strokes: DrawingStroke[];
    backgroundImageUrl?: string;
    textNotes?: { text: string; x: number; y: number; t: number }[];
}

export interface VoiceMemory extends BaseMemory {
  type: 'voice';
  transcript: string;
  audioDataUrl?: string;
  summary?: string;
  structuredTranscript?: TranscriptSegment[];
  speakerMappings?: { [key: number]: string };
  actionItems?: { text: string; done: boolean }[];
  notebook?: NotebookData;
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

export interface FileMemory extends BaseMemory {
  type: 'file';
  fileUrl: string;
  mimeType: string;
  size?: number;
  sourceType?: 'moodle' | 'upload';
  moodleId?: string;
  summary?: string;
}

export type AnyMemory = VoiceMemory | WebMemory | PhysicalItemMemory | VideoItemMemory | DocumentMemory | FileMemory;

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
  course?: string;
  project?: string;
  subtasks?: SubTask[];
  dueDate?: string;
  linkedMemoryIds?: string[];
  createdAt: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: string; 
  endTime: string;   
  category: 'college' | 'personal';
  description?: string;
  relatedTaskId?: string;
  source?: 'moodle' | 'google' | 'manual';
}

export interface MoodleCourse {
    id: number;
    fullname: string;
    shortname: string;
}

export interface MoodleContent {
    id: number;
    name: string;
    type: 'file' | 'url' | 'folder' | 'resource';
    fileurl?: string;
    mimetype?: string;
}