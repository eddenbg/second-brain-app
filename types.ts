export interface BaseMemory {
  id: string;
  date: string;
  title: string;
  voiceNote?: {
    transcript: string;
  };
  location?: {
    latitude: number;
    longitude: number;
  };
}

export interface VoiceMemory extends BaseMemory {
  type: 'voice';
  transcript: string;
}

export interface WebMemory extends BaseMemory {
  type: 'web';
  url: string;
  content: string;
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

export type AnyMemory = VoiceMemory | WebMemory | PhysicalItemMemory | VideoItemMemory;