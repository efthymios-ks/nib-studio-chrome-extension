// The arithmetic of the PDF preview: where each page sits, which page is being read,
// which pages to draw or let go, and how many pixels a page's canvas may have.
// Offsets and sizes are in CSS pixels at 100%, where a PDF point is 96 / 72 pixels, like Chrome's own viewer.

export const CSS_PIXELS_PER_POINT = 96 / 72;

// The space between two pages at 100%; it zooms with them.
export const PAGE_GAP = 12;

// A page canvas never has more pixels than this, nor a side longer than MAX_CANVAS_SIDE,
// so a page zoomed far in costs at most 64 MB.
export const MAX_CANVAS_PIXELS = 16_777_216;
const MAX_CANVAS_SIDE = 16_384;

// The canvases kept drawn together hold at most this many pixels;
// the pages farthest from the one being read go first.
const DRAWN_PIXEL_BUDGET = 80_000_000;

export interface PageSize {
    readonly width: number;
    readonly height: number;
}

export interface PlacedPage {
    readonly top: number;
    readonly left: number;
    readonly width: number;
    readonly height: number;
}

export interface PageLayout {
    readonly pages: ReadonlyArray<PlacedPage>;
    // The whole document at 100%: the widest page across, every page and gap down.
    readonly width: number;
    readonly height: number;
}

// Pages stacked top to bottom with a gap between them, each centred across the widest one.
export function layoutPages(sizes: ReadonlyArray<PageSize>): PageLayout {
    const width = sizes.reduce((widest, size) => Math.max(widest, size.width), 0);
    const pages: PlacedPage[] = [];
    let top = 0;

    for (const size of sizes) {
        pages.push({ top, left: (width - size.width) / 2, width: size.width, height: size.height });
        top += size.height + PAGE_GAP;
    }

    return { pages, width, height: Math.max(0, top - (sizes.length > 0 ? PAGE_GAP : 0)) };
}

// The page at a content offset: the one it falls on, or the next one when it falls in a gap;
// the last past the end.
export function pageIndexAt(layout: PageLayout, offset: number): number {
    const pages = layout.pages;
    let low = 0;
    let high = pages.length - 1;

    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        const page = pages[middle];

        if (page != null && page.top + page.height <= offset) {
            low = middle + 1;
        }
        else {
            high = middle;
        }
    }

    return Math.max(0, low);
}

// The page being read: the one that fills the most of the view from `top` to `bottom`, the first on a tie.
// At the very end of the document the last page counts, so a short last page can still become current.
export function currentPageIndex(layout: PageLayout, top: number, bottom: number): number {
    const count = layout.pages.length;

    if (count === 0) {
        return 0;
    }

    if (bottom >= layout.height - 0.5 && top > 0) {
        const last = layout.pages[count - 1];

        if (last != null && last.top < bottom) {
            return count - 1;
        }
    }

    let best = pageIndexAt(layout, top);
    let bestShown = -1;

    for (let index = best; index < count; index += 1) {
        const page = layout.pages[index];

        if (page == null || page.top >= bottom) {
            break;
        }

        const shown = Math.min(bottom, page.top + page.height) - Math.max(top, page.top);

        if (shown > bestShown + 0.5) {
            best = index;
            bestShown = shown;
        }
    }

    return best;
}

// The content offset that puts a page's top, less half a gap, at the top of the view;
// `within` moves further into the page.
export function pageOffset(layout: PageLayout, index: number, within = 0): number {
    const page = layout.pages[Math.min(Math.max(0, index), layout.pages.length - 1)];

    if (page == null) {
        return 0;
    }

    return within > 0 ? page.top + Math.min(within, page.height) : Math.max(0, page.top - PAGE_GAP / 2);
}

// The scale that shows one whole page in a view: its full height with half a gap above and below it,
// so the pages before and after stay just out of sight, or its full width less `padding` at each side when that is tighter.
// A small page is enlarged to fill the view.
export function fitPageScale(page: PageSize, view: PageSize, padding: number): number {
    if (page.width <= 0 || page.height <= 0) {
        return 1;
    }

    const across = (view.width - 2 * padding) / page.width;
    const down = view.height / (page.height + PAGE_GAP);
    const scale = Math.min(across, down);

    return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

// The content point at the middle of a page, at 100%: halfway across the document, as every page is centred in it.
export function pageCentre(layout: PageLayout, index: number): { readonly x: number; readonly y: number } | null {
    const page = layout.pages[index];

    return page == null ? null : { x: layout.width / 2, y: page.top + page.height / 2 };
}

// Below this zoom a page draws with at least SMALL_ZOOM_PIXEL_RATIO canvas pixels to each CSS pixel, since at one
// the thinnest strokes, such as the bars of a tiny superscript `#`, fall between pixels and vanish; from it the zoom
// itself gives them room.
const SMALL_ZOOM_BELOW = 1.5;
const SMALL_ZOOM_PIXEL_RATIO = 2;

export interface CanvasSize {
    // The page's size on screen, in CSS pixels.
    readonly cssWidth: number;
    readonly cssHeight: number;
    readonly devicePixelRatio: number;
    // The zoom the page is drawn at, 1 for 100%.
    readonly scale: number;
}

// Device pixels per CSS pixel for a page canvas this size: the screen's own ratio, or more at small zooms,
// lowered only as far as the pixel and side limits need.
export function canvasPixelRatio(size: CanvasSize): number {
    const { cssWidth, cssHeight, devicePixelRatio, scale } = size;
    const screen = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const wanted = scale < SMALL_ZOOM_BELOW ? Math.max(screen, SMALL_ZOOM_PIXEL_RATIO) : screen;

    if (cssWidth <= 0 || cssHeight <= 0) {
        return wanted;
    }

    const pixelLimit = Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight));
    const sideLimit = MAX_CANVAS_SIDE / Math.max(cssWidth, cssHeight);

    return Math.min(wanted, pixelLimit, sideLimit);
}

// The pages near the view, nearest the page being read first,
// so what is on screen is drawn before what is just off it; the earlier page first on a tie.
export function drawOrder(near: Iterable<number>, current: number): number[] {
    const distance = (index: number): number => Math.abs(index - current);

    return [...near].sort((left, right) => distance(left) - distance(right) || left - right);
}

// The first page in `order` not yet drawn at `scale`; pages that failed to draw are not tried again.
export function nextPageToDraw(
    order: ReadonlyArray<number>,
    drawnScales: ReadonlyMap<number, number>,
    scale: number,
    failed: ReadonlySet<number> = new Set(),
): number | null {
    return order.find((index) => !failed.has(index) && !isSameScale(drawnScales.get(index), scale)) ?? null;
}

function isSameScale(drawn: number | undefined, scale: number): boolean {
    return drawn != null && Math.abs(drawn - scale) <= scale * 1e-6;
}

export interface DrawnPage {
    readonly index: number;
    readonly pixels: number;
}

// The drawn pages to let go so the rest fit the pixel budget: never one near the view,
// and the farthest from the page being read first.
export function pagesOverBudget(
    drawn: ReadonlyArray<DrawnPage>,
    near: ReadonlySet<number>,
    current: number,
    budget: number = DRAWN_PIXEL_BUDGET,
): number[] {
    let total = drawn.reduce((sum, page) => sum + page.pixels, 0);
    const release: number[] = [];
    const candidates = drawn
        .filter((page) => !near.has(page.index))
        .sort((left, right) => Math.abs(right.index - current) - Math.abs(left.index - current));

    for (const page of candidates) {
        if (total <= budget) {
            break;
        }

        release.push(page.index);
        total -= page.pixels;
    }

    return release;
}
