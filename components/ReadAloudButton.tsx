import React from 'react';
import { Loader2, Volume2, X, AlertCircle } from 'lucide-react';
import { useTextToSpeech } from '../hooks/useTextToSpeech';

// Read-aloud button with explicit states:
// spinner = loading, speaker + X = playing (tap to stop), alert = failed.
const ReadAloudButton: React.FC<{ text: string }> = ({ text }) => {
    const { status, error, toggle } = useTextToSpeech();
    const isPlaying = status === 'playing';
    const isLoading = status === 'loading';
    const isError = status === 'error';

    return (
        <div className="flex flex-col items-start gap-2">
            <button
                onClick={() => toggle(text)}
                aria-label={isPlaying ? 'Stop reading' : isLoading ? 'Cancel loading audio' : 'Read aloud'}
                className={`flex items-center gap-3 px-6 py-4 rounded-2xl font-black text-lg uppercase ${
                    isPlaying ? 'bg-red-600 text-white' : 'bg-white text-[#001F3F]'
                }`}
            >
                {isLoading ? <Loader2 className="w-7 h-7 animate-spin" /> :
                 isPlaying ? <Volume2 className="w-7 h-7 animate-pulse" /> :
                 isError ? <AlertCircle className="w-7 h-7 text-red-600" /> :
                 <Volume2 className="w-7 h-7" />}
                {isLoading ? 'Loading…' : isPlaying ? 'Stop' : isError ? 'Try Again' : 'Read Aloud'}
                {isPlaying && <X className="w-6 h-6" />}
            </button>
            {isError && error && (
                <p role="alert" className="text-red-400 text-sm font-bold">{error}</p>
            )}
        </div>
    );
};

export default ReadAloudButton;
