import { describe, expect, it } from 'vitest';
import { pdfFileNameProblem, suggestPagesFileName } from './pagesFileName.js';

describe('suggestPagesFileName', () => {
    it('adds -pages before the extension', () => {
        expect(suggestPagesFileName('tracemonkey.pdf', new Set())).toBe('tracemonkey-pages.pdf');
        expect(suggestPagesFileName('Annual report 2026.pdf', [])).toBe('Annual report 2026-pages.pdf');
    });

    it('takes the next free number when the name is taken', () => {
        expect(suggestPagesFileName('tracemonkey.pdf', ['tracemonkey.pdf', 'tracemonkey-pages.pdf'])).toBe('tracemonkey-pages-2.pdf');
        expect(suggestPagesFileName('a.pdf', ['a-pages.pdf', 'a-pages-2.pdf', 'a-pages-4.pdf'])).toBe('a-pages-3.pdf');
    });

    it('compares names ignoring case', () => {
        expect(suggestPagesFileName('Scan.PDF', ['scan-pages.pdf'])).toBe('Scan-pages-2.pdf');
        expect(suggestPagesFileName('scan.pdf', new Set(['SCAN-PAGES.PDF']))).toBe('scan-pages-2.pdf');
    });

    it('keeps other dots and adds .pdf to a name without it', () => {
        expect(suggestPagesFileName('v1.2.final.pdf', [])).toBe('v1.2.final-pages.pdf');
        expect(suggestPagesFileName('scan', [])).toBe('scan-pages.pdf');
    });

    it('names a file called only .pdf after a document', () => {
        expect(suggestPagesFileName('.pdf', [])).toBe('document-pages.pdf');
    });
});

describe('pdfFileNameProblem', () => {
    it('accepts a name that ends in .pdf in any case', () => {
        expect(pdfFileNameProblem('tracemonkey-pages.pdf')).toBeNull();
        expect(pdfFileNameProblem('SCAN.PDF')).toBeNull();
    });

    it('asks for a name, and for the .pdf extension', () => {
        expect(pdfFileNameProblem('')).toBe('Enter a file name.');
        expect(pdfFileNameProblem('   ')).toBe('Enter a file name.');
        expect(pdfFileNameProblem('pages')).toBe('The name needs to end in .pdf.');
        expect(pdfFileNameProblem('pages.pdf.txt')).toBe('The name needs to end in .pdf.');
        expect(pdfFileNameProblem('.pdf')).toBe('The name needs something before .pdf.');
    });
});
