export interface BaseMemory {
  id: string;
  date: string;
  title: string;
  category: 'college' | 'personal';
  tags?: string[];
  topics?: string[];
  course?: string;
  isHidden?: boolean;
  isFavorite?: boolean;
  folderPath?: string;
  voiceNote?: {
    transcript: string;
    audioDataUrl?: string;
    structuredTranscript?: TranscriptSegment[];
  };
  location?: {
    latitude: number;
    longitude: number;
  };
  locationName?: string;
}

export interface TranscriptSegment {
  speakerId?: number;
  text: string;
  timestamp: number; // Offset in seconds from start
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
    /** Size of the drawing surface when these strokes were captured, in CSS pixels.
     *  Replay happens on a differently sized canvas, so without this the strokes
     *  cannot be scaled and simply fall outside the visible area. */
    canvasWidth?: number;
    canvasHeight?: number;
    backgroundImageUrl?: string;
    textNotes?: { text: string; x: number; y: number; t: number }[];
}

export interface VoiceMemory extends BaseMemory {
  type: 'voice';
  transcript: string;
  audioDataUrl?: string;
  /** Recording held in the user's Drive, when it was too large to inline in the
   *  Firestore document (which is capped at 1MB). */
  audioDriveFileId?: string;
  videoDriveFileId?: string;
  videoDataUrl?: string;
  summary?: string;
  structuredTranscript?: TranscriptSegment[];
  speakerMappings?: { [key: number]: string };
  actionItems?: { text: string; done: boolean }[];
  notebook?: NotebookData;
}

export interface WebMemory extends BaseMemory {
  type: 'web';
  url: string;
  /** Short note/summary shown in list previews — a user's own note, an
   *  AI-written gist from the share-target flow, or (for Notion page
   *  imports specifically) the full page text, since that flow already
   *  fetches it in full. Never assume this is short. */
  content: string;
  contentType?: string;
  /** Full extracted article/page text (server-fetched via extractUrlContent),
   *  used for "Play" so it reads the whole clip while "Play Gist" summarizes
   *  it. Absent on clips saved before this existed, or when extraction
   *  wasn't possible — callers should fall back to `content` and may
   *  lazily fetch-and-cache this on first use. */
  fullText?: string;
  fullTextFetchedAt?: string;
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
  structuredTranscript?: TranscriptSegment[];
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
  sourceType?: 'moodle' | 'upload' | 'drive';
  moodleId?: string;
  driveId?: string;
  summary?: string;
}

export interface PodcastSnipMemory extends BaseMemory {
  type: 'podcast';
  showName: string;
  episodeTitle: string;
  /** Canonical Spotify episode URL, e.g. https://open.spotify.com/episode/<id>
   *  (si/t query params stripped — see netlify/functions/podcastSnip.ts). */
  episodeUrl: string;
  /** Playback position (seconds) the user's Spotify "Share Timestamp" link pointed at. */
  timestampSeconds: number;
  /** Transcript of just the audio window around timestampSeconds, NOT the
   *  full episode — see netlify/functions/podcastSnip.ts for how that window
   *  is chosen. */
  transcript: string;
  /** Actual transcribed window, in seconds from the start of the episode. */
  audioWindowStartSeconds: number;
  audioWindowEndSeconds: number;
  /** Whether the audio host honored our HTTP Range request for just this
   *  window, or fell back to a whole-file download (see fetchAudioWindow in
   *  the function) — false means the transcript may cover more (or, if the
   *  file exceeded the size ceiling, could not be produced at all). */
  rangeSupported: boolean;
  /** True when the byte-range window was computed from an assumed typical
   *  podcast bitrate rather than this episode's actual declared size+duration
   *  (see estimateBitrate in the function) — window boundaries are less
   *  precise when true. */
  bitrateEstimated: boolean;
  /** Direct audio (RSS enclosure) URL the transcript was actually generated
   *  from, kept for transparency/debugging — not necessarily still valid
   *  long-term (podcast hosts do rotate CDN URLs). */
  audioSourceUrl: string;
}

export type AnyMemory = VoiceMemory | WebMemory | PhysicalItemMemory | VideoItemMemory | DocumentMemory | FileMemory | PodcastSnipMemory;

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
    /** Unix seconds. Present on results from core_course_get_enrolled_courses_by_timeline_classification;
     *  absent from the core_enrol_get_users_courses fallback. Used to guess a term label for semester import. */
    startdate?: number;
}

export interface MoodleContent {
    id: number;
    name: string;
    type: 'file' | 'url' | 'folder' | 'resource';
    fileurl?: string;
    mimetype?: string;
}
