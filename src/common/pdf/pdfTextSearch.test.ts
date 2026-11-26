import { describe, expect, it } from 'vitest';
import {
    findInPage,
    foldQuery,
    hasSearchableText,
    searchablePage,
    type PdfMatch,
    type PdfTextItem,
} from './pdfTextSearch.js';

function items(...parts: ReadonlyArray<string | PdfTextItem>): PdfTextItem[] {
    return parts.map((part) => (typeof part === 'string' ? { str: part, hasEOL: false } : part));
}

function line(text: string): PdfTextItem {
    return { str: text, hasEOL: true };
}

// The original text a match covers, read back from the items through its offsets.
function textOf(match: PdfMatch, source: ReadonlyArray<PdfTextItem>): string {
    if (match.start.item === match.end.item) {
        return source[match.start.item]?.str.slice(match.start.offset, match.end.offset) ?? '';
    }

    const middle = source.slice(match.start.item + 1, match.end.item).map((item) => item.str);
    const first = source[match.start.item]?.str.slice(match.start.offset) ?? '';
    const last = source[match.end.item]?.str.slice(0, match.end.offset) ?? '';

    return [first, ...middle, last].join('');
}

function search(source: ReadonlyArray<PdfTextItem>, query: string): string[] {
    return findInPage(searchablePage(source), foldQuery(query), 0).map((match) => textOf(match, source));
}

describe('foldQuery', () => {
    it('folds like the page text, trims it and runs its spaces together', () => {
        expect(foldQuery('  Συμβόλαιο   ΜΙΣΘΩΣΗΣ ')).toBe('συμβολαιο μισθωσησ');
        expect(foldQuery(' \t ')).toBe('');
    });
});

describe('searchablePage', () => {
    it('traces every folded character back to its item and offsets', () => {
        const page = searchablePage(items('Ab', line(' Ćd'), 'e'));

        expect(page.folded).toBe('ab cd e');
        expect(page.items).toEqual([0, 0, 1, 1, 1, -1, 2]);
        expect(page.starts).toEqual([0, 1, 0, 1, 2, 0, 0]);
        expect(page.ends).toEqual([1, 2, 1, 2, 3, 0, 1]);
    });

    it('keeps a combining accent with the letter before it', () => {
        const page = searchablePage(items('συμβόλαιο'));

        expect(page.folded).toBe('συμβολαιο');
        expect(page.ends[4]).toBe(6);
        expect(page.starts[5]).toBe(6);
    });

    it('runs white space together and drops it at the start of the page', () => {
        expect(searchablePage(items('  one', '\u00A0 two  ', line(''), 'three')).folded).toBe('one two three');
    });

    it('gives each half of a character outside the basic plane the same source', () => {
        const page = searchablePage(items('a𝐁c'));

        expect(page.folded).toBe('a𝐁c');
        expect(page.starts.slice(1, 3)).toEqual([1, 1]);
        expect(page.ends.slice(1, 3)).toEqual([3, 3]);
    });
});

describe('findInPage', () => {
    it('ignores case and accents in the query and in the page alike', () => {
        const source = items('Το ΣΥΜΒΟΛΑΙΟ και το συμβόλαιο και το Συμβολαίο');

        expect(search(source, 'συμβολαιο')).toEqual(['ΣΥΜΒΟΛΑΙΟ', 'συμβόλαιο', 'Συμβολαίο']);
        expect(search(source, 'ΣΥΜΒΌΛΑΙΟ')).toHaveLength(3);
    });

    it('matches a word ending in a final sigma whatever its case', () => {
        expect(search(items('ΟΔΟΣ και οδός'), 'οδος')).toEqual(['ΟΔΟΣ', 'οδός']);
    });

    it('maps a match back to the original text, decomposed accents included', () => {
        const source = items('Η μίσθωση: μίσθωση.');

        expect(search(source, 'ΜΙΣΘΩΣΗ')).toEqual(['μίσθωση', 'μίσθωση']);
    });

    it('matches across the items of one line, and across a line break as a space', () => {
        const source = items('The trace', 'monkey', line(' JIT com'), 'piler');

        expect(search(source, 'tracemonkey')).toEqual(['tracemonkey']);
        expect(search(source, 'jit compiler')).toEqual([]);
        expect(findInPage(searchablePage(source), foldQuery('JIT com piler'), 0)).toEqual([
            { page: 0, start: { item: 2, offset: 1 }, end: { item: 3, offset: 5 } },
        ]);
    });

    it('never runs two lines together without a space', () => {
        const source = items(line('end'), 'start');

        expect(search(source, 'endstart')).toEqual([]);
        expect(search(source, 'end start')).toEqual(['endstart']);
    });

    it('finds matches in reading order without overlapping, with the page they are on', () => {
        const page = searchablePage(items('aaaa'));

        expect(findInPage(page, 'aa', 7).map((match) => [match.page, match.start.offset, match.end.offset])).toEqual([[7, 0, 2], [7, 2, 4]]);
        expect(findInPage(page, '', 7)).toEqual([]);
    });

    it('maps the start and end of a match that spans items to each item', () => {
        const [match] = findInPage(searchablePage(items('Quar', 'ter', 'ly report')), 'quarterly', 0);

        expect(match).toEqual({ page: 0, start: { item: 0, offset: 0 }, end: { item: 2, offset: 2 } });
    });
});

describe('hasSearchableText', () => {
    it('is false for a page with no text items, such as a scan, or only white space', () => {
        expect(hasSearchableText(searchablePage([]))).toBe(false);
        expect(hasSearchableText(searchablePage(items('   ', line(' '), '\t')))).toBe(false);
    });

    it('is true once a page holds one character to search', () => {
        expect(hasSearchableText(searchablePage(items(' ', 'a')))).toBe(true);
    });
});
