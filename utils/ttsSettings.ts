import { safeSetItem } from './safeStorage';

// Read Aloud preferences (kept on this device).
// - engine: 'ai' = Google Gemini's natural voices (needs internet),
//           'phone' = the phone's own text-to-speech voices (works offline).
// - aiVoice: which Gemini voice reads.
// - rate: reading speed for both engines (1 = normal).
// - phoneVoiceHe / phoneVoiceEn: chosen phone voice per language (voiceURI).

export type TtsEngine = 'ai' | 'phone';

export interface TtsSettings {
    engine: TtsEngine;
    aiVoice: string;
    rate: number;
    phoneVoiceHe?: string;
    phoneVoiceEn?: string;
}

export const AI_VOICES: { name: string; description: string }[] = [
    { name: 'Kore', description: 'Female · firm, clear' },
    { name: 'Aoede', description: 'Female · light, relaxed' },
    { name: 'Leda', description: 'Female · young' },
    { name: 'Zephyr', description: 'Female · bright' },
    { name: 'Sulafat', description: 'Female · warm' },
    { name: 'Charon', description: 'Male · calm, informative' },
    { name: 'Orus', description: 'Male · firm' },
    { name: 'Puck', description: 'Male · upbeat' },
    { name: 'Fenrir', description: 'Male · lively' },
    { name: 'Iapetus', description: 'Male · clear' },
];

export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
export const MIN_RATE = 0.5;
export const MAX_RATE = 2.5;

const KEY = 'sb-tts-settings';
export const TTS_SETTINGS_EVENT = 'sb-tts-settings-changed';

const DEFAULTS: TtsSettings = { engine: 'ai', aiVoice: 'Kore', rate: 1 };

let cached: TtsSettings | null = null;

export const getTtsSettings = (): TtsSettings => {
    if (cached) return cached;
    let stored: Partial<TtsSettings> = {};
    try { stored = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { /* unavailable */ }
    const rate = Number(stored.rate);
    cached = {
        ...DEFAULTS,
        ...stored,
        engine: stored.engine === 'phone' ? 'phone' : 'ai',
        aiVoice: AI_VOICES.some(v => v.name === stored.aiVoice) ? stored.aiVoice! : DEFAULTS.aiVoice,
        rate: rate >= MIN_RATE && rate <= MAX_RATE ? rate : 1,
    };
    return cached;
};

export const updateTtsSettings = (changes: Partial<TtsSettings>): TtsSettings => {
    cached = { ...getTtsSettings(), ...changes };
    safeSetItem(KEY, JSON.stringify(cached));
    window.dispatchEvent(new CustomEvent(TTS_SETTINGS_EVENT, { detail: cached }));
    return cached;
};

export const formatRate = (rate: number) => `${Number(rate.toFixed(2))}×`;

/** Phone voices for Hebrew / English (they load asynchronously on Android). */
export const getPhoneVoices = (): Promise<SpeechSynthesisVoice[]> =>
    new Promise(resolve => {
        const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
        if (!synth) { resolve([]); return; }
        const pick = () => synth.getVoices().filter(v => /^(he|iw|en)/i.test(v.lang));
        const now = pick();
        if (now.length) { resolve(now); return; }
        const done = () => { synth.removeEventListener?.('voiceschanged', done); resolve(pick()); };
        synth.addEventListener?.('voiceschanged', done);
        setTimeout(done, 2000);
    });

/** The chosen phone voice for this language, if it's installed. */
export const phoneVoiceFor = (lang: 'he-IL' | 'en-US'): SpeechSynthesisVoice | null => {
    const s = getTtsSettings();
    const uri = lang === 'he-IL' ? s.phoneVoiceHe : s.phoneVoiceEn;
    if (!uri) return null;
    try {
        return window.speechSynthesis?.getVoices().find(v => v.voiceURI === uri) || null;
    } catch {
        return null;
    }
};
