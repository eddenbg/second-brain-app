import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { VoiceMemory } from '../types';
import NotebookViewer from './NotebookViewer';
import { useDriveAudio } from './CollegeView';

interface LectureSplitViewProps {
    memory: VoiceMemory;
}

// Spoken-word timestamp for aria-labels — "1 minute 5 seconds" reads far more
// clearly through NVDA than "1:05" spelled out digit by digit.
const describeTimeForScreenReader = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const minPart = `${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
    const secPart = `${secs} ${secs === 1 ? 'second' : 'seconds'}`;
    return `${minPart} ${secPart}`;
};

/**
 * Samsung-Notes-style split view for a saved lecture: the structured
 * transcript on one side, the already-working synced handwriting+audio
 * playback (NotebookViewer) on the other. Both sides share a single <audio>
 * element (owned here) so activating a transcript line can seek the exact
 * clock the notes are replaying against.
 *
 * The panel layout mirrors Recorder.tsx's "Landscape review" block (search
 * that exact phrase) — a transcript column and a notes column, each
 * scrolling independently — reused as-is rather than redesigned, since that
 * split-scroll structure was built specifically to fix a "clunky, everything
 * overflows" complaint from this same user.
 */
const LectureSplitView: React.FC<LectureSplitViewProps> = ({ memory }) => {
    const { src, error } = useDriveAudio(memory.audioDriveFileId, memory.audioDataUrl);
    const audioRef = useRef<HTMLAudioElement>(null);
    const [audioReady, setAudioReady] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const segmentRefs = useRef<Array<HTMLButtonElement | null>>([]);

    const transcript = useMemo(() => memory.structuredTranscript || [], [memory.structuredTranscript]);
    const hasTranscript = transcript.length > 0;

    // Track the shared audio clock independently of NotebookViewer's own
    // playback loop, so the transcript highlights/scrolls in sync no matter
    // what moved the playhead — the notes' own play button, a seek from a
    // transcript line, or a tap on a stroke in the notes themselves.
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        const onTimeUpdate = () => setCurrentTime(audio.currentTime);
        audio.addEventListener('timeupdate', onTimeUpdate);
        return () => audio.removeEventListener('timeupdate', onTimeUpdate);
    }, [audioReady]);

    const activeIndex = useMemo(() => {
        for (let i = transcript.length - 1; i >= 0; i--) {
            if (transcript[i].timestamp <= currentTime) return i;
        }
        return -1;
    }, [transcript, currentTime]);

    useEffect(() => {
        segmentRefs.current[activeIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [activeIndex]);

    if (!memory.notebook) return null;

    // No structured transcript to split against — fall back to the plain
    // synced viewer so nothing regresses for lectures recorded before this.
    if (!hasTranscript) {
        return (
            <>
                {error && <p className="text-yellow-400 font-bold text-xs mb-2">{error}</p>}
                <NotebookViewer notebook={memory.notebook} audioSrc={src} />
            </>
        );
    }

    return (
        <div className="flex flex-col gap-2">
            {error && <p className="text-yellow-400 font-bold text-xs">{error}</p>}

            {/* Shared audio element — visually hidden. NotebookViewer already
                renders play/pause/seek controls when given an audioElement, so
                no separate transport UI is needed here. */}
            <audio
                ref={audioRef}
                src={src}
                preload="metadata"
                onLoadedMetadata={() => setAudioReady(true)}
                onCanPlay={() => setAudioReady(true)}
                aria-hidden="true"
                style={{ display: 'none' }}
            />

            <div className="h-[60vh] min-h-[360px] flex flex-row bg-black rounded-2xl overflow-hidden border border-white/10">
                {/* Transcript */}
                <div className="w-1/2 min-w-0 overflow-y-auto p-5 border-r border-white/10">
                    <h4 className="text-sm font-black text-yellow-400 uppercase tracking-widest mb-3">Transcript</h4>
                    <div className="flex flex-col gap-2">
                        {transcript.map((segment, idx) => {
                            const isActive = idx === activeIndex;
                            return (
                                <button
                                    key={idx}
                                    ref={el => { segmentRefs.current[idx] = el; }}
                                    onClick={() => {
                                        const audio = audioRef.current;
                                        if (!audio) return;
                                        audio.currentTime = segment.timestamp;
                                        setCurrentTime(segment.timestamp);
                                    }}
                                    aria-current={isActive ? 'true' : undefined}
                                    aria-label={`Jump to ${describeTimeForScreenReader(segment.timestamp)}: ${segment.text}`}
                                    className={`text-left px-3 py-2 rounded-xl border-l-4 transition-colors ${
                                        isActive
                                            ? 'bg-yellow-400/20 border-yellow-400 text-white font-bold'
                                            : 'border-transparent text-white/70 hover:bg-white/5'
                                    }`}
                                >
                                    {segment.speakerId !== undefined && (
                                        <span className="block text-[10px] font-black text-blue-300 uppercase tracking-widest">
                                            Speaker {segment.speakerId}
                                        </span>
                                    )}
                                    <span className="text-base leading-relaxed">{segment.text}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Notes exactly as drawn, synced to the same audio clock */}
                <div className="w-1/2 min-w-0 overflow-hidden flex flex-col">
                    <h4 className="shrink-0 text-sm font-black text-green-400 uppercase tracking-widest px-5 pt-5 pb-2">Your notes</h4>
                    <div className="flex-1 min-h-0">
                        <NotebookViewer
                            notebook={memory.notebook}
                            audioElement={audioReady ? audioRef.current : null}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LectureSplitView;
