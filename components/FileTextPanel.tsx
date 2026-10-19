import React from 'react';
import type { AnyMemory, FileMemory } from '../types';
import ReadAloudButton from './ReadAloudButton';

// For files saved as links (e.g. Moodle): shows the file's text, if it was
// saved with the item, so it can be listened to like any scanned or uploaded
// document.

const FileTextPanel: React.FC<{
    memory: AnyMemory;
}> = ({ memory }) => {
    const file = memory as FileMemory & { extractedText?: string };
    const text = file.extractedText || '';

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

    return (
        <p className="text-white/60 text-sm font-bold leading-relaxed">
            To listen to this file, download it and use Documents &amp; PDFs → Upload PDF.
        </p>
    );
};

export default FileTextPanel;
