import React, { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import type { AnyMemory } from '../types';
import { getLocal, localKey } from '../utils/mediaStore';

// "Open original PDF" for an uploaded PDF (the file is kept on the device it
// was added on; the text is available everywhere).
const OriginalPdfLink: React.FC<{ memory: AnyMemory }> = ({ memory }) => {
    const [url, setUrl] = useState<string | null>(null);

    useEffect(() => {
        if (!memory.localPdf) return;
        let objectUrl: string | null = null;
        let cancelled = false;
        getLocal<Blob>(localKey(memory.id, 'pdf')).then(blob => {
            if (cancelled || !blob) return;
            objectUrl = URL.createObjectURL(blob);
            setUrl(objectUrl);
        });
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [memory.id, memory.localPdf]);

    if (!memory.localPdf) return null;
    if (!url) return <p className="text-white/50 text-sm font-bold">The original PDF is saved on the device it was added on.</p>;
    return (
        <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-white/10 border-2 border-white/20 text-white font-black text-sm uppercase"
        >
            <FileText className="w-5 h-5" /> Open original PDF
        </a>
    );
};

export default OriginalPdfLink;
