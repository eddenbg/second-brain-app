import React, { useState } from 'react';
import { Loader2, Volume2, Pause, Play, RotateCcw, AlertCircle, Gauge, SlidersHorizontal } from 'lucide-react';
import { useTextToSpeech } from '../hooks/useTextToSpeech';
import { SPEEDS, updateTtsSettings, formatRate } from '../utils/ttsSettings';
import ReadAloudSettings, { useTtsSettings } from './ReadAloudSettings';

// Read-aloud button with explicit states:
// spinner = loading, pause = reading (tap to pause), play = paused (tap to
// resume from the same sentence), alert = failed. "Start over" appears while paused.
// Speed (tap to step through 0.75×–2×, changes immediately) and Voice
// (opens the voice settings) sit next to it.
const ReadAloudButton: React.FC<{ text: string }> = ({ text }) => {
    const { status, error, notice, toggle, stop, play } = useTextToSpeech();
    const { rate } = useTtsSettings();
    const [showSettings, setShowSettings] = useState(false);
    const nextSpeed = () => {
        const next = SPEEDS.find(s => s > rate + 0.01) ?? SPEEDS[0];
        updateTtsSettings({ rate: next });
    };
    const isPlaying = status === 'playing';
    const isLoading = status === 'loading';
    const isPaused = status === 'paused';
    const isError = status === 'error';

    return (
        <div className="flex flex-col items-start gap-2">
            <div className="flex flex-wrap items-center gap-3">
                <button
                    onClick={() => toggle(text)}
                    aria-label={isPlaying ? 'Pause reading' : isLoading ? 'Pause loading audio' : isPaused ? 'Resume reading' : 'Read aloud'}
                    className={`flex items-center gap-3 px-6 py-4 rounded-2xl font-black text-lg uppercase ${
                        isPlaying ? 'bg-red-600 text-white' : 'bg-white text-[#001F3F]'
                    }`}
                >
                    {isLoading ? <Loader2 className="w-7 h-7 animate-spin" /> :
                     isPlaying ? <Pause className="w-7 h-7" fill="currentColor" /> :
                     isPaused ? <Play className="w-7 h-7" fill="currentColor" /> :
                     isError ? <AlertCircle className="w-7 h-7 text-red-600" /> :
                     <Volume2 className="w-7 h-7" />}
                    {isLoading ? 'Loading…' : isPlaying ? 'Pause' : isPaused ? 'Resume' : isError ? 'Try Again' : 'Read Aloud'}
                </button>
                <button
                    onClick={nextSpeed}
                    aria-label={`Reading speed ${formatRate(rate)}. Tap to change.`}
                    className="flex items-center gap-2 px-4 py-4 rounded-2xl font-black text-base bg-white/10 text-white border-2 border-white/20"
                >
                    <Gauge className="w-5 h-5" />
                    {formatRate(rate)}
                </button>
                <button
                    onClick={() => setShowSettings(v => !v)}
                    aria-expanded={showSettings}
                    aria-label="Voice and speed settings"
                    className={`flex items-center gap-2 px-4 py-4 rounded-2xl font-black text-sm uppercase border-2 ${showSettings ? 'bg-white text-[#001F3F] border-white' : 'bg-white/10 text-white border-white/20'}`}
                >
                    <SlidersHorizontal className="w-5 h-5" />
                    Voice
                </button>
                {isPaused && (
                    <button
                        onClick={() => { stop(); play(text); }}
                        aria-label="Start reading from the beginning"
                        className="flex items-center gap-2 px-4 py-4 rounded-2xl font-black text-sm uppercase bg-white/10 text-white border-2 border-white/20"
                    >
                        <RotateCcw className="w-5 h-5" />
                        Start Over
                    </button>
                )}
            </div>
            {isError && error && (
                <p role="alert" className="text-red-400 text-sm font-bold">{error}</p>
            )}
            {notice && !isError && (
                <p role="status" className="text-yellow-300 text-sm font-bold">{notice}</p>
            )}
            {showSettings && (
                <div className="w-full p-4 rounded-2xl bg-black/40 border-2 border-white/20">
                    <ReadAloudSettings />
                </div>
            )}
        </div>
    );
};

export default ReadAloudButton;
