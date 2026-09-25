import { Modality, Session } from '@google/genai';
import { getGeminiInstance } from './gemini';
import { encode, downsampleTo16k } from './audio';

// Voice dictation for text fields. Uses the same Gemini Live transcription
// engine as voice notes and lecture recording (same model, same 16 kHz audio
// pipeline, same input transcription), so Hebrew, English and switching
// between them mid-sentence behave identically.

export type DictationStatus = 'idle' | 'connecting' | 'listening' | 'stopping' | 'error';

interface DictationHandlers {
    onText: (delta: string) => void;
    onStatus: (status: DictationStatus, error?: string) => void;
}

const MODEL = 'gemini-2.5-flash-native-audio-latest';
// Let the last words finish transcribing after the user taps stop
const TRAILING_TRANSCRIPT_MS = 1200;
// Safety cap so a forgotten mic doesn't keep streaming
const MAX_DICTATION_MS = 5 * 60 * 1000;

export const DICTATION_NO_KEY_ERROR = 'Voice input needs the Gemini API key.';
export const DICTATION_MIC_ERROR = 'Microphone access was denied. Allow the microphone for this site and try again.';
export const DICTATION_FAILED_ERROR = 'Voice input failed. Check your connection and try again.';

class DictationSession {
    private stream: MediaStream | null = null;
    private context: AudioContext | null = null;
    private sessionPromise: Promise<Session> | null = null;
    private capTimer: ReturnType<typeof setTimeout> | null = null;
    private stopped = false;

    constructor(private handlers: DictationHandlers) {}

    async start(): Promise<void> {
        const ai = getGeminiInstance();
        if (!ai) {
            this.handlers.onStatus('error', DICTATION_NO_KEY_ERROR);
            return;
        }
        this.handlers.onStatus('connecting');
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
            this.handlers.onStatus('error', DICTATION_MIC_ERROR);
            return;
        }
        if (this.stopped) { this.release(); return; }

        try {
            const context = new (window.AudioContext || (window as any).webkitAudioContext)();
            this.context = context;
            await context.resume();
            const sampleRate = context.sampleRate;
            const stream = this.stream;

            this.sessionPromise = ai.live.connect({
                model: MODEL,
                callbacks: {
                    onopen: () => {
                        if (this.stopped) return;
                        const source = context.createMediaStreamSource(stream);
                        const processor = context.createScriptProcessor(4096, 1, 1);
                        processor.onaudioprocess = (e) => {
                            if (this.stopped) return;
                            const int16 = downsampleTo16k(e.inputBuffer.getChannelData(0), sampleRate);
                            const media = { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
                            this.sessionPromise?.then(s => s.sendRealtimeInput({ media }));
                        };
                        source.connect(processor);
                        processor.connect(context.destination);
                        this.handlers.onStatus('listening');
                    },
                    onmessage: (message) => {
                        const text = message.serverContent?.inputTranscription?.text;
                        if (text) this.handlers.onText(text);
                    },
                    onerror: (e) => {
                        console.error('Dictation error', e);
                        if (!this.stopped) this.handlers.onStatus('error', DICTATION_FAILED_ERROR);
                        this.stop(false);
                    },
                    onclose: () => { /* released in stop() */ },
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                    systemInstruction: 'You are a dictation helper. The user is dictating text into a form field, possibly switching between Hebrew and English mid-sentence. Do not respond; just listen.',
                },
            });
            this.sessionPromise.catch(() => {
                if (!this.stopped) this.handlers.onStatus('error', DICTATION_FAILED_ERROR);
                this.stop(false);
            });
            this.capTimer = setTimeout(() => this.stop(), MAX_DICTATION_MS);
        } catch (e) {
            console.error('Dictation start failed', e);
            this.handlers.onStatus('error', DICTATION_FAILED_ERROR);
            this.release();
        }
    }

    /** Stop listening. `graceful` waits briefly so trailing words are transcribed. */
    async stop(graceful = true): Promise<void> {
        if (this.stopped) return;
        this.stopped = true;
        if (this.capTimer) clearTimeout(this.capTimer);
        // Mic off right away so the user sees/feels it stop
        this.stream?.getTracks().forEach(t => t.stop());
        if (graceful && this.sessionPromise) {
            this.handlers.onStatus('stopping');
            await new Promise(r => setTimeout(r, TRAILING_TRANSCRIPT_MS));
        }
        this.release();
        if (graceful) this.handlers.onStatus('idle');
    }

    private release() {
        this.stream?.getTracks().forEach(t => t.stop());
        this.stream = null;
        this.sessionPromise?.then(s => s.close()).catch(() => {});
        this.sessionPromise = null;
        try { void this.context?.close(); } catch { /* already closed */ }
        this.context = null;
    }
}

// Only one field dictates at a time
let active: DictationSession | null = null;

export const startDictation = (handlers: DictationHandlers): DictationSession => {
    void active?.stop();
    const session = new DictationSession(handlers);
    active = session;
    void session.start();
    return session;
};

export type { DictationSession };
