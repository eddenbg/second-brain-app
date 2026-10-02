import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, FileText, Loader2 } from 'lucide-react';
import type { AnyMemory } from '../types';
import { getLocal, localKey } from '../utils/mediaStore';
import { safeSetItem } from '../utils/safeStorage';

// The original page(s) next to the text read from them, so it's easy to
// follow along on the real page and to spot reading mistakes.
// - Photo scan: the photo, then its text.
// - PDF: each page as a picture, followed by that page's text.
// Three layouts: page above text (phones), side by side (tablets), text only.

type Layout = 'above' | 'side' | 'text';
const LAYOUT_KEY = 'sb-document-layout';

const loadLayout = (): Layout => {
    try {
        const v = localStorage.getItem(LAYOUT_KEY);
        if (v === 'above' || v === 'side' || v === 'text') return v;
    } catch { /* storage unavailable */ }
    return typeof window !== 'undefined' && window.innerWidth >= 768 ? 'side' : 'above';
};

// pdf.js is large: load it only when a PDF is shown
const PDFJS_VERSION = '4.10.38';
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
const loadPdfJs = () => {
    if (!pdfjsPromise) {
        pdfjsPromise = Promise.all([
            import('pdfjs-dist'),
            import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
        ]).then(([pdfjs, worker]) => {
            pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
            return pdfjs;
        }).catch(e => { pdfjsPromise = null; throw e; });
    }
    return pdfjsPromise;
};

/** Split extracted text on its "Page N" lines → page number → text. */
export const splitTextByPage = (text: string): Map<number, string> => {
    const pages = new Map<number, string>();
    let current = 1;
    let buffer: string[] = [];
    const flush = () => {
        const t = buffer.join('\n').trim();
        if (t) pages.set(current, pages.has(current) ? `${pages.get(current)}\n${t}` : t);
        buffer = [];
    };
    for (const line of text.split('\n')) {
        const m = line.match(/^\s*(?:\*\*)?(?:Page|עמוד)\s+(\d+)(?:\*\*)?\s*:?\s*$/i);
        if (m) { flush(); current = Number(m[1]); }
        else buffer.push(line);
    }
    flush();
    return pages;
};

const FullScreenImage: React.FC<{ src: string; alt: string; onClose: () => void }> = ({ src, alt, onClose }) => (
    <div className="fixed inset-0 z-[400] bg-black flex flex-col" role="dialog" aria-label={alt}>
        <div className="flex justify-end p-3 shrink-0">
            <button
                onClick={onClose}
                aria-label="Close"
                className="w-14 h-14 rounded-2xl bg-white/10 border-2 border-white/30 flex items-center justify-center"
                style={{ minHeight: 'unset' }}
            >
                <X className="w-8 h-8 text-white" strokeWidth={3} />
            </button>
        </div>
        {/* Natural size inside a scroll area: drag to move around, pinch to zoom */}
        <div className="flex-1 overflow-auto" style={{ touchAction: 'pan-x pan-y pinch-zoom' }}>
            <img src={src} alt={alt} className="max-w-none" style={{ width: '200%' }} />
        </div>
    </div>
);

const OriginalImage: React.FC<{ src: string | null; alt: string; loading?: boolean }> = ({ src, alt, loading }) => {
    const [open, setOpen] = useState(false);
    if (!src) {
        return (
            <div className="w-full aspect-[3/4] rounded-2xl border-2 border-white/20 bg-white/5 flex items-center justify-center">
                {loading && <Loader2 className="w-10 h-10 animate-spin text-white/50" />}
            </div>
        );
    }
    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label={`${alt} – tap to enlarge`}
                className="block w-full p-0 bg-transparent border-0"
                style={{ minHeight: 'unset' }}
            >
                <img src={src} alt={alt} className="w-full max-h-[80vh] object-contain rounded-2xl border-2 border-white/20 bg-white" />
            </button>
            {open && <FullScreenImage src={src} alt={alt} onClose={() => setOpen(false)} />}
        </>
    );
};

/** One PDF page, drawn only when it scrolls near the screen. */
const PdfPageImage: React.FC<{ doc: any; pageNumber: number }> = ({ doc, pageNumber }) => {
    const holder = useRef<HTMLDivElement>(null);
    const [src, setSrc] = useState<string | null>(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const el = holder.current;
        if (!el || visible) return;
        if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
        const io = new IntersectionObserver(entries => {
            if (entries.some(e => e.isIntersecting)) { setVisible(true); io.disconnect(); }
        }, { rootMargin: '800px 0px' });
        io.observe(el);
        return () => io.disconnect();
    }, [visible]);

    useEffect(() => {
        if (!visible) return;
        let cancelled = false;
        let url: string | null = null;
        (async () => {
            try {
                const page = await doc.getPage(pageNumber);
                const base = page.getViewport({ scale: 1 });
                const width = Math.min(1600, Math.max(800, (holder.current?.clientWidth || 600) * (window.devicePixelRatio || 1)));
                const viewport = page.getViewport({ scale: width / base.width });
                const canvas = document.createElement('canvas');
                canvas.width = Math.floor(viewport.width);
                canvas.height = Math.floor(viewport.height);
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                await page.render({ canvasContext: ctx, viewport }).promise;
                // Keep a compressed picture instead of the big canvas
                const blob: Blob | null = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
                canvas.width = 0; canvas.height = 0;
                if (cancelled || !blob) return;
                url = URL.createObjectURL(blob);
                setSrc(url);
            } catch (e) {
                console.warn(`Could not draw PDF page ${pageNumber}`, e);
            }
        })();
        return () => {
            cancelled = true;
            if (url) URL.revokeObjectURL(url);
        };
    }, [visible, doc, pageNumber]);

    return (
        <div ref={holder}>
            <OriginalImage src={src} alt={`Original page ${pageNumber}`} loading={visible} />
        </div>
    );
};

const OriginalWithText: React.FC<{
    text: string;
    title: string;
    /** Saved item (loads the photo / PDF kept on this device) */
    memory?: AnyMemory;
    /** Use these directly (e.g. right after scanning, before saving finishes) */
    pdf?: Blob | null;
    imageSrc?: string | null;
    textClassName?: string;
}> = ({ text, title, memory, pdf, imageSrc, textClassName = 'text-xl leading-relaxed' }) => {
    const [layout, setLayout] = useState<Layout>(loadLayout);
    const [image, setImage] = useState<string | null>(imageSrc || (memory as any)?.imageDataUrl || null);
    const [pdfBlob, setPdfBlob] = useState<Blob | null>(pdf || null);
    const [pdfDoc, setPdfDoc] = useState<any>(null);
    const [pdfState, setPdfState] = useState<'none' | 'loading' | 'ready' | 'error' | 'elsewhere'>('none');
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);

    const chooseLayout = (l: Layout) => {
        setLayout(l);
        safeSetItem(LAYOUT_KEY, l);
    };

    // Photo
    useEffect(() => {
        let cancelled = false;
        const inline = imageSrc || (memory as any)?.imageDataUrl || null;
        setImage(inline);
        if (!inline && memory?.localImage) {
            getLocal<string>(localKey(memory.id, 'image')).then(v => { if (!cancelled && v) setImage(v); });
        }
        return () => { cancelled = true; };
    }, [memory?.id, imageSrc]);

    // PDF file: given directly, or kept on this device
    useEffect(() => {
        let cancelled = false;
        if (pdf) { setPdfBlob(pdf); return; }
        setPdfBlob(null);
        if (memory?.localPdf) {
            setPdfState('loading');
            getLocal<Blob>(localKey(memory.id, 'pdf')).then(b => {
                if (cancelled) return;
                if (b) setPdfBlob(b);
                else setPdfState('elsewhere');
            }).catch(() => { if (!cancelled) setPdfState('elsewhere'); });
        } else {
            setPdfState('none');
        }
        return () => { cancelled = true; };
    }, [memory?.id, memory?.localPdf, pdf]);

    // Open the PDF with pdf.js
    useEffect(() => {
        if (!pdfBlob) return;
        let cancelled = false;
        let loaded: any = null;
        const url = URL.createObjectURL(pdfBlob);
        setPdfUrl(url);
        setPdfState('loading');
        (async () => {
            try {
                const pdfjs = await loadPdfJs();
                const data = new Uint8Array(await pdfBlob.arrayBuffer());
                loaded = await pdfjs.getDocument({
                    data,
                    // Fonts / character maps for Hebrew and other non-Latin PDFs
                    cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/cmaps/`,
                    cMapPacked: true,
                    standardFontDataUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/standard_fonts/`,
                }).promise;
                if (cancelled) { loaded.destroy(); return; }
                setPdfDoc(loaded);
                setPdfState('ready');
            } catch (e) {
                console.warn('Could not open the PDF for viewing', e);
                if (!cancelled) setPdfState('error');
            }
        })();
        return () => {
            cancelled = true;
            URL.revokeObjectURL(url);
            setPdfUrl(null);
            setPdfDoc(null);
            try { loaded?.destroy(); } catch { /* already closed */ }
        };
    }, [pdfBlob]);

    const textByPage = useMemo(() => splitTextByPage(text || ''), [text]);
    const hasOriginal = !!image || pdfState !== 'none';

    const textBlock = (t: string | undefined, key?: React.Key) => (
        <p key={key} className={`${textClassName} whitespace-pre-wrap`} dir="auto">
            {t || <span className="text-white/40 text-base">No text on this page.</span>}
        </p>
    );

    const pair = (original: React.ReactNode, t: string | undefined, label?: string, key?: React.Key) => (
        <section key={key} className="space-y-2">
            {label && <h3 className="text-[#60A5FA] font-black text-sm uppercase tracking-widest">{label}</h3>}
            <div className={layout === 'side' ? 'grid grid-cols-2 gap-4 items-start' : 'space-y-4'}>
                <div>{original}</div>
                <div>{textBlock(t)}</div>
            </div>
        </section>
    );

    const layoutButton = (l: Layout, label: string) => (
        <button
            type="button"
            onClick={() => chooseLayout(l)}
            aria-pressed={layout === l}
            className={`flex-1 py-3 rounded-xl text-sm font-black uppercase border-2 ${layout === l ? 'bg-white text-[#001F3F] border-white' : 'bg-transparent text-white border-white/30'}`}
            style={{ minHeight: 'unset' }}
        >
            {label}
        </button>
    );

    let body: React.ReactNode;
    if (!hasOriginal || layout === 'text') {
        body = textBlock(text);
    } else if (image) {
        body = pair(<OriginalImage src={image} alt={`Original photo: ${title}`} />, text);
    } else if (pdfState === 'ready' && pdfDoc) {
        const numPages: number = pdfDoc.numPages;
        // Text that doesn't belong to any page of the file (unexpected numbering)
        const extra = [...textByPage.entries()].filter(([n]) => n < 1 || n > numPages).map(([, t]) => t).join('\n\n');
        body = (
            <div className="space-y-8">
                {Array.from({ length: numPages }, (_, k) => k + 1).map(n =>
                    pair(<PdfPageImage doc={pdfDoc} pageNumber={n} />, textByPage.get(n), `Page ${n} of ${numPages}`, n))}
                {extra && textBlock(extra)}
            </div>
        );
    } else if (pdfState === 'loading') {
        body = (
            <div className="space-y-4">
                <p className="flex items-center gap-2 text-white/70 font-bold"><Loader2 className="w-5 h-5 animate-spin" /> Opening the original PDF…</p>
                {textBlock(text)}
            </div>
        );
    } else {
        body = (
            <div className="space-y-4">
                <p className="text-white/60 text-sm font-bold">
                    {pdfState === 'elsewhere'
                        ? 'The original PDF is saved on the device it was added on.'
                        : 'The original PDF could not be shown here — use "Open original PDF".'}
                </p>
                {textBlock(text)}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {hasOriginal && (
                <div className="space-y-3">
                    <div className="flex gap-2" role="group" aria-label="How to show the original">
                        {layoutButton('above', 'Page above text')}
                        {layoutButton('side', 'Side by side')}
                        {layoutButton('text', 'Text only')}
                    </div>
                    {pdfUrl && (
                        <a
                            href={pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-white/10 border-2 border-white/20 text-white font-black text-sm uppercase"
                        >
                            <FileText className="w-5 h-5" /> Open original PDF
                        </a>
                    )}
                </div>
            )}
            {body}
        </div>
    );
};

export default OriginalWithText;
