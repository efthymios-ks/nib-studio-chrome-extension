// Links inside a PDF: where an internal link goes, and where its box sits on the page.
// Links to web pages, files and scripts are left out, so the preview never leaves the document.

export type NamedPageAction = 'first' | 'last' | 'next' | 'previous';

export type LinkTarget =
    | { readonly kind: 'destination'; readonly destination: string | ReadonlyArray<unknown> }
    | { readonly kind: 'named'; readonly action: NamedPageAction };

// The page actions of a PDF link that move within the document.
const NAMED_ACTIONS: Readonly<Record<string, NamedPageAction>> = Object.freeze({
    FirstPage: 'first',
    LastPage: 'last',
    NextPage: 'next',
    PrevPage: 'previous',
});

// What a link annotation, as pdf.js reads it, goes to inside the document;
// null for any other link or annotation.
export function internalLinkTarget(annotation: Readonly<Record<string, unknown>>): LinkTarget | null {
    if (
        annotation['subtype'] !== 'Link'
        || annotation['url'] != null
        || annotation['unsafeUrl'] != null
    ) {
        return null;
    }

    const destination = annotation['dest'];

    if (typeof destination === 'string' && destination !== '') {
        return { kind: 'destination', destination };
    }

    if (Array.isArray(destination) && destination.length > 0) {
        return { kind: 'destination', destination };
    }

    const action = typeof annotation['action'] === 'string' ? NAMED_ACTIONS[annotation['action']] : undefined;

    return action == null ? null : { kind: 'named', action };
}

export interface PageReference {
    readonly num: number;
    readonly gen: number;
}

// A destination spelled out: its page, by reference or by index,
// and the point in PDF units to show at the top left, where given.
export interface ExplicitDestination {
    readonly page: { readonly reference: PageReference } | { readonly index: number };
    readonly left: number | null;
    readonly top: number | null;
}

interface FitCoordinates {
    readonly left: number | null;
    readonly top: number | null;
}

// The arguments after the fit name that hold the left edge and the top edge, by fit.
const FIT_COORDINATES: Readonly<Record<string, FitCoordinates>> = Object.freeze({
    XYZ: { left: 0, top: 1 },
    Fit: { left: null, top: null },
    FitB: { left: null, top: null },
    FitH: { left: null, top: 0 },
    FitBH: { left: null, top: 0 },
    FitV: { left: 0, top: null },
    FitBV: { left: 0, top: null },
    FitR: { left: 0, top: 3 },
});

// Reads [page, /Fit, ...arguments]; null for anything else.
export function parseExplicitDestination(destination: unknown): ExplicitDestination | null {
    if (!Array.isArray(destination) || destination.length < 2) {
        return null;
    }

    const page = pageOf(destination[0]);
    const fitName = (destination[1] as { name?: unknown } | null)?.name;
    const fit = typeof fitName === 'string' ? FIT_COORDINATES[fitName] : undefined;

    if (page == null || fit == null) {
        return null;
    }

    const argumentsAfterFit = destination.slice(2);
    const coordinate = (position: number | null): number | null => {
        const value = position == null ? null : argumentsAfterFit[position];

        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    };

    return { page, left: coordinate(fit.left), top: coordinate(fit.top) };
}

function pageOf(value: unknown): ExplicitDestination['page'] | null {
    if (Number.isInteger(value) && (value as number) >= 0) {
        return { index: value as number };
    }

    const reference = value as Partial<PageReference> | null;

    if (typeof reference?.num === 'number' && typeof reference.gen === 'number') {
        return { reference: { num: reference.num, gen: reference.gen } };
    }

    return null;
}

// The page a named action goes to, kept within the document.
export function namedActionPage(action: NamedPageAction, current: number, pageCount: number): number {
    const last = Math.max(0, pageCount - 1);
    const targets: Readonly<Record<NamedPageAction, number>> = {
        first: 0,
        last,
        next: Math.min(last, current + 1),
        previous: Math.max(0, current - 1),
    };

    return targets[action];
}

export interface PercentBox {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

// A rectangle in page pixels, its corners in any order, as percentages of the page,
// so it keeps its place at every zoom.
export function percentBox(
    rectangle: ReadonlyArray<number>,
    pageWidth: number,
    pageHeight: number,
): PercentBox | null {
    const [x1, y1, x2, y2] = rectangle;

    if (
        x1 == null
        || y1 == null
        || x2 == null
        || y2 == null
        || pageWidth <= 0
        || pageHeight <= 0
    ) {
        return null;
    }

    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);

    if (width <= 0 || height <= 0) {
        return null;
    }

    return {
        left: (100 * Math.min(x1, x2)) / pageWidth,
        top: (100 * Math.min(y1, y2)) / pageHeight,
        width: (100 * width) / pageWidth,
        height: (100 * height) / pageHeight,
    };
}
