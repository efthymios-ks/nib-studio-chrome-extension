import type { PdfReadOutcome } from '../../common/lookup/lookupIndex.js';
import { MAX_TEXT_CHARS } from '../../common/lookup/lookupText.js';
import {
    loadPdfEngineAsync,
    PdfPasswordCancelledError,
    readTextItemsAsync,
    type PdfDocument,
    type PdfEngine,
} from '../views/pdfEngine.js';

// A PDF's text for Lookup, read with pdf.js as PDF Find reads it: each page's items in order, the end of a line
// as a space. pdf.js parses in its own worker, and each page is awaited, so the page's thread is never held for long.
// A protected PDF opens only with the password its tab was unlocked with; a scanned PDF has no text.
export async function readPdfTextAsync(
    file: File,
    password: string | null,
    loadEngineAsync: () => Promise<PdfEngine> = loadPdfEngineAsync,
): Promise<PdfReadOutcome> {
    const engine = await loadEngineAsync();
    let wasAsked = false;
    let pdf: PdfDocument;

    try {
        pdf = await engine.openAsync(new Uint8Array(await file.arrayBuffer()), {
            promptPasswordAsync: async () => {
                const answer = wasAsked ? null : password;
                wasAsked = true;

                return answer;
            },
        });
    }
    catch (error) {
        return error instanceof PdfPasswordCancelledError ? { kind: 'locked' } : { kind: 'name-only' };
    }

    try {
        const pages: string[] = [];
        let length = 0;

        for (let number = 1; number <= pdf.numPages && length < MAX_TEXT_CHARS; number += 1) {
            const page = await pdf.getPage(number);
            const items = await readTextItemsAsync(page);
            const text = items.map((item) => (item.hasEOL ? `${item.str} ` : item.str)).join('');
            pages.push(text);
            length += text.length + 1;
            page.cleanup();
        }

        const text = pages.join(' ');

        return text.trim() === '' ? { kind: 'name-only' } : { kind: 'text', text, isUnlocked: wasAsked && password != null };
    }
    catch {
        return { kind: 'name-only' };
    }
    finally {
        void pdf.loadingTask.destroy();
    }
}
