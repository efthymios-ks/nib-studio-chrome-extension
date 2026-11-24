import { describe, expect, it } from 'vitest';
import { MAX_SELECTED_PAGES, pageCountLabel, parsePageSelection, type PageSelection } from './pageSelection.js';

function pagesOf(text: string, pageCount = 14): ReadonlyArray<number> | string {
    const result = parsePageSelection(text, pageCount);

    return result.ok ? result.pages : result.message;
}

function errorOf(text: string, pageCount = 14): Extract<PageSelection, { ok: false }> {
    const result = parsePageSelection(text, pageCount);

    if (result.ok) {
        throw new Error(`"${text}" parsed as ${result.pages.join(', ')}`);
    }

    return result;
}

// The part of the text an error points at.
function markedText(text: string, pageCount = 14): string {
    const error = errorOf(text, pageCount);

    return text.slice(error.start, error.end);
}

describe('parsePageSelection', () => {
    it('reads single pages in the order typed', () => {
        expect(pagesOf('3')).toEqual([3]);
        expect(pagesOf('5, 1, 3')).toEqual([5, 1, 3]);
    });

    it('keeps repeats, as in 1, 2, 6-8, 1', () => {
        expect(pagesOf('1, 2, 6-8, 1')).toEqual([1, 2, 6, 7, 8, 1]);
        expect(pagesOf('2, 2, 2')).toEqual([2, 2, 2]);
        expect(pagesOf('1-3, 2-4')).toEqual([1, 2, 3, 2, 3, 4]);
    });

    it('runs a range up or down', () => {
        expect(pagesOf('6-8')).toEqual([6, 7, 8]);
        expect(pagesOf('8-6')).toEqual([8, 7, 6]);
        expect(pagesOf('5-5')).toEqual([5]);
    });

    it('opens a range to the last page or from the first', () => {
        expect(pagesOf('12-')).toEqual([12, 13, 14]);
        expect(pagesOf('-3')).toEqual([1, 2, 3]);
        expect(pagesOf('14-, -1')).toEqual([14, 1]);
        expect(pagesOf('1-14')).toEqual(Array.from({ length: 14 }, (_, index) => index + 1));
    });

    it('takes commas, semicolons, spaces and new lines as separators, in any mix and number', () => {
        expect(pagesOf('1 2;3,4')).toEqual([1, 2, 3, 4]);
        expect(pagesOf('  1,, 2 ;; \n 3\t4  ')).toEqual([1, 2, 3, 4]);
        expect(pagesOf('1, 2,')).toEqual([1, 2]);
        expect(pagesOf(',1')).toEqual([1]);
    });

    it('keeps a range together across spaces around its dash', () => {
        expect(pagesOf('6 - 8')).toEqual([6, 7, 8]);
        expect(pagesOf('6 -8, 10- 9')).toEqual([6, 7, 8, 10, 9]);
        expect(pagesOf('12 - , 1')).toEqual([12, 13, 14, 1]);
    });

    it('accepts the en and em dashes of pasted text', () => {
        expect(pagesOf('6–8')).toEqual([6, 7, 8]);
        expect(pagesOf('3—1')).toEqual([3, 2, 1]);
    });

    it('reads leading zeros as the number they pad', () => {
        expect(pagesOf('007, 01-02')).toEqual([7, 1, 2]);
    });

    it('says when nothing is entered', () => {
        expect(errorOf('')).toEqual({ ok: false, message: 'Enter the pages to save, such as 1-3, 5.', start: 0, end: 0 });
        expect(errorOf(' , ; ')).toMatchObject({ message: 'Enter the pages to save, such as 1-3, 5.', start: 0, end: 5 });
    });

    it('names a page past the end and points at it', () => {
        expect(errorOf('1, 2, 20')).toEqual({ ok: false, message: 'Page 20 is past the last page, 14.', start: 6, end: 8 });
        expect(errorOf('10-15')).toEqual({ ok: false, message: 'Page 15 is past the last page, 14.', start: 3, end: 5 });
        expect(errorOf('15-')).toMatchObject({ message: 'Page 15 is past the last page, 14.', start: 0, end: 2 });
        expect(errorOf('2', 1).message).toBe('Page 2 is past the last page, 1.');
    });

    it('formats large page numbers and keeps one too long to be exact as typed', () => {
        expect(errorOf('2000', 1500).message).toBe('Page 2,000 is past the last page, 1,500.');
        expect(errorOf('99999999999999999999').message).toBe('Page 99999999999999999999 is past the last page, 14.');
    });

    it('turns down page 0 and points at it', () => {
        expect(errorOf('0')).toEqual({ ok: false, message: 'There\'s no page 0; pages start at 1.', start: 0, end: 1 });
        expect(markedText('3, 0-2')).toBe('0');
        expect(markedText('3-00')).toBe('00');
    });

    it('reports the first problem in reading order', () => {
        expect(errorOf('0, 20').message).toBe('There\'s no page 0; pages start at 1.');
        expect(errorOf('20, x').message).toBe('Page 20 is past the last page, 14.');
        expect(errorOf('x, 20').message).toBe('"x" isn\'t a page or a range.');
    });

    it('marks a part that is neither a page nor a range, up to the next separator', () => {
        expect(errorOf('1, abc, 3')).toEqual({ ok: false, message: '"abc" isn\'t a page or a range.', start: 3, end: 6 });
        expect(markedText('1a')).toBe('1a');
        expect(markedText('2, 1-2-3')).toBe('1-2-3');
        expect(markedText('1--3')).toBe('1--3');
        expect(markedText('6 - x')).toBe('6 - x');
        expect(markedText('4.5')).toBe('4.5');
        expect(markedText('+3')).toBe('+3');
    });

    it('turns down a dash with no page on either side', () => {
        expect(errorOf('1, -')).toEqual({ ok: false, message: 'A range needs a page before or after its dash.', start: 3, end: 4 });
        expect(errorOf(' - , 3')).toMatchObject({ message: 'A range needs a page before or after its dash.', start: 1, end: 2 });
    });

    it('stops a selection past the most pages one PDF takes, without listing them', () => {
        const text = Array.from({ length: 1_000 }, () => '1-14').join(', ');
        const error = errorOf(text);

        expect(error.message).toBe('That\'s more than 10,000 pages, the most one PDF can take here.');
        expect(text.slice(error.start, error.end)).toBe('1-14');
        expect(MAX_SELECTED_PAGES).toBe(10_000);
    });

    it('lets the whole of a longer document through', () => {
        const result = parsePageSelection('1-12000', 12_000);

        expect(result.ok && result.pages.length).toBe(12_000);
    });
});

describe('pageCountLabel', () => {
    it('counts pages in words', () => {
        expect(pageCountLabel(1)).toBe('1 page');
        expect(pageCountLabel(6)).toBe('6 pages');
        expect(pageCountLabel(1200)).toBe('1,200 pages');
    });
});
