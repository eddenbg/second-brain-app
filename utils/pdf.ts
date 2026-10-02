import { PDFDocument } from 'pdf-lib';
import { getGeminiInstance, describeAiError } from '../services/geminiService';
import { withTimeout } from './timeout';

// Read the text of a PDF (lecture slides, handouts, articles) so it can be
// listened to and asked about. Gemini reads each page — printed, scanned or
// Hebrew alike — in chunks of a few pages, so long files don't hit limits and
// progress can be shown.

const PAGES_PER_CHUNK = 8;
const CHUNK_TIMEOUT_MS = 150_000;
// Inline request limit is ~20 MB; stay well under it
const MAX_INLINE_BYTES = 14 * 1024 * 1024;
const MODEL = 'gemini-2.5-flash';

export interface PdfProgress {
    fromPage: number;
    toPage: number;
    totalPages: number;
}

export interface PdfTextResult {
    text: string;
    pageCount: number;
    failedRanges: string[];
}

const bytesToBase64 = (bytes: Uint8Array): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    });

const prompt = (from: number, to: number) =>
    `Transcribe ALL text in this PDF (pages ${from}–${to} of the original document) so it can be read aloud to a visually impaired student.
- Keep the natural reading order (Hebrew is right-to-left). Keep each heading and bullet point on its own line.
- Turn tables into readable lines (one row per line, cells separated by " – ").
- For each image, chart or diagram, add one short line: [Figure: brief description].
- Write math in words or plain symbols that a screen reader can say.
- Do not summarize, translate or add commentary.
- Begin each page with a line "Page N", numbering from ${from}.`;

async function readChunk(bytes: Uint8Array, from: number, to: number): Promise<string> {
    const ai = getGeminiInstance();
    if (!ai) throw new Error('AI features are not set up (missing Gemini API key).');
    const data = await bytesToBase64(bytes);
    const call = () => withTimeout(
        ai.models.generateContent({
            model: MODEL,
            contents: { parts: [{ inlineData: { mimeType: 'application/pdf', data } }, { text: prompt(from, to) }] },
        }),
        CHUNK_TIMEOUT_MS,
        'Reading the PDF took too long'
    );
    try {
        return ((await call()).text ?? '').trim();
    } catch (first) {
        console.warn(`PDF pages ${from}-${to} failed, retrying once`, first);
        try {
            return ((await call()).text ?? '').trim();
        } catch (e) {
            throw new Error(describeAiError(e));
        }
    }
}

/** Extract the text of a whole PDF. Calls onProgress before each chunk. */
export async function extractPdfText(file: Blob, onProgress?: (p: PdfProgress) => void): Promise<PdfTextResult> {
    const bytes = new Uint8Array(await file.arrayBuffer());

    let source: PDFDocument | null = null;
    try {
        source = await PDFDocument.load(bytes, { ignoreEncryption: true });
    } catch (e) {
        console.warn('Could not split the PDF; sending it whole', e);
    }

    // Can't split (unusual/encrypted file): send it in one go if small enough
    if (!source) {
        if (bytes.byteLength > MAX_INLINE_BYTES) throw new Error('This PDF is too large to read in one go and could not be split.');
        onProgress?.({ fromPage: 1, toPage: 1, totalPages: 1 });
        const text = await readChunk(bytes, 1, 1);
        if (!text) throw new Error('No text was found in this PDF.');
        return { text, pageCount: 0, failedRanges: [] };
    }

    const totalPages = source.getPageCount();
    const parts: string[] = [];
    const failedRanges: string[] = [];

    for (let start = 0; start < totalPages; start += PAGES_PER_CHUNK) {
        const end = Math.min(start + PAGES_PER_CHUNK, totalPages);
        const from = start + 1;
        const to = end;
        onProgress?.({ fromPage: from, toPage: to, totalPages });

        let chunkBytes: Uint8Array = bytes;
        if (totalPages > PAGES_PER_CHUNK || bytes.byteLength > MAX_INLINE_BYTES) {
            const chunk = await PDFDocument.create();
            const pages = await chunk.copyPages(source, Array.from({ length: end - start }, (_, k) => start + k));
            pages.forEach(p => chunk.addPage(p));
            chunkBytes = await chunk.save();
        }

        try {
            if (chunkBytes.byteLength > MAX_INLINE_BYTES) throw new Error('These pages are too large to read.');
            const text = await readChunk(chunkBytes, from, to);
            parts.push(text || `Page ${from}\n[No text on pages ${from}–${to}]`);
        } catch (e: any) {
            // Keep going: one bad chunk shouldn't lose the rest of the file
            if (start === 0 && end === totalPages) throw e;
            failedRanges.push(`${from}–${to}`);
            parts.push(`Page ${from}\n[Pages ${from}–${to} could not be read: ${e?.message || 'error'}]`);
        }
    }

    const text = parts.join('\n\n').trim();
    if (!text || failedRanges.length * PAGES_PER_CHUNK >= totalPages) {
        throw new Error('The PDF could not be read. Try again in a minute.');
    }
    return { text, pageCount: totalPages, failedRanges };
}

/** Title from a file name: "Lecture_3 - Groups.pdf" → "Lecture 3 - Groups". */
export const titleFromFileName = (name: string): string =>
    name.replace(/\.pdf$/i, '').replace(/[_+]+/g, ' ').replace(/\s+/g, ' ').trim() || 'PDF document';
