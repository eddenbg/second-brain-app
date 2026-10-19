import type { AnyMemory, NotebookData, TranscriptSegment } from '../types';
import { putLocal, localKey } from './mediaStore';

// Before a memory is saved, its large parts (recorded audio, PDF, photo, very
// long drawings) are moved to the device media store; from there they are
// uploaded to B2 as separate files (utils/cloudSync.ts). The record itself
// stays small, so syncing it between devices is quick.

const MAX_CLOUD_BYTES = 900_000;
// Text is only trimmed for truly huge records (the full text is kept as a file)
const MAX_TEXT_BYTES = 3_000_000;
// Timestamped transcript pieces are merged into chunks of about this length
const SEGMENT_MERGE_SECONDS = 5;

const isDataUrl = (v: unknown): v is string => typeof v === 'string' && v.startsWith('data:');

export const cloudSize = (m: unknown): number => {
    try { return new Blob([JSON.stringify(m)]).size; } catch { return JSON.stringify(m).length * 2; }
};

const mergeSegments = (segments: TranscriptSegment[]): TranscriptSegment[] => {
    const out: TranscriptSegment[] = [];
    for (const seg of segments) {
        const last = out[out.length - 1];
        if (last && seg.timestamp - last.timestamp < SEGMENT_MERGE_SECONDS && last.speakerId === seg.speakerId) {
            last.text += seg.text;
        } else {
            out.push({ ...seg, timestamp: Math.round(seg.timestamp * 10) / 10 });
        }
    }
    return out;
};

const compactNotebook = (nb: NotebookData): NotebookData => ({
    ...nb,
    strokes: (nb.strokes || []).map(s => ({
        ...s,
        points: s.points.map(p => ({ x: Math.round(p.x), y: Math.round(p.y), t: Math.round(p.t) })),
    })),
});

export const prepareMemoryForCloud = async (memory: AnyMemory): Promise<AnyMemory> => {
    const m: any = { ...memory };
    const id = m.id as string;

    // 1. Recorded audio/video: a separate file
    for (const field of ['videoDataUrl', 'audioDataUrl'] as const) {
        if (isDataUrl(m[field]) && m.type !== 'item') {
            try {
                await putLocal(localKey(id, 'audio'), m[field]);
                m.localMedia = true;
            } catch (e) {
                console.warn('Could not keep audio on this device', e);
            }
            delete m[field];
        }
    }
    if (m.voiceNote && isDataUrl(m.voiceNote.audioDataUrl)) {
        const { audioDataUrl, ...rest } = m.voiceNote;
        m.voiceNote = rest;
    }

    // 1b. An uploaded PDF: a separate file (the text stays in the record)
    if (typeof Blob !== 'undefined' && m.pdfBlob instanceof Blob) {
        try {
            await putLocal(localKey(id, 'pdf'), m.pdfBlob);
            m.localPdf = true;
        } catch (e) {
            console.warn('Could not keep the PDF on this device', e);
        }
    }
    delete m.pdfBlob;

    // 2. Compact the transcript timeline and drawings
    if (Array.isArray(m.structuredTranscript) && m.structuredTranscript.length > 0) {
        m.structuredTranscript = mergeSegments(m.structuredTranscript);
    }
    if (m.notebook?.strokes) m.notebook = compactNotebook(m.notebook);

    // 3. Still too big: move the biggest parts to this device (the photo of a
    //    scanned page first, then drawings / timeline of a very long lecture)
    if (cloudSize(m) > MAX_CLOUD_BYTES && isDataUrl(m.imageDataUrl)) {
        await putLocal(localKey(id, 'image'), m.imageDataUrl).catch(() => {});
        delete m.imageDataUrl;
        m.localImage = true;
    }
    if (cloudSize(m) > MAX_CLOUD_BYTES && m.notebook) {
        await putLocal(localKey(id, 'notebook'), m.notebook).catch(() => {});
        delete m.notebook;
        m.localNotebook = true;
    }
    if (cloudSize(m) > MAX_CLOUD_BYTES && m.structuredTranscript) {
        await putLocal(localKey(id, 'structuredTranscript'), m.structuredTranscript).catch(() => {});
        delete m.structuredTranscript;
        m.localStructuredTranscript = true;
    }
    if (cloudSize(m) > MAX_TEXT_BYTES && typeof m.transcript === 'string') {
        // Extremely long transcript: the full text is kept as a file, the record is trimmed
        await putLocal(`${id}:transcript`, m.transcript).catch(() => {});
        m.transcript = m.transcript.slice(0, 250_000) + '\n\n[Transcript trimmed here — it was too long to show in full.]';
    }
    if (cloudSize(m) > MAX_TEXT_BYTES && typeof m.extractedText === 'string') {
        // Extremely long PDF: the full text is kept as a file, the record is trimmed
        await putLocal(`${id}:extractedText`, m.extractedText).catch(() => {});
        m.extractedText = m.extractedText.slice(0, 250_000) + '\n\n[Text trimmed here — the document was too long to show in full.]';
    }
    // Drop `undefined` values anywhere in the record (e.g. a notebook with no
    // background image)
    return stripUndefined(m) as AnyMemory;
};

/** Copy of `value` without undefined fields, at any depth (Blobs etc. kept as is). */
const stripUndefined = (value: any): any => {
    if (Array.isArray(value)) return value.filter(v => v !== undefined).map(stripUndefined);
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = stripUndefined(v);
        return out;
    }
    return value;
};
