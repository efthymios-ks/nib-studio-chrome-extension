import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfMatch, PdfTextItem } from '../../common/pdf/pdfTextSearch.js';
import { flushAsync, pressKey } from '../testing/testHelpers.js';
import type { FindHighlighter } from './documentFind.js';
import {
    createPageTextCache,
    createPdfFind,
    findSummary,
    matchRange,
    PDF_FIND_CURRENT_HIGHLIGHT,
    PDF_FIND_HIGHLIGHT,
    PROGRESS_DELAY_MS,
    stepMatch,
    type PageTextCache,
    type PdfFind,
    type SearchProgress,
} from './pdfFind.js';

const PAGES: ReadonlyArray<ReadonlyArray<string>> = [
    ['The contract ', 'of lease'],
    ['No match here'],
    ['Lease ends; the ', 'LEA', 'SE is renewed'],
];

let scope: HTMLElement;
let finds: PdfFind[] = [];

function itemsOf(texts: ReadonlyArray<string>): PdfTextItem[] {
    return texts.map((str) => ({ str, hasEOL: false }));
}

function cacheOf(pages: ReadonlyArray<ReadonlyArray<string>> = PAGES): PageTextCache {
    return createPageTextCache(pages.length, async (index) => itemsOf(pages[index] ?? []));
}

// A page's text layer as pdf.js lays it out: one span per item.
function spansOf(texts: ReadonlyArray<string>): HTMLElement[] {
    return texts.map((text) => {
        const span = document.createElement('span');
        span.textContent = text;
        scope.append(span);

        return span;
    });
}

interface RecordingHighlighter extends FindHighlighter {
    readonly shown: Array<{ readonly texts: string[]; readonly current: string | null }>;
}

function recordingHighlighter(): RecordingHighlighter {
    const shown: RecordingHighlighter['shown'] = [];

    return {
        shown,
        show: (ranges, current) => shown.push({ texts: ranges.map((range) => range.toString()), current: ranges[current]?.toString() ?? null }),
        clear: () => shown.push({ texts: [], current: null }),
    };
}

function mount(overrides: Partial<Parameters<typeof createPdfFind>[0]> = {}): { find: PdfFind; reveals: PdfMatch[]; highlighter: RecordingHighlighter } {
    const reveals: PdfMatch[] = [];
    const highlighter = recordingHighlighter();
    const find = createPdfFind({
        shortcutScope: scope,
        memory: overrides.memory ?? {},
        onReveal: (match) => reveals.push(match),
        highlighter,
        ...overrides,
    });
    scope.append(find.element);
    finds.push(find);

    return { find, reveals, highlighter };
}

function input(): HTMLInputElement {
    return scope.querySelector('.document-find-input') as HTMLInputElement;
}

function count(): string {
    return scope.querySelector('.document-find-count')?.textContent ?? '';
}

async function typeAsync(text: string): Promise<void> {
    input().value = text;
    input().dispatchEvent(new Event('input'));
    await flushAsync();
}

function progress(overrides: Partial<SearchProgress>): SearchProgress {
    return {
        query: 'lease',
        total: 0,
        current: -1,
        searchedPages: 0,
        pageCount: 32,
        isDone: true,
        showsProgress: false,
        hasText: true,
        ...overrides,
    };
}

beforeEach(() => {
    scope = document.createElement('div');
    document.body.append(scope);
    finds = [];
});

afterEach(() => {
    for (const find of finds) {
        find.destroy();
    }

    scope.remove();
    vi.unstubAllGlobals();
});

describe('createPageTextCache', () => {
    it('reads each page once, when it is first asked for, even when two searches ask at once', async () => {
        const read = vi.fn(async (index: number) => itemsOf([`page ${index}`]));
        const cache = createPageTextCache(3, read);

        expect(cache.peek(1)).toBeUndefined();
        const [first, second] = await Promise.all([cache.readAsync(1), cache.readAsync(1)]);
        await cache.readAsync(1);

        expect(read).toHaveBeenCalledTimes(1);
        expect(first).toBe(second);
        expect(cache.peek(1)?.folded).toBe('page 1');
        expect(cache.peek(0)).toBeUndefined();
    });

    it('treats a page whose text can\'t be read as one with nothing to find', async () => {
        const cache = createPageTextCache(1, async () => {
            throw new Error('Bad page');
        });

        expect((await cache.readAsync(0)).folded).toBe('');
    });
});

describe('findSummary', () => {
    it('reads "n of m", or No matches, once every page is searched', () => {
        expect(findSummary(progress({ total: 5, current: 1 }))).toEqual({ text: '2 of 5', state: 'found' });
        expect(findSummary(progress({ total: 0 }))).toEqual({ text: 'No matches', state: 'none' });
        expect(findSummary(progress({ query: '  ' }))).toEqual({ text: '', state: 'idle' });
    });

    it('says the PDF has no text to search once every page is searched and none had any', () => {
        expect(findSummary(progress({ hasText: false }))).toEqual({ text: 'This PDF has no text to search', state: 'none' });
        expect(findSummary(progress({ hasText: false, isDone: false, showsProgress: true, searchedPages: 3 })).text)
            .toBe('Searching… 3 of 32 pages');
    });

    it('writes counts with thousands separators', () => {
        expect(findSummary(progress({ total: 3_310, current: 1_203 })).text).toBe('1,204 of 3,310');
        expect(findSummary(progress({ isDone: false, searchedPages: 1_200, pageCount: 3_310, showsProgress: true })).text)
            .toBe('Searching… 1,200 of 3,310 pages');
    });

    it('says how far a long search has got, and nothing before then', () => {
        expect(findSummary(progress({ isDone: false, searchedPages: 12, showsProgress: true }))).toEqual({ text: 'Searching… 12 of 32 pages', state: 'searching' });
        expect(findSummary(progress({ isDone: false, searchedPages: 0, pageCount: 1, showsProgress: true })).text).toBe('Searching… 0 of 1 page');
        expect(findSummary(progress({ isDone: false, total: 3, current: 0 }))).toEqual({ text: '', state: 'searching' });
    });
});

describe('stepMatch', () => {
    it('steps both ways and wraps round once the search is done', () => {
        expect(stepMatch(0, 3, 1, true)).toBe(1);
        expect(stepMatch(2, 3, 1, true)).toBe(0);
        expect(stepMatch(0, 3, -1, true)).toBe(2);
        expect(stepMatch(-1, 3, -1, true)).toBe(2);
        expect(stepMatch(-1, 3, 1, true)).toBe(0);
        expect(stepMatch(0, 0, 1, true)).toBe(-1);
    });

    it('stays at the last match found while pages are still being read', () => {
        expect(stepMatch(2, 3, 1, false)).toBe(2);
        expect(stepMatch(0, 3, -1, false)).toBe(0);
    });
});

describe('matchRange', () => {
    it('covers a match across the spans of a text layer', () => {
        const spans = spansOf(['Quar', 'ter', 'ly']);
        const range = matchRange({ page: 0, start: { item: 0, offset: 1 }, end: { item: 2, offset: 1 } }, spans);

        expect(range?.toString()).toBe('uarterl');
    });

    it('gives nothing for an item with no text or an offset past its end', () => {
        const spans = [document.createElement('span'), ...spansOf(['ab'])];

        expect(matchRange({ page: 0, start: { item: 0, offset: 0 }, end: { item: 1, offset: 1 } }, spans)).toBeNull();
        expect(matchRange({ page: 0, start: { item: 1, offset: 0 }, end: { item: 1, offset: 5 } }, spans)).toBeNull();
    });
});

describe('createPdfFind', () => {
    it('finds a phrase put in from outside and steps to its first match, and does nothing while Find is off', async () => {
        const { find, reveals } = mount();
        find.find('lease');

        expect(input().value).toBe('');
        find.setDocument(cacheOf());
        find.find('LEASE IS');
        await flushAsync();

        expect(input().value).toBe('LEASE IS');
        expect(count()).toBe('1 of 1');
        expect(reveals.map((match) => match.page)).toEqual([2]);
    });

    it('stays off until a document is given, and searches every page, drawn or not', async () => {
        const { find, reveals } = mount();

        expect(input().disabled).toBe(true);
        find.setDocument(cacheOf());
        await typeAsync('lease');

        expect(input().disabled).toBe(false);
        expect(count()).toBe('1 of 3');
        expect(reveals.map((match) => match.page)).toEqual([0]);
    });

    it('matches across the items of a line, ignoring case', async () => {
        const { find } = mount();
        find.setDocument(cacheOf());
        await typeAsync('LEASE IS');

        expect(count()).toBe('1 of 1');
    });

    it('steps with Enter and Shift+Enter, wrapping round, and brings each match into view', async () => {
        const { find, reveals } = mount();
        find.setDocument(cacheOf());
        await typeAsync('lease');
        pressKey(input(), 'Enter');
        pressKey(input(), 'Enter');

        expect(count()).toBe('3 of 3');
        pressKey(input(), 'Enter');

        expect(count()).toBe('1 of 3');
        pressKey(input(), 'Enter', { shiftKey: true });

        expect(count()).toBe('3 of 3');
        expect(reveals.map((match) => [match.page, match.start.item])).toEqual([[0, 1], [2, 0], [2, 1], [0, 1], [2, 1]]);
    });

    it('says No matches, and turns the arrows off', async () => {
        const { find } = mount();
        find.setDocument(cacheOf());
        await typeAsync('nowhere');

        expect(count()).toBe('No matches');
        expect((scope.querySelector('[data-action="find-next"]') as HTMLButtonElement).disabled).toBe(true);
    });

    it('says the PDF has no text to search when no page has any, as in a scan, once the search reaches the end', async () => {
        const { find } = mount();
        find.setDocument(cacheOf([[], ['   '], []]));
        await typeAsync('lease');

        expect(count()).toBe('This PDF has no text to search');
        expect(scope.querySelector<HTMLElement>('.document-find')?.dataset['state']).toBe('none');
        expect((scope.querySelector('[data-action="find-next"]') as HTMLButtonElement).disabled).toBe(true);
    });

    it('still says No matches when only some pages have text', async () => {
        const { find } = mount();
        find.setDocument(cacheOf([[], ['Signed copy'], []]));
        await typeAsync('lease');

        expect(count()).toBe('No matches');
    });

    it('highlights the matches on the pages laid out, the current one apart, as layers come and go', async () => {
        const { find, highlighter } = mount();
        find.setDocument(cacheOf());
        find.setTextLayer(2, spansOf(PAGES[2] ?? []));
        await typeAsync('lease');

        expect(highlighter.shown.at(-1)).toEqual({ texts: ['Lease', 'LEASE'], current: null });
        find.setTextLayer(0, spansOf(PAGES[0] ?? []));

        expect(highlighter.shown.at(-1)).toEqual({ texts: ['Lease', 'LEASE', 'lease'], current: 'lease' });
        pressKey(input(), 'Enter');

        expect(highlighter.shown.at(-1)?.current).toBe('Lease');
        find.setTextLayer(2, null);

        expect(highlighter.shown.at(-1)).toEqual({ texts: ['lease'], current: null });
    });

    it('clears the box, the count and the highlights with Escape', async () => {
        const { find, highlighter } = mount();
        find.setDocument(cacheOf());
        find.setTextLayer(0, spansOf(PAGES[0] ?? []));
        await typeAsync('lease');
        pressKey(input(), 'Escape');
        await flushAsync();

        expect(input().value).toBe('');
        expect(count()).toBe('');
        expect(highlighter.shown.at(-1)).toEqual({ texts: [], current: null });
    });

    it('says how far a slow search has got, and stops when the query changes', async () => {
        let time = 0;
        const waiting: Array<() => void> = [];
        const read = vi.fn(async (index: number) => {
            await new Promise<void>((resolve) => waiting.push(resolve));

            return itemsOf(PAGES[index] ?? []);
        });
        const { find } = mount({ now: () => time });
        find.setDocument(createPageTextCache(3, read));
        await typeAsync('lease');

        expect(count()).toBe('');
        time = PROGRESS_DELAY_MS;
        waiting.shift()?.();
        await flushAsync();

        expect(count()).toBe('Searching… 1 of 3 pages');
        await typeAsync('contract');
        waiting.shift()?.();
        await flushAsync();
        waiting.shift()?.();
        waiting.shift()?.();
        await flushAsync();

        expect(read).toHaveBeenCalledTimes(3);
        expect(count()).toBe('1 of 1');
    });

    it('keeps the query and the current match for the tab, and finds them again without moving the view', async () => {
        const memory = {};
        const first = mount({ memory });
        first.find.setDocument(cacheOf());
        await typeAsync('lease');
        pressKey(input(), 'Enter');
        first.find.destroy();
        first.find.element.remove();

        const second = mount({ memory });

        expect(input().value).toBe('lease');
        second.find.setDocument(cacheOf());
        await flushAsync();

        expect(count()).toBe('2 of 3');
        expect(second.reveals).toEqual([]);
    });

    it('turns off while there is no document, such as while a password is asked for', async () => {
        const { find } = mount();
        find.setDocument(cacheOf());
        await typeAsync('lease');
        find.setDocument(null);
        await flushAsync();

        expect(input().disabled).toBe(true);
        expect(count()).toBe('');
    });

    it('registers its highlights under the PDF names, which only tint the page', async () => {
        const registry = new Map<string, { readonly ranges: Range[] }>();
        vi.stubGlobal('CSS', { highlights: registry });
        vi.stubGlobal('Highlight', class {
            readonly ranges: Range[];

            constructor(...ranges: Range[]) {
                this.ranges = ranges;
            }
        });
        const find = createPdfFind({ shortcutScope: scope, memory: {}, onReveal: () => {} });
        finds.push(find);
        scope.append(find.element);
        find.setDocument(cacheOf());
        find.setTextLayer(0, spansOf(PAGES[0] ?? []));
        await typeAsync('lease');

        expect([...registry.keys()]).toEqual([PDF_FIND_HIGHLIGHT, PDF_FIND_CURRENT_HIGHLIGHT]);
        expect(registry.get(PDF_FIND_CURRENT_HIGHLIGHT)?.ranges.map((range) => range.toString())).toEqual(['lease']);
        find.destroy();

        expect(registry.size).toBe(0);
    });
});
