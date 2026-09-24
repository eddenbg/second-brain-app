import { useState, useRef, useEffect, useCallback } from 'react';
import { TextToSpeechPlayer, TtsStatus } from '../utils/tts';

/** React wrapper around TextToSpeechPlayer. */
export const useTextToSpeech = () => {
    const [status, setStatus] = useState<TtsStatus>('idle');
    const [error, setError] = useState<string | null>(null);
    const playerRef = useRef<TextToSpeechPlayer | null>(null);

    if (!playerRef.current) {
        playerRef.current = new TextToSpeechPlayer((s, err) => {
            setStatus(s);
            setError(s === 'error' ? err || null : null);
        });
    }

    useEffect(() => () => playerRef.current?.dispose(), []);

    const play = useCallback((text: string) => { void playerRef.current?.play(text); }, []);
    const stop = useCallback(() => playerRef.current?.stop(), []);
    const toggle = useCallback((text: string) => {
        if (status === 'playing' || status === 'loading') stop();
        else play(text);
    }, [status, play, stop]);

    return { status, error, play, stop, toggle };
};
