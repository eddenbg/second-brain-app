import { generateSpeechFromText } from '../services/geminiService';
import { decode, decodeAudioData } from './audio';
import { withTimeout } from './timeout';

// Text-to-speech player shared by every "Read Aloud" button.
// Tries Gemini TTS first; if that fails or is slow, falls back to the
// browser's built-in voice. If nothing has started playing within 30s the
// player gives up with a visible error instead of spinning forever.

export type TtsStatus = 'idle' | 'loading' | 'playing' | 'error';

export const TTS_START_TIMEOUT_MS = 30_000;
// Leave part of the 30s budget for the browser-voice fallback
const GEMINI_TTS_TIMEOUT_MS = 20_000;
export const TTS_ERROR_MESSAGE = 'Could not start audio. Try again.';

const MAX_CHARS = 5000;
const hasHebrew = (text: string) => /[֐-׿]/.test(text);

export class TextToSpeechPlayer {
    private ctx: AudioContext | null = null;
    private source: AudioBufferSourceNode | null = null;
    private startTimer: ReturnType<typeof setTimeout> | null = null;
    private runId = 0;

    constructor(private onStatus: (status: TtsStatus, error?: string) => void) {}

    /** Must be called from a user gesture (tap) so audio is allowed to start. */
    async play(text: string): Promise<void> {
        this.stop(false);
        const run = ++this.runId;
        const clipped = (text || '').trim().slice(0, MAX_CHARS);
        if (!clipped) {
            this.onStatus('error', 'Nothing to read.');
            return;
        }
        this.onStatus('loading');
        const deadline = Date.now() + TTS_START_TIMEOUT_MS;

        // Create / resume the AudioContext synchronously inside the tap —
        // mobile browsers keep it suspended (silent) otherwise.
        try {
            if (!this.ctx || this.ctx.state === 'closed') {
                const Ctx = window.AudioContext || (window as any).webkitAudioContext;
                this.ctx = Ctx ? new Ctx({ sampleRate: 24000 }) : null;
            }
            void this.ctx?.resume();
        } catch {
            this.ctx = null;
        }

        // 1. Gemini TTS
        if (this.ctx) {
            try {
                const b64 = await withTimeout(generateSpeechFromText(clipped), GEMINI_TTS_TIMEOUT_MS);
                if (run !== this.runId) return;
                if (b64) {
                    const ctx = this.ctx;
                    if (ctx.state === 'suspended') await withTimeout(ctx.resume(), 3000).catch(() => {});
                    const buffer = await decodeAudioData(decode(b64), ctx, 24000, 1);
                    if (run !== this.runId) return;
                    if (ctx.state === 'running') {
                        const src = ctx.createBufferSource();
                        src.buffer = buffer;
                        src.connect(ctx.destination);
                        src.onended = () => {
                            if (run === this.runId) {
                                this.source = null;
                                this.onStatus('idle');
                            }
                        };
                        src.start(0);
                        this.source = src;
                        this.onStatus('playing');
                        return;
                    }
                }
            } catch (e) {
                if (run !== this.runId) return;
                console.warn('Gemini TTS failed, falling back to browser voice', e);
            }
        }

        // 2. Browser speech synthesis fallback
        this.speakWithBrowser(clipped, run, Math.max(0, deadline - Date.now()));
    }

    private speakWithBrowser(text: string, run: number, timeLeftMs: number) {
        const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
        if (!synth || typeof SpeechSynthesisUtterance === 'undefined' || timeLeftMs <= 0) {
            this.onStatus('error', TTS_ERROR_MESSAGE);
            return;
        }
        // Clear anything queued or stuck from a previous utterance
        synth.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = hasHebrew(text) ? 'he-IL' : 'en-US';
        utterance.onstart = () => {
            if (run !== this.runId) return;
            this.clearStartTimer();
            this.onStatus('playing');
        };
        utterance.onend = () => {
            if (run !== this.runId) return;
            this.clearStartTimer();
            this.onStatus('idle');
        };
        utterance.onerror = (e) => {
            if (run !== this.runId) return;
            this.clearStartTimer();
            if (e.error === 'interrupted' || e.error === 'canceled') return;
            this.onStatus('error', TTS_ERROR_MESSAGE);
        };

        this.startTimer = setTimeout(() => {
            if (run !== this.runId) return;
            synth.cancel();
            this.runId++;
            this.onStatus('error', TTS_ERROR_MESSAGE);
        }, timeLeftMs);

        synth.speak(utterance);
    }

    private clearStartTimer() {
        if (this.startTimer) {
            clearTimeout(this.startTimer);
            this.startTimer = null;
        }
    }

    /** Stop any playback or pending request. */
    stop(notify = true): void {
        this.runId++;
        this.clearStartTimer();
        try { this.source?.stop(); } catch { /* already stopped */ }
        this.source = null;
        try { window.speechSynthesis?.cancel(); } catch { /* unsupported */ }
        if (notify) this.onStatus('idle');
    }

    dispose(): void {
        this.stop(false);
        try { void this.ctx?.close(); } catch { /* already closed */ }
        this.ctx = null;
    }
}
