import { generateSpeechFromText } from '../services/geminiService';
import { decode, decodeAudioData } from './audio';
import { withTimeout } from './timeout';

// Text-to-speech player shared by every "Read Aloud" button.
//
// Long text is split into short pieces: the first piece is sent to Gemini TTS
// right away (so audio starts within seconds), and the next piece is fetched
// while the current one plays. If Gemini fails, the browser's built-in voice
// reads the rest. Only one player can speak at a time, and speech stops when
// the app is hidden, the screen is left, or Stop is tapped.

export type TtsStatus = 'idle' | 'loading' | 'playing' | 'error';

export const TTS_START_TIMEOUT_MS = 30_000;
// Per-piece limit for Gemini; leaves time for the browser-voice fallback
const GEMINI_PIECE_TIMEOUT_MS = 20_000;
export const TTS_ERROR_MESSAGE = 'Could not start audio. Try again.';

const MAX_CHARS = 30_000;
const FIRST_PIECE_CHARS = 220;   // small, so the first audio arrives fast
const PIECE_CHARS = 600;
const BROWSER_PIECE_CHARS = 220; // Chrome cuts off long utterances

const hasHebrew = (text: string) => /[֐-׿]/.test(text);

/** Split text into pieces at line/sentence boundaries. */
export const splitForSpeech = (text: string, firstMax = FIRST_PIECE_CHARS, max = PIECE_CHARS): string[] => {
    const sentences = text
        .replace(/\r/g, '')
        .split(/(?<=[.!?…:;])\s+|\n+/)
        .map(s => s.trim())
        .filter(Boolean);
    const pieces: string[] = [];
    let current = '';
    for (const sentence of sentences) {
        const limit = pieces.length === 0 ? firstMax : max;
        if (current && (current.length + sentence.length + 1) > limit) {
            pieces.push(current);
            current = '';
        }
        if (sentence.length > limit) {
            // Very long sentence: break on spaces
            let rest = sentence;
            while (rest.length > limit) {
                let cut = rest.lastIndexOf(' ', limit);
                if (cut < limit / 2) cut = limit;
                pieces.push(rest.slice(0, cut).trim());
                rest = rest.slice(cut).trim();
            }
            current = rest;
        } else {
            current = current ? `${current} ${sentence}` : sentence;
        }
    }
    if (current) pieces.push(current);
    return pieces;
};

// Only one player speaks at a time
let activePlayer: TextToSpeechPlayer | null = null;

if (typeof document !== 'undefined') {
    // Leaving the app (home screen, switching apps, locking) stops reading
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') activePlayer?.stop();
    });
}

export class TextToSpeechPlayer {
    private ctx: AudioContext | null = null;
    private source: AudioBufferSourceNode | null = null;
    private startTimer: ReturnType<typeof setTimeout> | null = null;
    private runId = 0;

    constructor(private onStatus: (status: TtsStatus, error?: string) => void) {}

    /** Must be called from a user gesture (tap) so audio is allowed to start. */
    async play(text: string): Promise<void> {
        if (activePlayer && activePlayer !== this) activePlayer.stop();
        activePlayer = this;
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
            const Ctx = window.AudioContext || (window as any).webkitAudioContext;
            this.ctx = Ctx ? new Ctx({ sampleRate: 24000 }) : null;
            void this.ctx?.resume();
        } catch {
            this.ctx = null;
        }

        const pieces = splitForSpeech(clipped);
        const fetchPiece = (i: number) =>
            withTimeout(generateSpeechFromText(pieces[i]), GEMINI_PIECE_TIMEOUT_MS).catch(() => null);

        if (this.ctx) {
            let next: Promise<string | null> = fetchPiece(0);
            for (let i = 0; i < pieces.length; i++) {
                const b64 = await next;
                if (run !== this.runId) return;
                if (!b64) {
                    // Gemini failed: the browser voice reads what's left
                    const remaining = pieces.slice(i).join(' ');
                    const timeLeft = i === 0 ? Math.max(0, deadline - Date.now()) : TTS_START_TIMEOUT_MS;
                    this.speakWithBrowser(remaining, run, timeLeft, i > 0);
                    return;
                }
                // Fetch the next piece while this one plays
                if (i + 1 < pieces.length) next = fetchPiece(i + 1);
                const played = await this.playBase64(b64, run);
                if (run !== this.runId) return;
                if (!played) {
                    this.speakWithBrowser(pieces.slice(i).join(' '), run, Math.max(10_000, deadline - Date.now()), i > 0);
                    return;
                }
            }
            if (run === this.runId) this.finish();
            return;
        }

        this.speakWithBrowser(clipped, run, Math.max(0, deadline - Date.now()), false);
    }

    /** Play one piece of Gemini audio; resolves when it ends or is stopped. */
    private async playBase64(b64: string, run: number): Promise<boolean> {
        const ctx = this.ctx;
        if (!ctx) return false;
        try {
            if (ctx.state === 'suspended') await withTimeout(ctx.resume(), 3000).catch(() => {});
            if (ctx.state !== 'running') return false;
            const buffer = await decodeAudioData(decode(b64), ctx, 24000, 1);
            if (run !== this.runId) return true;
            return await new Promise<boolean>((resolve) => {
                const src = ctx.createBufferSource();
                src.buffer = buffer;
                src.connect(ctx.destination);
                src.onended = () => resolve(true);
                this.source = src;
                src.start(0);
                if (run === this.runId) this.onStatus('playing');
            });
        } catch (e) {
            console.warn('Playing Gemini audio failed', e);
            return false;
        }
    }

    private speakWithBrowser(text: string, run: number, timeLeftMs: number, alreadyPlaying: boolean) {
        const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
        if (!synth || typeof SpeechSynthesisUtterance === 'undefined' || timeLeftMs <= 0) {
            this.fail(run);
            return;
        }
        // Clear anything queued or stuck from earlier
        synth.cancel();

        const pieces = splitForSpeech(text, BROWSER_PIECE_CHARS, BROWSER_PIECE_CHARS);
        const lang = hasHebrew(text) ? 'he-IL' : 'en-US';
        let started = alreadyPlaying;

        pieces.forEach((piece, index) => {
            const utterance = new SpeechSynthesisUtterance(piece);
            utterance.lang = lang;
            utterance.onstart = () => {
                // A stale utterance that started late (after Stop / leaving): silence it
                if (run !== this.runId) { synth.cancel(); return; }
                if (!started) {
                    started = true;
                    this.clearStartTimer();
                    this.onStatus('playing');
                }
            };
            utterance.onend = () => {
                if (run !== this.runId) return;
                if (index === pieces.length - 1) this.finish();
            };
            utterance.onerror = (e) => {
                if (run !== this.runId) return;
                if (e.error === 'interrupted' || e.error === 'canceled') return;
                this.fail(run);
            };
            synth.speak(utterance);
        });

        if (!started) {
            this.startTimer = setTimeout(() => {
                if (run !== this.runId || started) return;
                this.fail(run);
            }, timeLeftMs);
        }
    }

    private finish() {
        this.runId++;
        this.clearStartTimer();
        this.releaseAudio();
        if (activePlayer === this) activePlayer = null;
        this.onStatus('idle');
    }

    private fail(run: number) {
        if (run !== this.runId) return;
        this.stop(false);
        this.onStatus('error', TTS_ERROR_MESSAGE);
    }

    private clearStartTimer() {
        if (this.startTimer) {
            clearTimeout(this.startTimer);
            this.startTimer = null;
        }
    }

    private releaseAudio() {
        try { this.source?.stop(); } catch { /* already stopped */ }
        this.source = null;
        // Closing the context guarantees silence, even for audio that was
        // still being decoded when Stop was tapped
        try { void this.ctx?.close(); } catch { /* already closed */ }
        this.ctx = null;
    }

    /** Stop any playback or pending request. */
    stop(notify = true): void {
        this.runId++;
        this.clearStartTimer();
        this.releaseAudio();
        try { window.speechSynthesis?.cancel(); } catch { /* unsupported */ }
        if (activePlayer === this) activePlayer = null;
        if (notify) this.onStatus('idle');
    }

    dispose(): void {
        this.stop(false);
    }
}
