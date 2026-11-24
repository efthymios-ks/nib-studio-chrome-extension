import { describe, expect, it } from 'vitest';
import { isNameTaken, nextCopyName, nextFreeName, takenNameMessage } from './nextFreeName.js';

describe('isNameTaken', () => {
    it('finds a name ignoring case', () => {
        expect(isNameTaken('Report-pages.pdf', ['report-pages.pdf'])).toBe(true);
        expect(isNameTaken('report-pages-2.pdf', new Set(['report-pages.pdf']))).toBe(false);
    });
});

describe('nextFreeName', () => {
    it('gives the name itself when it is free', () => {
        expect(nextFreeName({ base: 'scan-pages', extension: '.pdf', existingNames: [] })).toBe('scan-pages.pdf');
        expect(nextFreeName({ base: 'notes.md.nib-rename', extension: '', existingNames: ['notes.md'] })).toBe('notes.md.nib-rename');
    });

    it('numbers on from 2, before the extension, past every name taken', () => {
        const existingNames = ['scan-pages.pdf', 'scan-pages-2.pdf', 'scan-pages-3.pdf'];

        expect(nextFreeName({ base: 'scan-pages', extension: '.pdf', existingNames })).toBe('scan-pages-4.pdf');
        expect(nextFreeName({ base: 'data-copy', extension: '', existingNames: ['data-copy'] })).toBe('data-copy-2');
    });

    it('takes the first gap', () => {
        const existingNames = new Set(['a-pages.pdf', 'a-pages-2.pdf', 'a-pages-4.pdf']);

        expect(nextFreeName({ base: 'a-pages', extension: '.pdf', existingNames })).toBe('a-pages-3.pdf');
    });

    it('compares names ignoring case, and keeps the case it was given', () => {
        expect(nextFreeName({ base: 'Scan-pages', extension: '.pdf', existingNames: ['SCAN-PAGES.PDF'] })).toBe('Scan-pages-2.pdf');
        expect(nextFreeName({ base: 'report-copy', extension: '.json', existingNames: ['Report-Copy.json'] })).toBe('report-copy-2.json');
    });
});

describe('nextCopyName', () => {
    it('adds -copy before the extension', () => {
        expect(nextCopyName('report.json', [])).toBe('report-copy.json');
        expect(nextCopyName('report.json', ['report.json'])).toBe('report-copy.json');
        expect(nextCopyName('v1.2.final.pdf', [])).toBe('v1.2.final-copy.pdf');
    });

    it('numbers the copy from 2 when -copy is taken', () => {
        expect(nextCopyName('report.json', ['report.json', 'report-copy.json'])).toBe('report-copy-2.json');
        expect(nextCopyName('report.json', ['report-copy.json', 'report-copy-2.json'])).toBe('report-copy-3.json');
    });

    it('puts -copy at the end of a name with no extension, or with only a leading dot', () => {
        expect(nextCopyName('data', ['data'])).toBe('data-copy');
        expect(nextCopyName('.env', ['.env', '.env-copy'])).toBe('.env-copy-2');
    });

    it('compares names ignoring case', () => {
        expect(nextCopyName('Report.json', ['report-copy.json'])).toBe('Report-copy-2.json');
        expect(nextCopyName('report.json', ['REPORT-COPY.JSON', 'Report-Copy-2.json'])).toBe('report-copy-3.json');
    });
});

describe('takenNameMessage', () => {
    const entries = new Map<string, FileSystemHandleKind>([['notes.md', 'file'], ['Docs', 'directory']]);

    it('names the entry that takes the name, ignoring case, as a file or a folder', () => {
        expect(takenNameMessage('notes.md', entries)).toBe('A file named notes.md already exists.');
        expect(takenNameMessage('NOTES.MD', entries)).toBe('A file named notes.md already exists.');
        expect(takenNameMessage('docs', entries)).toBe('A folder named Docs already exists.');
    });

    it('is null for a free name', () => {
        expect(takenNameMessage('other.md', entries)).toBeNull();
    });
});
