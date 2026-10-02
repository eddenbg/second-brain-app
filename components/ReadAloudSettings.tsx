import React, { useEffect, useState } from 'react';
import { Volume2, Square, Smartphone, Sparkles } from 'lucide-react';
import {
    AI_VOICES, SPEEDS, MIN_RATE, MAX_RATE, TTS_SETTINGS_EVENT,
    getTtsSettings, updateTtsSettings, getPhoneVoices, formatRate, TtsSettings,
} from '../utils/ttsSettings';
import { useTextToSpeech } from '../hooks/useTextToSpeech';

/** Current Read Aloud settings, updated when they change anywhere in the app. */
export const useTtsSettings = (): TtsSettings => {
    const [settings, setSettings] = useState(getTtsSettings);
    useEffect(() => {
        const onChange = () => setSettings(getTtsSettings());
        window.addEventListener(TTS_SETTINGS_EVENT, onChange);
        return () => window.removeEventListener(TTS_SETTINGS_EVENT, onChange);
    }, []);
    return settings;
};

const SAMPLE = 'Hello! This is how this voice sounds. שלום, כך נשמע הקול הזה.';

// Read Aloud: which engine, which voice, how fast. Used in Settings and from
// the "Voice" button next to every Read Aloud button.
const ReadAloudSettings: React.FC = () => {
    const settings = useTtsSettings();
    const preview = useTextToSpeech();
    const [phoneVoices, setPhoneVoices] = useState<SpeechSynthesisVoice[]>([]);

    useEffect(() => { void getPhoneVoices().then(setPhoneVoices); }, []);

    const heVoices = phoneVoices.filter(v => /^(he|iw)/i.test(v.lang));
    const enVoices = phoneVoices.filter(v => /^en/i.test(v.lang));
    const previewing = preview.status === 'playing' || preview.status === 'loading';

    const tryVoice = (changes: Parameters<typeof updateTtsSettings>[0]) => {
        updateTtsSettings(changes);
        preview.stop();
        preview.play(SAMPLE);
    };

    const engineButton = (engine: 'ai' | 'phone', label: string, hint: string, Icon: typeof Sparkles) => (
        <button
            type="button"
            onClick={() => updateTtsSettings({ engine })}
            aria-pressed={settings.engine === engine}
            className={`flex-1 p-3 rounded-2xl border-2 text-left ${settings.engine === engine ? 'bg-white text-[#001F3F] border-white' : 'bg-transparent text-white border-white/30'}`}
            style={{ minHeight: 'unset' }}
        >
            <span className="flex items-center gap-2 font-black uppercase text-sm"><Icon className="w-5 h-5" />{label}</span>
            <span className="block text-xs font-bold opacity-70 mt-1">{hint}</span>
        </button>
    );

    const voiceSelect = (label: string, voices: SpeechSynthesisVoice[], value: string | undefined, key: 'phoneVoiceHe' | 'phoneVoiceEn') => (
        <label className="block space-y-1">
            <span className="text-white/70 text-xs font-black uppercase tracking-widest">{label}</span>
            <select
                value={value || ''}
                onChange={e => tryVoice({ [key]: e.target.value || undefined, engine: 'phone' })}
                className="w-full p-3 rounded-xl bg-gray-900 text-white border-2 border-white/20 font-bold"
            >
                <option value="">Phone default</option>
                {voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}
            </select>
        </label>
    );

    return (
        <div className="space-y-5 text-white">
            {/* Speed */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <span className="text-white/70 text-xs font-black uppercase tracking-widest">Speed</span>
                    <span className="font-black text-lg">{formatRate(settings.rate)}</span>
                </div>
                <input
                    type="range"
                    min={MIN_RATE}
                    max={MAX_RATE}
                    step={0.05}
                    value={settings.rate}
                    onChange={e => updateTtsSettings({ rate: Number(e.target.value) })}
                    aria-label="Reading speed"
                    className="w-full accent-white"
                />
                <div className="flex flex-wrap gap-2">
                    {SPEEDS.map(r => (
                        <button
                            key={r}
                            type="button"
                            onClick={() => updateTtsSettings({ rate: r })}
                            aria-pressed={Math.abs(settings.rate - r) < 0.01}
                            className={`px-3 py-2 rounded-xl text-sm font-black border-2 ${Math.abs(settings.rate - r) < 0.01 ? 'bg-white text-[#001F3F] border-white' : 'border-white/30'}`}
                            style={{ minHeight: 'unset' }}
                        >
                            {formatRate(r)}
                        </button>
                    ))}
                </div>
            </div>

            {/* Engine */}
            <div className="space-y-2">
                <span className="text-white/70 text-xs font-black uppercase tracking-widest">Voice type</span>
                <div className="flex gap-2">
                    {engineButton('ai', 'AI voice', 'Most natural. Needs internet.', Sparkles)}
                    {engineButton('phone', 'Phone voice', 'Starts instantly, works offline.', Smartphone)}
                </div>
            </div>

            {settings.engine === 'ai' ? (
                <div className="space-y-2">
                    <span className="text-white/70 text-xs font-black uppercase tracking-widest">AI voice — tap to hear it</span>
                    <div className="grid grid-cols-2 gap-2">
                        {AI_VOICES.map(v => (
                            <button
                                key={v.name}
                                type="button"
                                onClick={() => tryVoice({ aiVoice: v.name, engine: 'ai' })}
                                aria-pressed={settings.aiVoice === v.name}
                                className={`p-3 rounded-xl border-2 text-left ${settings.aiVoice === v.name ? 'bg-white text-[#001F3F] border-white' : 'border-white/30'}`}
                                style={{ minHeight: 'unset' }}
                            >
                                <span className="block font-black">{v.name}</span>
                                <span className="block text-xs font-bold opacity-70">{v.description}</span>
                            </button>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    {voiceSelect('Hebrew voice', heVoices, settings.phoneVoiceHe, 'phoneVoiceHe')}
                    {voiceSelect('English voice', enVoices, settings.phoneVoiceEn, 'phoneVoiceEn')}
                    <p className="text-white/50 text-xs font-bold leading-relaxed">
                        More phone voices: Android Settings → General management → Text-to-speech (or Accessibility → Text-to-speech).
                    </p>
                </div>
            )}

            <button
                type="button"
                onClick={() => (previewing ? preview.stop() : preview.play(SAMPLE))}
                className="w-full py-3 rounded-2xl bg-white/10 border-2 border-white/20 font-black uppercase text-sm flex items-center justify-center gap-2"
            >
                {previewing ? <Square className="w-5 h-5" fill="currentColor" /> : <Volume2 className="w-5 h-5" />}
                {previewing ? 'Stop' : 'Hear a sample'}
            </button>
            {preview.notice && <p className="text-yellow-300 text-xs font-bold">{preview.notice}</p>}
        </div>
    );
};

export default ReadAloudSettings;
