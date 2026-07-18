import React, { useState } from 'react';
import { Download, FileText, Copy, Check } from 'lucide-react';
import type { AnyMemory } from '../types';

interface ExportOptionsProps {
    memory: AnyMemory;
    onClose: () => void;
}

const ExportOptions: React.FC<ExportOptionsProps> = ({ memory, onClose }) => {
    const [copied, setCopied] = useState<string | null>(null);

    const getPlainText = (): string => {
        let text = `${memory.title}\n`;
        text += `Date: ${new Date(memory.date).toLocaleString()}\n`;
        text += `Category: ${memory.category}\n`;

        if (memory.type === 'voice') {
            const voiceMem = memory as any;
            text += `\n--- Transcript ---\n${voiceMem.transcript || 'No transcript'}`;
            if (voiceMem.summary) text += `\n\n--- Summary ---\n${voiceMem.summary}`;
            if (voiceMem.actionItems?.length) {
                text += `\n\n--- Action Items ---\n`;
                voiceMem.actionItems.forEach((item: any) => {
                    text += `${item.done ? '✓' : '○'} ${item.text}\n`;
                });
            }
        } else if (memory.type === 'document') {
            const docMem = memory as any;
            text += `\n--- Extracted Text ---\n${docMem.extractedText || 'No text'}`;
        } else if (memory.type === 'web') {
            const webMem = memory as any;
            text += `\nURL: ${webMem.url}\n\n--- Content ---\n${webMem.content || 'No content'}`;
        }

        if (memory.tags?.length) {
            text += `\n\nTags: ${memory.tags.join(', ')}`;
        }

        return text;
    };

    const handleCopyToClipboard = () => {
        navigator.clipboard.writeText(getPlainText()).then(() => {
            setCopied('text');
            setTimeout(() => setCopied(null), 2000);
        });
    };

    const handleDownloadText = () => {
        const text = getPlainText();
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${memory.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="fixed inset-0 bg-black/95 z-[200] flex flex-col p-3 sm:p-4 animate-fade-in"
             style={{ paddingTop: 'max(var(--sat), 12px)' }}>
            <div className="bg-gray-800 w-full max-w-sm mx-auto my-auto rounded-[2rem] border-4 border-gray-700 flex flex-col shadow-2xl overflow-hidden">
                <header className="p-5 sm:p-6 border-b-4 border-gray-700 flex justify-between items-center bg-gray-900/50">
                    <h2 className="text-lg sm:text-xl font-black text-white uppercase">Export Options</h2>
                    <button onClick={onClose} className="text-white/60 hover:text-white text-2xl">✕</button>
                </header>

                <div className="p-5 sm:p-6 space-y-3 flex-grow overflow-y-auto">
                    {/* Copy to Clipboard */}
                    <button
                        onClick={handleCopyToClipboard}
                        className="w-full flex items-center gap-4 p-4 rounded-2xl bg-gray-700 hover:bg-gray-600 transition-all active:scale-95"
                    >
                        {copied === 'text' ? (
                            <Check className="w-6 h-6 text-green-400 flex-shrink-0" strokeWidth={3} />
                        ) : (
                            <Copy className="w-6 h-6 text-blue-400 flex-shrink-0" strokeWidth={3} />
                        )}
                        <div className="text-left flex-grow">
                            <p className="font-black text-white uppercase text-sm">Copy to Clipboard</p>
                            <p className="text-xs text-gray-300">Paste into any app</p>
                        </div>
                    </button>

                    {/* Download as Text */}
                    <button
                        onClick={handleDownloadText}
                        className="w-full flex items-center gap-4 p-4 rounded-2xl bg-gray-700 hover:bg-gray-600 transition-all active:scale-95"
                    >
                        <Download className="w-6 h-6 text-green-400 flex-shrink-0" strokeWidth={3} />
                        <div className="text-left flex-grow">
                            <p className="font-black text-white uppercase text-sm">Download as .txt</p>
                            <p className="text-xs text-gray-300">Save to your device</p>
                        </div>
                    </button>

                    {/* Info */}
                    <div className="mt-6 p-4 bg-gray-900/50 rounded-xl border-2 border-gray-700">
                        <p className="text-xs text-gray-400 font-bold leading-relaxed">
                            Export includes title, date, transcript/content, summary, action items, and tags.
                        </p>
                    </div>
                </div>

                <button
                    onClick={onClose}
                    className="w-full p-4 bg-gray-700 text-white font-black text-sm uppercase tracking-wider hover:bg-gray-600 transition-all border-t-4 border-gray-600"
                >
                    Close
                </button>
            </div>
        </div>
    );
};

export default ExportOptions;
