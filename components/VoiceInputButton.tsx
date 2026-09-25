import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2, AlertCircle } from 'lucide-react';
import { startDictation, DictationSession, DictationStatus } from '../utils/dictation';

interface VoiceInputButtonProps {
    /** Current field value — dictated text is appended to it. */
    value: string;
    onChange: (value: string) => void;
    /** What the field is, for screen readers (e.g. "task title"). */
    label: string;
    /** Called once dictation stops, e.g. to auto-send a chat message. */
    onDone?: (finalValue: string) => void;
    className?: string;
    size?: 'md' | 'lg';
}

// Mic button that dictates into a text field (Hebrew / English / mixed).
// Tap to start, tap the square to stop.
const VoiceInputButton: React.FC<VoiceInputButtonProps> = ({ value, onChange, label, onDone, className = '', size = 'md' }) => {
    const [status, setStatus] = useState<DictationStatus>('idle');
    const [error, setError] = useState<string | null>(null);
    const sessionRef = useRef<DictationSession | null>(null);
    const baseRef = useRef('');
    const spokenRef = useRef('');
    const onChangeRef = useRef(onChange);
    const onDoneRef = useRef(onDone);
    onChangeRef.current = onChange;
    onDoneRef.current = onDone;

    useEffect(() => () => { void sessionRef.current?.stop(false); }, []);

    const active = status === 'connecting' || status === 'listening' || status === 'stopping';

    const toggle = () => {
        if (active) {
            void sessionRef.current?.stop();
            return;
        }
        setError(null);
        // Append after existing text, separated by a space
        baseRef.current = value && !/\s$/.test(value) ? value + ' ' : value;
        spokenRef.current = '';
        const session = startDictation({
            onText: (delta) => {
                if (sessionRef.current !== session) return;
                spokenRef.current += delta;
                onChangeRef.current(baseRef.current + spokenRef.current.replace(/^\s+/, ''));
            },
            onStatus: (s, err) => {
                if (sessionRef.current !== session) return;
                setStatus(s);
                if (s === 'error') setError(err || null);
                if (s === 'idle' && spokenRef.current.trim()) {
                    onDoneRef.current?.(baseRef.current + spokenRef.current.replace(/^\s+/, ''));
                }
            },
        });
        sessionRef.current = session;
    };

    const dims = size === 'lg' ? 'w-16 h-16' : 'w-12 h-12';
    const icon = size === 'lg' ? 'w-8 h-8' : 'w-6 h-6';

    return (
        <div className={`flex flex-col items-end gap-1 shrink-0 ${className}`}>
            <button
                type="button"
                onClick={toggle}
                aria-label={active ? `Stop voice input for ${label}` : `Voice input for ${label}`}
                aria-pressed={active}
                title={error || undefined}
                className={`${dims} flex items-center justify-center rounded-2xl border-2 transition-all active:scale-90 ${
                    status === 'listening' ? 'bg-red-600 border-red-400 text-white animate-pulse'
                    : active ? 'bg-white/10 border-white/20 text-white'
                    : status === 'error' ? 'bg-white/5 border-red-400 text-red-400'
                    : 'bg-white/10 border-white/10 text-white hover:bg-white/20'
                }`}
                style={{ minHeight: 'unset', minWidth: 'unset' }}
            >
                {status === 'connecting' || status === 'stopping'
                    ? <Loader2 className={`${icon} animate-spin`} strokeWidth={3} />
                    : status === 'listening'
                        ? <Square className={size === 'lg' ? 'w-6 h-6' : 'w-4 h-4'} strokeWidth={3} fill="currentColor" />
                        : status === 'error'
                            ? <AlertCircle className={icon} strokeWidth={3} />
                            : <Mic className={icon} strokeWidth={3} />}
            </button>
            {status === 'error' && error && (
                <p role="alert" className="text-red-400 text-[10px] font-bold max-w-[12rem] text-right leading-tight">{error}</p>
            )}
        </div>
    );
};

/** Lay out a field with its mic button beside it. */
export const WithVoice: React.FC<{ children: React.ReactNode; className?: string } & VoiceInputButtonProps> = ({ children, className = '', ...buttonProps }) => (
    <div className={`flex items-start gap-2 w-full ${className}`}>
        <div className="flex-1 min-w-0">{children}</div>
        <VoiceInputButton {...buttonProps} />
    </div>
);

export default VoiceInputButton;
