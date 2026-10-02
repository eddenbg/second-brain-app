import React from 'react';
import { Loader2, Volume2, Pause, Play, RotateCcw, AlertCircle } from 'lucide-react';
import { useTextToSpeech } from '../hooks/useTextToSpeech';

// Read-aloud button with explicit states:
// spinner = loading, pause = reading (tap to pause), play = paused (tap to
// resume from the same sentence), alert = failed. "Start over" appears while paused.
const ReadAloudButton: React.FC<{ text: string }> = ({ text }) => {
    const { status, error, toggle, stop, play } = useTextToSpeech();
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
        </div>
    );
};

export default ReadAloudButton;
