import React, { useEffect, useRef, useState } from 'react';
import type { AnyMemory, NotebookData, VoiceMemory } from '../types';
import { getLocal, localKey } from '../utils/mediaStore';
import NotebookViewer from './NotebookViewer';

// Playback + drawings for a saved recording. Audio (and, for very long
// lectures, the drawings) live on the device that recorded them — see
// utils/memoryPrep.ts — so they're loaded from device storage here.
const RecordingExtras: React.FC<{ memory: AnyMemory }> = ({ memory }) => {
    const voice = memory as VoiceMemory;
    const [audioSrc, setAudioSrc] = useState<string | null>(null);
    const [audioMissing, setAudioMissing] = useState(false);
    const [notebook, setNotebook] = useState<NotebookData | null>(voice.notebook || null);
    const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
    const objectUrlRef = useRef<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setAudioMissing(false);
        const inline = voice.audioDataUrl || voice.videoDataUrl;
        const load = async () => {
            let dataUrl: string | undefined = inline;
            if (!dataUrl && memory.localMedia) dataUrl = await getLocal<string>(localKey(memory.id, 'audio'));
            if (cancelled) return;
            if (!dataUrl) {
                setAudioSrc(null);
                setAudioMissing(!!memory.localMedia);
                return;
            }
            try {
                // Blob URL instead of a huge data: string in the DOM
                const blob = await (await fetch(dataUrl)).blob();
                if (cancelled) return;
                objectUrlRef.current = URL.createObjectURL(blob);
                setAudioSrc(objectUrlRef.current);
            } catch {
                setAudioSrc(dataUrl);
            }
        };
        void load();
        if (!voice.notebook && memory.localNotebook) {
            getLocal<NotebookData>(localKey(memory.id, 'notebook')).then(nb => { if (!cancelled && nb) setNotebook(nb); });
        } else {
            setNotebook(voice.notebook || null);
        }
        return () => {
            cancelled = true;
            if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = null;
        };
    }, [memory.id]);

    const hasDrawings = !!notebook && ((notebook.strokes?.length ?? 0) > 0 || (notebook.textNotes?.length ?? 0) > 0);

    return (
        <>
            {audioSrc && (
                <audio ref={setAudioEl} src={audioSrc} controls className="w-full" aria-label="Recording playback" />
            )}
            {audioMissing && (
                <p className="text-white/50 text-sm font-bold">The audio is saved on the device you recorded on.</p>
            )}
            {!notebook && memory.localNotebook && (
                <p className="text-white/50 text-sm font-bold">The notes you drew are saved on the device you recorded on.</p>
            )}
            {hasDrawings && (
                <div className="space-y-2">
                    <h3 className="font-black text-gray-400 uppercase text-sm tracking-widest">Notebook</h3>
                    <NotebookViewer notebook={notebook!} audioElement={audioEl} syncWithAudio={false} />
                </div>
            )}
        </>
    );
};

export default RecordingExtras;
