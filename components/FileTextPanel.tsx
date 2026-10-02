import React, { useState } from 'react';
import { FileText, Loader2, AlertCircle } from 'lucide-react';
import type { AnyMemory, FileMemory } from '../types';
import { getStoredDriveToken } from '../services/googleDriveService';
import { notifyGoogleAuthExpired } from '../services/googleAuthEvents';
import ReadAloudButton from './ReadAloudButton';

// For files saved as links (Google Drive, Moodle): fetch the file, read its
// text once, and keep the text with the item so it can be listened to and
// asked about like any scanned or uploaded document.

const GOOGLE_EXPORTS: Record<string, string> = {
    'application/vnd.google-apps.document': 'text/plain',
    'application/vnd.google-apps.presentation': 'text/plain',
    'application/vnd.google-apps.spreadsheet': 'text/csv',
};

const FileTextPanel: React.FC<{
    memory: AnyMemory;
    onUpdate: (id: string, updates: Partial<AnyMemory>) => void;
}> = ({ memory, onUpdate }) => {
    const file = memory as FileMemory & { extractedText?: string };
    const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle');
    const [message, setMessage] = useState('');
    const [text, setText] = useState(file.extractedText || '');

    const isPdf = file.mimeType === 'application/pdf' || /\.pdf($|\?)/i.test(file.fileUrl || '') || /\.pdf$/i.test(file.title);
    const googleExport = GOOGLE_EXPORTS[file.mimeType];
    const canRead = file.sourceType === 'drive' && !!file.driveId && (isPdf || !!googleExport || file.mimeType?.startsWith('text/'));

    const readFile = async () => {
        setStatus('working');
        setMessage('Opening the file…');
        try {
            const token = getStoredDriveToken();
            if (!token) {
                notifyGoogleAuthExpired();
                throw new Error('Google Drive needs reconnecting. Tap Reconnect in the yellow bar, then try again.');
            }
            const base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.driveId!)}`;
            const url = googleExport ? `${base}/export?mimeType=${encodeURIComponent(googleExport)}` : `${base}?alt=media`;
            const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            if (res.status === 401) {
                notifyGoogleAuthExpired();
                throw new Error('Google Drive needs reconnecting. Tap Reconnect in the yellow bar, then try again.');
            }
            if (!res.ok) throw new Error(`Drive couldn't send the file (error ${res.status}).`);

            let extracted: string;
            if (isPdf && !googleExport) {
                const blob = await res.blob();
                const { extractPdfText } = await import('../utils/pdf');
                const result = await extractPdfText(blob, ({ fromPage, toPage, totalPages }) =>
                    setMessage(totalPages > 1 ? `Reading pages ${fromPage}–${toPage} of ${totalPages}…` : 'Reading the PDF…'));
                extracted = result.text;
            } else {
                setMessage('Reading the file…');
                extracted = (await res.text()).trim();
            }
            if (!extracted) throw new Error('No text was found in this file.');
            setText(extracted);
            onUpdate(memory.id, { extractedText: extracted } as any);
            setStatus('idle');
        } catch (e: any) {
            setStatus('error');
            setMessage(e?.message || 'Could not read this file.');
        }
    };

    if (text) {
        return (
            <div className="space-y-4">
                <ReadAloudButton text={text} />
                <div className="bg-gray-900 p-5 rounded-[1.5rem] border-2 border-gray-700 max-h-[50vh] overflow-y-auto">
                    <h3 className="text-indigo-400 font-black text-[10px] uppercase tracking-widest mb-2">Text</h3>
                    <p className="text-gray-200 text-base whitespace-pre-wrap leading-relaxed" dir="auto">{text}</p>
                </div>
            </div>
        );
    }

    if (!canRead) {
        return (
            <p className="text-white/60 text-sm font-bold leading-relaxed">
                {file.sourceType === 'moodle'
                    ? 'To listen to this Moodle file: download it, then use Scan or Upload → Upload PDF.'
                    : 'This file type can’t be read aloud yet. For a PDF, use Scan or Upload → Upload PDF.'}
            </p>
        );
    }

    return (
        <div className="space-y-2">
            <button
                onClick={readFile}
                disabled={status === 'working'}
                className="w-full py-5 bg-teal-600 text-white font-black rounded-2xl text-lg uppercase flex items-center justify-center gap-3 disabled:opacity-70"
            >
                {status === 'working' ? <Loader2 className="w-7 h-7 animate-spin" /> : <FileText className="w-7 h-7" />}
                {status === 'working' ? 'Reading…' : 'Read this file'}
            </button>
            {status === 'working' && <p role="status" className="text-white/70 text-sm font-bold text-center">{message}</p>}
            {status === 'error' && (
                <p role="alert" className="text-red-400 text-sm font-bold flex items-start gap-2"><AlertCircle className="w-5 h-5 shrink-0" />{message}</p>
            )}
        </div>
    );
};

export default FileTextPanel;
