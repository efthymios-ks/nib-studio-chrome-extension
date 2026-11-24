import {
    findInPage,
    foldQuery,
    hasSearchableText,
    searchablePage,
    type PdfMatch,
    type PdfTextItem,
    type SearchablePage,
} from '../../common/pdf/pdfTextSearch.js';
import { pageCountLabel } from '../../common/pdf/pageSelection.js';
import { createFindHighlighter, type FindHighlighter } from './documentFind.js';
import { createFindBox, matchSummary, type FindSummary } from './findBox.js';

// Find in a PDF: the whole document is searched, not only the pages drawn, ignoring case and accents.
// Each page's text is read from pdf.js the first time a search needs it and kept while the document is open.
// Matches show on the pages drawn through their text layers, and the current one is marked apart.

export const PDF_FIND_HIGHLIGHT = 'nib-pdf-find';
export const PDF_FIND_CURRENT_HIGHLIGHT = 'nib-pdf-find-current';

// A search still reading pages' text after this long says how far it has got.
export const PROGRESS_DELAY_MS = 150;

const EMPTY_PAGE = searchablePage([]);

// The text of a document's pages, ready to search, each read once.
export interface PageTextCache {
    readonly pageCount: number;
    // The page's text if it has been read already.
    peek(index: number): SearchablePage | undefined;
    readAsync(index: number): Promise<SearchablePage>;
}

// A page whose text can't be read has nothing to find; two searches asking for one page read it once.
export function createPageTextCache(
    pageCount: number,
    readItemsAsync: (index: number) => Promise<ReadonlyArray<PdfTextItem>>,
): PageTextCache {
    const pages = new Map<number, SearchablePage>();
    const pending = new Map<number, Promise<SearchablePage>>();

    const readItemsOrNoneAsync = async (index: number): Promise<ReadonlyArray<PdfTextItem>> => {
        try {
            return await readItemsAsync(index);
        }
        catch {
            return [];
        }
    };

    const readPageAsync = async (index: number): Promise<SearchablePage> => {
        const items = await readItemsOrNoneAsync(index);
        const page = items.length === 0 ? EMPTY_PAGE : searchablePage(items);
        pages.set(index, page);
        pending.delete(index);

        return page;
    };

    return {
        pageCount,
        peek: (index) => pages.get(index),
        readAsync: async (index) => {
            const known = pages.get(index);

            if (known != null) {
                return known;
            }

            const reading = pending.get(index) ?? readPageAsync(index);
            pending.set(index, reading);

            return await reading;
        },
    };
}

export interface SearchProgress {
    readonly query: string;
    readonly total: number;
    readonly current: number;
    readonly searchedPages: number;
    readonly pageCount: number;
    readonly isDone: boolean;
    // Whether the search has run long enough to say how far it has got.
    readonly showsProgress: boolean;
    // Whether any page searched so far has text; a scanned PDF has none on any page.
    readonly hasText: boolean;
}

// "1,204 of 3,310", "No matches", "Searching… 12 of 32 pages" while a long search reads the pages,
// or nothing.
// A PDF with no text on any page, such as a scan, says so once every page is searched.
export function findSummary(progress: SearchProgress): FindSummary {
    if (progress.query.trim() === '') {
        return { text: '', state: 'idle' };
    }

    if (!progress.isDone) {
        const searched = progress.searchedPages.toLocaleString('en-US');
        const text = progress.showsProgress ? `Searching… ${searched} of ${pageCountLabel(progress.pageCount)}` : '';

        return { text, state: 'searching' };
    }

    if (progress.total === 0 && !progress.hasText) {
        return { text: 'This PDF has no text to search', state: 'none' };
    }

    return matchSummary(progress.query, progress.total, progress.current);
}

// The match after or before `current`, wrapping round once every page has been searched;
// while pages are still being read, the last match found so far stays put.
export function stepMatch(current: number, total: number, direction: 1 | -1, isDone: boolean): number {
    if (total <= 0) {
        return -1;
    }

    if (current < 0) {
        return direction > 0 || !isDone ? 0 : total - 1;
    }

    const next = current + direction;

    if (next >= 0 && next < total) {
        return next;
    }

    return isDone ? (next + total) % total : current;
}

// The range a match covers in a page's text layer, whose spans follow the page's text items one for one.
export function matchRange(match: PdfMatch, spans: ReadonlyArray<HTMLElement>): Range | null {
    const startNode = spans[match.start.item]?.firstChild;
    const endNode = spans[match.end.item]?.firstChild;

    if (startNode?.nodeType !== Node.TEXT_NODE || endNode?.nodeType !== Node.TEXT_NODE) {
        return null;
    }

    const startText = startNode as Text;
    const endText = endNode as Text;

    if (match.start.offset > startText.length || match.end.offset > endText.length) {
        return null;
    }

    const range = startText.ownerDocument.createRange();
    range.setStart(startText, match.start.offset);
    range.setEnd(endText, match.end.offset);

    return range;
}

// The query and the current match of a tab, kept while it stays open.
interface FindMemory {
    readonly query: string;
    readonly current: number;
}

const findMemories = new WeakMap<object, FindMemory>();

export interface PdfFindOptions {
    // The preview whose Ctrl+F goes to the box.
    readonly shortcutScope: HTMLElement;
    // The tab's preview memory, which keeps the query and the current match until the tab closes.
    readonly memory: object;
    // Brings a match into view; called when typing finds the first match and on each step.
    readonly onReveal: (match: PdfMatch) => void;
    readonly now?: () => number;
    readonly highlighter?: FindHighlighter;
}

export interface PdfFind {
    // The box, for the toolbar.
    readonly element: HTMLElement;
    // Searches this document's text; null turns Find off, such as while a password is asked for.
    setDocument(pages: PageTextCache | null): void;
    // The spans of a page's text layer once it is laid out, or null when it is let go.
    setTextLayer(index: number, spans: ReadonlyArray<HTMLElement> | null): void;
    // Puts a phrase in the box and steps to its first match, as typing it would; does nothing while Find is off.
    find(query: string): void;
    destroy(): void;
}

export function createPdfFind(options: PdfFindOptions): PdfFind {
    const now = options.now ?? (() => performance.now());
    const highlighter = options.highlighter ?? createFindHighlighter({
        all: PDF_FIND_HIGHLIGHT,
        current: PDF_FIND_CURRENT_HIGHLIGHT,
    });
    const layers = new Map<number, ReadonlyArray<HTMLElement>>();
    // Each page's matches, as indexes into `matches`.
    const matchesByPage = new Map<number, number[]>();
    let pages: PageTextCache | null = null;
    let generation = 0;
    let matches: PdfMatch[] = [];
    let current = -1;
    let searchedPages = 0;
    let isDone = true;
    let showsProgress = false;
    let hasText = false;

    const box = createFindBox({
        shortcutScope: options.shortcutScope,
        onQuery: () => void searchAsync({ shouldReveal: true, wanted: 0 }),
        onStep: (direction) => step(direction),
    });
    box.setQuery(findMemories.get(options.memory)?.query ?? '');

    const remember = (): void => {
        findMemories.set(options.memory, { query: box.getQuery(), current: Math.max(0, current) });
    };

    const describe = (): void => {
        if (pages == null) {
            box.show({ text: '', state: 'idle' }, false);

            return;
        }

        const summary = findSummary({
            query: box.getQuery(),
            total: matches.length,
            current,
            searchedPages,
            pageCount: pages.pageCount,
            isDone,
            showsProgress,
            hasText,
        });
        box.show(summary, matches.length > 0);
    };

    // Every match on the pages whose text layer is laid out, with the current one marked apart.
    const redraw = (): void => {
        const ranges: Range[] = [];
        let currentRange = -1;

        for (const [page, spans] of layers) {
            for (const index of matchesByPage.get(page) ?? []) {
                const match = matches[index];
                const range = match == null ? null : matchRange(match, spans);

                if (range == null) {
                    continue;
                }

                if (index === current) {
                    currentRange = ranges.length;
                }

                ranges.push(range);
            }
        }

        if (ranges.length === 0) {
            highlighter.clear();

            return;
        }

        highlighter.show(ranges, currentRange);
    };

    const reveal = (): void => {
        const match = matches[current];

        if (match != null) {
            options.onReveal(match);
        }
    };

    const reset = (): void => {
        matches = [];
        matchesByPage.clear();
        current = -1;
        searchedPages = 0;
        hasText = false;
    };

    // Searches page by page in reading order, so typing again, which starts a new search, stops this one.
    // `wanted` is the match to make current once it is found, such as the one remembered for the tab.
    const searchAsync = async (request: { readonly shouldReveal: boolean; readonly wanted: number }): Promise<void> => {
        generation += 1;
        const token = generation;
        const needle = foldQuery(box.getQuery());
        const source = pages;
        reset();
        isDone = source == null || needle === '';
        showsProgress = false;
        findMemories.set(options.memory, { query: box.getQuery(), current: request.wanted });
        redraw();
        describe();

        if (source == null || needle === '') {
            return;
        }

        const startedAt = now();

        for (let index = 0; index < source.pageCount; index += 1) {
            const page = source.peek(index) ?? await source.readAsync(index);

            if (token !== generation) {
                return;
            }

            const found = findInPage(page, needle, index);
            hasText ||= hasSearchableText(page);

            if (found.length > 0) {
                matchesByPage.set(index, found.map((_, offset) => matches.length + offset));
                matches.push(...found);
            }

            searchedPages = index + 1;
            const isWantedFound = current < 0 && matches.length > request.wanted;

            if (isWantedFound) {
                current = request.wanted;
            }

            if (isWantedFound || (found.length > 0 && layers.has(index))) {
                redraw();
            }

            if (isWantedFound && request.shouldReveal) {
                reveal();
            }

            showsProgress ||= now() - startedAt >= PROGRESS_DELAY_MS;
            describe();
        }

        isDone = true;

        if (current < 0 && matches.length > 0) {
            current = Math.min(request.wanted, matches.length - 1);
            redraw();
        }

        describe();
        remember();
    };

    const step = (direction: 1 | -1): void => {
        if (matches.length === 0) {
            return;
        }

        current = stepMatch(current, matches.length, direction, isDone);
        redraw();
        describe();
        remember();
        reveal();
    };

    describe();

    return {
        element: box.element,
        setDocument: (next) => {
            pages = next;
            layers.clear();
            box.setEnabled(next != null);
            // A document that reloads, or a tab coming back,
            // finds the same query again without moving the view.
            void searchAsync({ shouldReveal: false, wanted: findMemories.get(options.memory)?.current ?? 0 });
        },
        find: (query) => {
            if (pages == null) {
                return;
            }

            box.setQuery(query);
            void searchAsync({ shouldReveal: true, wanted: 0 });
        },
        setTextLayer: (index, spans) => {
            if (spans == null) {
                layers.delete(index);
            }
            else {
                layers.set(index, spans);
            }

            if (matchesByPage.has(index)) {
                redraw();
            }
        },
        destroy: () => {
            generation += 1;
            highlighter.clear();
            box.destroy();
        },
    };
}
