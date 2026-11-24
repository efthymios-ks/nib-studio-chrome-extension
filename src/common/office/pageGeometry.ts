// A page's width and margins in CSS pixels at 100%, so the preview lays text out on paper of the document's size.
export interface PageGeometry {
    readonly width: number;
    // The height of a sheet, which the page is at least as tall as.
    readonly height: number;
    readonly marginTop: number;
    readonly marginRight: number;
    readonly marginBottom: number;
    readonly marginLeft: number;
}

// Word measures pages in twentieths of a point; 96 CSS pixels make an inch of 1,440 twips.
export const TWIPS_PER_PIXEL = 15;

// US Letter with one-inch margins, Word's page when a file says nothing.
const DEFAULT_PAGE: PageGeometry = Object.freeze({
    width: 816,
    height: 1056,
    marginTop: 96,
    marginRight: 96,
    marginBottom: 96,
    marginLeft: 96,
});

// Pages narrower or wider than this are taken as damaged values and shown at the default width.
const MIN_PAGE_WIDTH = 240;
const MAX_PAGE_WIDTH = 2400;

// Keeps a page usable: a sane width, and margins that leave at least half of it for text.
export function sanitizePage(page: PageGeometry | null): PageGeometry {
    if (page == null || !Number.isFinite(page.width) || page.width < MIN_PAGE_WIDTH || page.width > MAX_PAGE_WIDTH) {
        return DEFAULT_PAGE;
    }

    const side = (value: number): number => (Number.isFinite(value) ? Math.min(Math.max(0, value), page.width / 4) : 96);

    const height = Number.isFinite(page.height) && page.height >= page.width / 4 && page.height <= MAX_PAGE_WIDTH * 2
        ? page.height
        : page.width * 1.294;

    return {
        width: Math.round(page.width),
        height: Math.round(height),
        marginTop: Math.round(side(page.marginTop)),
        marginRight: Math.round(side(page.marginRight)),
        marginBottom: Math.round(side(page.marginBottom)),
        marginLeft: Math.round(side(page.marginLeft)),
    };
}
