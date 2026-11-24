import { describe, expect, it } from 'vitest';
import {
    canvasPixelRatio,
    currentPageIndex,
    drawOrder,
    fitPageScale,
    layoutPages,
    MAX_CANVAS_PIXELS,
    nextPageToDraw,
    PAGE_GAP,
    pageCentre,
    pageIndexAt,
    pageOffset,
    pagesOverBudget,
} from './pdfPageLayout.js';

const LETTER = { width: 816, height: 1056 };
const LANDSCAPE = { width: 1056, height: 816 };

describe('layoutPages', () => {
    it('stacks pages with a gap and centres each across the widest', () => {
        const layout = layoutPages([LETTER, LANDSCAPE, LETTER]);

        expect(layout.width).toBe(1056);
        expect(layout.height).toBe(1056 + 816 + 1056 + 2 * PAGE_GAP);
        expect(layout.pages).toEqual([
            { top: 0, left: 120, width: 816, height: 1056 },
            { top: 1056 + PAGE_GAP, left: 0, width: 1056, height: 816 },
            { top: 1056 + 816 + 2 * PAGE_GAP, left: 120, width: 816, height: 1056 },
        ]);
    });

    it('is empty without pages', () => {
        expect(layoutPages([])).toEqual({ pages: [], width: 0, height: 0 });
    });
});

describe('pageIndexAt', () => {
    const layout = layoutPages([LETTER, LETTER, LETTER]);

    it('finds the page an offset falls on', () => {
        expect(pageIndexAt(layout, 0)).toBe(0);
        expect(pageIndexAt(layout, 1055)).toBe(0);
        expect(pageIndexAt(layout, 1056 + PAGE_GAP + 10)).toBe(1);
        expect(pageIndexAt(layout, layout.height - 1)).toBe(2);
    });

    it('takes the next page in a gap and the last page past the end', () => {
        expect(pageIndexAt(layout, 1056 + PAGE_GAP / 2)).toBe(1);
        expect(pageIndexAt(layout, layout.height + 500)).toBe(2);
        expect(pageIndexAt(layout, -20)).toBe(0);
    });
});

describe('currentPageIndex', () => {
    const layout = layoutPages([LETTER, LETTER, LETTER, LETTER]);
    const top = (index: number): number => layout.pages[index]?.top ?? 0;

    it('is the page that fills the most of the view', () => {
        expect(currentPageIndex(layout, 0, 800)).toBe(0);
        expect(currentPageIndex(layout, top(1) - 300, top(1) + 500)).toBe(1);
        expect(currentPageIndex(layout, top(1) - 500, top(1) + 300)).toBe(0);
    });

    it('takes the first of two pages showing equally', () => {
        expect(currentPageIndex(layout, top(1) - 400 - PAGE_GAP / 2, top(1) + 400 - PAGE_GAP / 2)).toBe(0);
    });

    it('is the last page once the view reaches the end, however little of it shows', () => {
        expect(currentPageIndex(layout, layout.height - 900, layout.height)).toBe(3);
    });

    it('is the first page of an empty document', () => {
        expect(currentPageIndex(layoutPages([]), 0, 500)).toBe(0);
    });
});

describe('pageOffset', () => {
    const layout = layoutPages([LETTER, LETTER, LETTER]);

    it('puts the page top half a gap below the view top', () => {
        expect(pageOffset(layout, 0)).toBe(0);
        expect(pageOffset(layout, 2)).toBe(2 * (1056 + PAGE_GAP) - PAGE_GAP / 2);
    });

    it('goes further into the page, never past its end', () => {
        expect(pageOffset(layout, 1, 200)).toBe(1056 + PAGE_GAP + 200);
        expect(pageOffset(layout, 1, 5000)).toBe(1056 + PAGE_GAP + 1056);
    });

    it('keeps the index within the document', () => {
        expect(pageOffset(layout, 9)).toBe(pageOffset(layout, 2));
        expect(pageOffset(layout, -3)).toBe(0);
        expect(pageOffset(layoutPages([]), 0)).toBe(0);
    });
});

describe('canvasPixelRatio', () => {
    const page = { cssWidth: 816, cssHeight: 1056 };

    it('is the screen\'s ratio for a page zoomed to 150% or more', () => {
        expect(canvasPixelRatio({ ...page, devicePixelRatio: 1, scale: 1.5 })).toBe(1);
        expect(canvasPixelRatio({ ...page, devicePixelRatio: 2.5, scale: 2 })).toBe(2.5);
    });

    it('is at least 2 below 150%, so the thinnest strokes of small text survive on a 1x screen', () => {
        expect(canvasPixelRatio({ ...page, devicePixelRatio: 1, scale: 1 })).toBe(2);
        expect(canvasPixelRatio({ ...page, devicePixelRatio: 1.25, scale: 0.5 })).toBe(2);
        expect(canvasPixelRatio({ ...page, devicePixelRatio: 3, scale: 1 })).toBe(3);
    });

    it('is lowered so a page zoomed far in stays within the pixel limit', () => {
        const ratio = canvasPixelRatio({ cssWidth: 816 * 8, cssHeight: 1056 * 8, devicePixelRatio: 2, scale: 8 });

        expect(ratio).toBeLessThan(2);
        expect((816 * 8 * ratio) * (1056 * 8 * ratio)).toBeCloseTo(MAX_CANVAS_PIXELS, -2);
    });

    it('is lowered so no side passes the side limit', () => {
        expect(canvasPixelRatio({ cssWidth: 100, cssHeight: 40_000, devicePixelRatio: 1, scale: 2 })).toBeCloseTo(16_384 / 40_000, 10);
    });

    it('falls back to the screen ratio 1 for a ratio that makes no sense', () => {
        expect(canvasPixelRatio({ ...page, devicePixelRatio: Number.NaN, scale: 2 })).toBe(1);
        expect(canvasPixelRatio({ ...page, devicePixelRatio: 0, scale: 2 })).toBe(1);
        expect(canvasPixelRatio({ cssWidth: 0, cssHeight: 0, devicePixelRatio: 2, scale: 2 })).toBe(2);
    });
});

describe('drawOrder', () => {
    it('puts the page being read first, then the nearest, earlier first on a tie', () => {
        expect(drawOrder(new Set([2, 3, 4, 5, 6]), 4)).toEqual([4, 3, 5, 2, 6]);
    });
});

describe('nextPageToDraw', () => {
    it('is the first page not drawn at the current zoom', () => {
        const drawn = new Map([[4, 1.5], [3, 1.5], [5, 1]]);

        expect(nextPageToDraw([4, 3, 5, 2], drawn, 1.5)).toBe(5);
        expect(nextPageToDraw([4, 3], drawn, 1.5)).toBeNull();
        expect(nextPageToDraw([4, 3], drawn, 2)).toBe(4);
    });

    it('never tries a page that failed again', () => {
        expect(nextPageToDraw([1, 2], new Map(), 1, new Set([1]))).toBe(2);
        expect(nextPageToDraw([1], new Map(), 1, new Set([1]))).toBeNull();
    });
});

describe('pagesOverBudget', () => {
    const drawn = [0, 1, 2, 3, 8, 9].map((index) => ({ index, pixels: 100 }));

    it('lets nothing go within the budget', () => {
        expect(pagesOverBudget(drawn, new Set([2, 3]), 2, 600)).toEqual([]);
    });

    it('lets the farthest pages go first until the rest fit', () => {
        expect(pagesOverBudget(drawn, new Set([2, 3]), 2, 400)).toEqual([9, 8]);
    });

    it('never lets a page near the view go', () => {
        expect(pagesOverBudget(drawn, new Set([0, 1, 2, 3, 8, 9]), 2, 100)).toEqual([]);
    });
});

describe('fitPageScale', () => {
    it('fits a page and one gap to the height of the view, so the pages beside it stay out of sight', () => {
        const scale = fitPageScale(LETTER, { width: 1600, height: 900 }, 16);

        expect(scale).toBeCloseTo(900 / (1056 + PAGE_GAP), 10);
        expect(LETTER.height * scale + PAGE_GAP * scale).toBeCloseTo(900, 6);
    });

    it('fits the width less the padding when that is tighter', () => {
        expect(fitPageScale(LANDSCAPE, { width: 600, height: 900 }, 16)).toBeCloseTo((600 - 32) / 1056, 10);
    });

    it('enlarges a small page to fill the view, and gives 100% for a page with no size', () => {
        expect(fitPageScale({ width: 200, height: 300 }, { width: 1600, height: 900 }, 16)).toBeGreaterThan(2);
        expect(fitPageScale({ width: 0, height: 0 }, { width: 1600, height: 900 }, 16)).toBe(1);
        expect(fitPageScale(LETTER, { width: 0, height: 0 }, 16)).toBe(1);
    });
});

describe('pageCentre', () => {
    it('is halfway across the document and halfway down the page', () => {
        const layout = layoutPages([LETTER, LANDSCAPE, LETTER]);

        expect(pageCentre(layout, 1)).toEqual({ x: 528, y: 1056 + PAGE_GAP + 408 });
        expect(pageCentre(layout, 3)).toBeNull();
    });
});
