import { generateSpeechFromText } from '../services/geminiService';
import { decode } from './audio';
import { withTimeout } from './timeout';
import { getTtsSettings, phoneVoiceFor, TTS_SETTINGS_EVENT } from './ttsSettings';

// Text-to-speech player shared by every "Read Aloud" button.
//
// Two engines, chosen in Settings → Read Aloud (utils/ttsSettings.ts):
// - AI voice: Google Gemini TTS (gemini-2.5-flash-preview-tts), the voice
//   picked in Settings. Long text is split into short pieces; the first is
//   sent right away so audio starts within seconds, the next ones are fetched
//   while the current one plays. Played through an <audio> element so the
//   speed can change without changing the pitch.
// - Phone voice: the phone's own text-to-speech (Android: Google / Samsung
//   TTS), one ~sentence at a time so nothing is left queued if the app closes.
// If an AI piece fails twice, the phone voice reads the rest of this text (and
// the button says so) — it doesn't flip back and forth on Pause / Resume.
//
// Pause / resume: pausing remembers the current piece; resuming continues
// from the start of that piece (audio already fetched is reused). Leaving the
// app (home screen, app switcher, lock) pauses. Only one player speaks at a time.

export type TtsStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export const TTS_START_TIMEOUT_MS = 30_000;
// Per-attempt limit for one Gemini piece (each piece gets two attempts)
const GEMINI_PIECE_TIMEOUT_MS = 25_000;
// How many pieces to fetch ahead of the one playing (more at high speeds)
const PREFETCH_AHEAD = 2;
export const FELL_BACK_NOTICE = 'The AI voice didn’t answer, so the phone voice is reading. Start Over to try the AI voice again.';
export const TTS_ERROR_MESSAGE = 'Could not start audio. Try again.';

// Whole lecture PDFs: pieces are fetched one at a time, so length isn't a problem
const MAX_CHARS = 500_000;
const FIRST_PIECE_CHARS = 220;   // small, so the first audio arrives fast
const PIECE_CHARS = 900;  // fewer, longer requests after the first
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

const SAMPLE_RATE = 24000;

/** Wrap Gemini's raw 16-bit mono PCM in a WAV header so <audio> can play it. */
const pcmToWavBlob = (pcm: Uint8Array): Blob => {
    const header = new ArrayBuffer(44);
    const v = new DataView(header);
    const writeStr = (o: number, str: string) => { for (let k = 0; k < str.length; k++) v.setUint8(o + k, str.charCodeAt(k)); };
    writeStr(0, 'RIFF');
    v.setUint32(4, 36 + pcm.byteLength, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);              // PCM
    v.setUint16(22, 1, true);              // mono
    v.setUint32(24, SAMPLE_RATE, true);
    v.setUint32(28, SAMPLE_RATE * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    writeStr(36, 'data');
    v.setUint32(40, pcm.byteLength, true);
    return new Blob([header, pcm as BlobPart], { type: 'audio/wav' });
};

let silentUrl: string | null = null;
const getSilentUrl = () => {
    if (!silentUrl) silentUrl = URL.createObjectURL(pcmToWavBlob(new Uint8Array(4800)));
    return silentUrl;
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
    private audio: HTMLAudioElement | null = null;
    private audioUrl: string | null = null;
    private startTimer: ReturnType<typeof setTimeout> | null = null;
    private runId = 0;

    // What's being read and where we are, for pause / resume
    private text = '';
    private pieces: string[] = [];
    private position = 0;
    private useBrowserVoice = false;
    // The AI voice failed for this text: keep the phone voice until Start Over
    private fellBack = false;
    private audioCache = new Map<string, Promise<string | null>>();
    private status: TtsStatus = 'idle';

    constructor(private onStatusChange: (status: TtsStatus, error?: string, notice?: string) => void) {
        if (typeof window !== 'undefined') window.addEventListener(TTS_SETTINGS_EVENT, this.onSettingsChanged);
    }

    private setStatus(status: TtsStatus, error?: string) {
        this.status = status;
        this.onStatusChange(status, error, this.fellBack ? FELL_BACK_NOTICE : undefined);
    }

    // Speed changes apply right away to the AI voice (the phone voice picks
    // them up from the next sentence)
    private onSettingsChanged = () => {
        if (this.audio) {
            const { rate } = getTtsSettings();
            this.audio.defaultPlaybackRate = rate;
            this.audio.playbackRate = rate;
        }
    };

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
            this.fellBack = false;
            this.audioCache.clear();
        }
        this.useBrowserVoice = this.fellBack || getTtsSettings().engine === 'phone';
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
            // Start the <audio> element inside the tap (silently) — mobile
            // browsers only allow sound that starts from a tap.
            try {
                this.audio = new Audio();
                this.audio.src = getSilentUrl();
                void this.audio.play().catch(() => {});
            } catch {
                this.audio = null;
            }
        }

        if (this.audio && !this.useBrowserVoice) {
            let first = true;
            while (this.position < this.pieces.length) {
                const i = this.position;
                let b64 = await this.fetchPiece(i);
                if (run !== this.runId) return;
                // One retry (a fresh request) before giving up on the AI voice
                if (!b64 && (!first || Date.now() < deadline - 5000)) b64 = await this.fetchPiece(i);
                if (run !== this.runId) return;
                if (!b64) {
                    this.switchToPhoneVoice(run, first ? Math.max(5000, deadline - Date.now()) : TTS_START_TIMEOUT_MS);
                    return;
                }
                // Fetch the next pieces while this one plays
                for (let k = 1; k <= PREFETCH_AHEAD && i + k < this.pieces.length; k++) void this.fetchPiece(i + k);
                const played = await this.playBase64(b64, run);
                if (run !== this.runId) return;
                if (!played) {
                    this.switchToPhoneVoice(run, Math.max(10_000, deadline - Date.now()));
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

    private switchToPhoneVoice(run: number, timeLeftMs: number) {
        this.useBrowserVoice = true;
        this.fellBack = true;
        this.releaseAudio();
        this.speakWithBrowser(run, timeLeftMs);
    }

    private fetchPiece(i: number): Promise<string | null> {
        const voice = getTtsSettings().aiVoice;
        const key = `${voice}:${i}`;
        let p = this.audioCache.get(key);
        if (!p) {
            p = withTimeout(generateSpeechFromText(this.pieces[i], voice), GEMINI_PIECE_TIMEOUT_MS).catch(() => null);
            // Don't keep failures, so a retry / later resume asks again
            p.then(v => { if (!v) this.audioCache.delete(key); });
            this.audioCache.set(key, p);
        }
        return p;
    }

    /** Play one piece of Gemini audio; resolves when it ends or is stopped. */
    private async playBase64(b64: string, run: number): Promise<boolean> {
        const audio = this.audio;
        if (!audio) return false;
        try {
            if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
            this.audioUrl = URL.createObjectURL(pcmToWavBlob(decode(b64)));
            audio.src = this.audioUrl;
            audio.defaultPlaybackRate = getTtsSettings().rate;
            audio.playbackRate = getTtsSettings().rate;
            (audio as any).preservesPitch = true;
            return await new Promise<boolean>((resolve) => {
                audio.onended = () => resolve(true);
                audio.onerror = () => resolve(false);
                // Stopped by Pause / Stop: halt() resolves through onpause
                audio.onpause = () => { if (run !== this.runId) resolve(true); };
                audio.play().then(() => {
                    if (run === this.runId) this.setStatus('playing');
                }).catch((e) => {
                    if (run !== this.runId) { resolve(true); return; }
                    console.warn('Playing Gemini audio failed', e);
                    resolve(false);
                });
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
            utterance.rate = getTtsSettings().rate;
            const voice = phoneVoiceFor(lang);
            if (voice) utterance.voice = voice;
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
        const audio = this.audio;
        this.audio = null;
        if (audio) {
            try {
                audio.pause();
                audio.removeAttribute('src');
                audio.load();
            } catch { /* already stopped */ }
        }
        if (this.audioUrl) {
            URL.revokeObjectURL(this.audioUrl);
            this.audioUrl = null;
        }
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
        this.fellBack = false;
        this.audioCache.clear();
        if (notify) this.setStatus('idle');
        else this.status = 'idle';
    }

    dispose(): void {
        this.stop(false);
        if (typeof window !== 'undefined') window.removeEventListener(TTS_SETTINGS_EVENT, this.onSettingsChanged);
    }
}
