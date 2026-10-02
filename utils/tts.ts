import { generateSpeechFromText } from '../services/geminiService';
import { decode, decodeAudioData } from './audio';
import { withTimeout } from './timeout';

// Text-to-speech player shared by every "Read Aloud" button.
//
// Long text is split into short pieces (about a sentence). The first piece is
// sent to Gemini TTS right away so audio starts within seconds, and the next
// piece is fetched while the current one plays. If Gemini fails, the phone's
// built-in voice reads the rest — one piece at a time, so nothing is left
// queued in Android's speech engine if the app is closed.
//
// Pause / resume: pausing remembers the current piece; resuming continues
// from the start of that piece (audio already fetched is reused). Leaving the
// app (home screen, app switcher, lock) pauses. Only one player speaks at a time.

export type TtsStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

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

const stopBrowserSpeech = () => {
    try { window.speechSynthesis?.cancel(); } catch { /* unsupported */ }
};

if (typeof document !== 'undefined') {
    // Leaving the app pauses reading (resume from the same place on return)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') activePlayer?.pause();
    });
    // Closing / swiping the app away: make sure the phone's speech engine stops
    window.addEventListener('pagehide', () => {
        activePlayer?.pause();
        stopBrowserSpeech();
    });
}

export class TextToSpeechPlayer {
    private ctx: AudioContext | null = null;
    private source: AudioBufferSourceNode | null = null;
    private startTimer: ReturnType<typeof setTimeout> | null = null;
    private runId = 0;

    // What's being read and where we are, for pause / resume
    private text = '';
    private pieces: string[] = [];
    private position = 0;
    private useBrowserVoice = false;
    private audioCache = new Map<number, Promise<string | null>>();
    private status: TtsStatus = 'idle';

    constructor(private onStatusChange: (status: TtsStatus, error?: string) => void) {}

    private setStatus(status: TtsStatus, error?: string) {
        this.status = status;
        this.onStatusChange(status, error);
    }

    /** Read `text` from the beginning, or resume it if it's paused. Call from a tap. */
    async play(text: string): Promise<void> {
        const clipped = (text || '').trim().slice(0, MAX_CHARS);
        if (!clipped) {
            this.setStatus('error', 'Nothing to read.');
            return;
        }
        const resuming = this.status === 'paused' && clipped === this.text;
        if (!resuming) {
            this.text = clipped;
            this.pieces = splitForSpeech(clipped);
            this.position = 0;
            this.useBrowserVoice = false;
            this.audioCache.clear();
        }
        await this.start();
    }

    private async start(): Promise<void> {
        if (activePlayer && activePlayer !== this) activePlayer.pause();
        activePlayer = this;
        this.halt();
        const run = ++this.runId;
        this.setStatus('loading');
        const deadline = Date.now() + TTS_START_TIMEOUT_MS;

        if (!this.useBrowserVoice) {
            // Create / resume the AudioContext synchronously inside the tap —
            // mobile browsers keep it suspended (silent) otherwise.
            try {
                const Ctx = window.AudioContext || (window as any).webkitAudioContext;
                this.ctx = Ctx ? new Ctx({ sampleRate: 24000 }) : null;
                void this.ctx?.resume();
            } catch {
                this.ctx = null;
            }
        }

        if (this.ctx && !this.useBrowserVoice) {
            let first = true;
            while (this.position < this.pieces.length) {
                const i = this.position;
                const b64 = await this.fetchPiece(i);
                if (run !== this.runId) return;
                if (!b64) {
                    // Gemini failed: the phone's voice reads from here on
                    this.useBrowserVoice = true;
                    this.releaseAudio();
                    this.speakWithBrowser(run, first ? Math.max(0, deadline - Date.now()) : TTS_START_TIMEOUT_MS);
                    return;
                }
                // Fetch the next piece while this one plays
                if (i + 1 < this.pieces.length) void this.fetchPiece(i + 1);
                const played = await this.playBase64(b64, run);
                if (run !== this.runId) return;
                if (!played) {
                    this.useBrowserVoice = true;
                    this.releaseAudio();
                    this.speakWithBrowser(run, Math.max(10_000, deadline - Date.now()));
                    return;
                }
                first = false;
                this.position = i + 1;
            }
            this.finish(run);
            return;
        }

        this.useBrowserVoice = true;
        this.speakWithBrowser(run, Math.max(0, deadline - Date.now()));
    }

    private fetchPiece(i: number): Promise<string | null> {
        let p = this.audioCache.get(i);
        if (!p) {
            p = withTimeout(generateSpeechFromText(this.pieces[i]), GEMINI_PIECE_TIMEOUT_MS).catch(() => null);
            // Don't keep failures, so a later resume can retry
            p.then(v => { if (!v) this.audioCache.delete(i); });
            this.audioCache.set(i, p);
        }
        return p;
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
                if (run === this.runId) this.setStatus('playing');
            });
        } catch (e) {
            console.warn('Playing Gemini audio failed', e);
            return false;
        }
    }

    /**
     * Browser voice, one ~sentence at a time (the next piece is only handed to
     * the speech engine when the previous one ends).
     */
    private speakWithBrowser(run: number, timeLeftMs: number) {
        const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
        if (!synth || typeof SpeechSynthesisUtterance === 'undefined' || timeLeftMs <= 0) {
            this.fail(run);
            return;
        }
        stopBrowserSpeech();

        // Re-split what's left into short utterances
        const remaining = this.pieces.slice(this.position).join(' ');
        const browserPieces = splitForSpeech(remaining, BROWSER_PIECE_CHARS, BROWSER_PIECE_CHARS);
        // Map browser pieces back to positions in `this.pieces` for pause/resume
        const startPosition = this.position;
        let consumed = 0;
        const pieceEnds: number[] = [];
        this.pieces.slice(startPosition).forEach(p => { consumed += p.length + 1; pieceEnds.push(consumed); });

        const lang = hasHebrew(remaining) ? 'he-IL' : 'en-US';
        let started = false;
        let spokenChars = 0;

        const speakNext = (index: number) => {
            if (run !== this.runId) return;
            if (index >= browserPieces.length) { this.finish(run); return; }
            const utterance = new SpeechSynthesisUtterance(browserPieces[index]);
            utterance.lang = lang;
            utterance.onstart = () => {
                // A stale utterance that started late (after Pause / Stop): silence it
                if (run !== this.runId) { stopBrowserSpeech(); return; }
                if (!started) {
                    started = true;
                    this.clearStartTimer();
                    this.setStatus('playing');
                }
            };
            utterance.onend = () => {
                if (run !== this.runId) return;
                spokenChars += browserPieces[index].length + 1;
                // Advance the resume point past every piece fully spoken
                let pos = startPosition;
                for (let k = 0; k < pieceEnds.length && pieceEnds[k] <= spokenChars; k++) pos = startPosition + k + 1;
                this.position = pos;
                speakNext(index + 1);
            };
            utterance.onerror = (e) => {
                if (run !== this.runId) return;
                if (e.error === 'interrupted' || e.error === 'canceled') return;
                this.fail(run);
            };
            synth.speak(utterance);
        };

        this.startTimer = setTimeout(() => {
            if (run !== this.runId || started) return;
            this.fail(run);
        }, timeLeftMs);
        speakNext(0);
    }

    private finish(run: number) {
        if (run !== this.runId) return;
        this.reset();
        this.setStatus('idle');
    }

    private fail(run: number) {
        if (run !== this.runId) return;
        this.reset();
        this.setStatus('error', TTS_ERROR_MESSAGE);
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
        // still being decoded
        try { void this.ctx?.close(); } catch { /* already closed */ }
        this.ctx = null;
    }

    /** Silence everything without changing the reading position. */
    private halt() {
        this.runId++;
        this.clearStartTimer();
        this.releaseAudio();
        stopBrowserSpeech();
    }

    private reset() {
        this.halt();
        this.position = 0;
        this.useBrowserVoice = false;
        if (activePlayer === this) activePlayer = null;
    }

    /** Pause; play() with the same text resumes from the current sentence. */
    pause(): void {
        if (this.status !== 'playing' && this.status !== 'loading') return;
        this.halt();
        if (activePlayer === this) activePlayer = null;
        this.setStatus('paused');
    }

    /** Stop and forget the position (next play starts from the beginning). */
    stop(notify = true): void {
        this.reset();
        this.text = '';
        this.audioCache.clear();
        if (notify) this.setStatus('idle');
        else this.status = 'idle';
    }

    dispose(): void {
        this.stop(false);
    }
}
