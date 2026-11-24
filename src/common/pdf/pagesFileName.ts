import { nextFreeName } from '../fs/nextFreeName.js';

// The name Save pages offers for the new PDF: "<name>-pages.pdf" beside the original, or the first of
// "<name>-pages-2.pdf", "<name>-pages-3.pdf"… that is free. Names are compared ignoring case,
// as Windows and macOS file systems do.
export function suggestPagesFileName(sourceName: string, existingNames: Iterable<string>): string {
    const stem = stripPdfExtension(sourceName);
    const base = `${stem === '' ? 'document' : stem}-pages`;

    return nextFreeName({ base, extension: '.pdf', existingNames });
}

// Why the name can't take the new PDF, or null when it can.
export function pdfFileNameProblem(name: string): string | null {
    if (name.trim() === '') {
        return 'Enter a file name.';
    }

    if (!/\.pdf$/i.test(name)) {
        return 'The name needs to end in .pdf.';
    }

    if (/^\.pdf$/i.test(name)) {
        return 'The name needs something before .pdf.';
    }

    return null;
}

function stripPdfExtension(name: string): string {
    return name.replace(/\.pdf$/i, '');
}
