// Stand-ins for pdf.js at the preview's boundary: a document of pages of given sizes, and an engine
// whose drawing and text layers the test finishes by hand, since happy-dom draws on no canvas.
import { vi, type Mock } from 'vitest';
import type { PageObserverFactory } from '../views/pdfDocumentView.js';
import type { PdfDocument, PdfEngine, PdfOpenOptions, PdfPage, PdfTextTask } from '../views/pdfEngine.js';
import { PdfPasswordCancelledError } from '../views/pdfEngine.js';

export interface FakePdfOptions {
    // Each page's size in points.
    readonly pages: ReadonlyArray<readonly [width: number, height: number]>;
    readonly annotations?: Readonly<Record<number, ReadonlyArray<Readonly<Record<string, unknown>>>>>;
    readonly destinations?: Readonly<Record<string, ReadonlyArray<unknown>>>;
    // Page indexes by reference number.
    readonly references?: Readonly<Record<number, number>>;
    readonly info?: Readonly<Record<string, unknown>>;
    readonly markInfo?: unknown;
    readonly permissions?: ReadonlySet<number> | null;
    // Each page's text items by page index, a string for an item that doesn't end its line;
    // a page without any has one item, "Text of page n".
    readonly texts?: Readonly<Record<number, ReadonlyArray<FakeTextItem>>>;
}

export type FakeTextItem = string | { readonly str: string; readonly hasEOL: boolean };

type FakePage = PdfPage & {
    readonly cleanup: Mock<() => boolean>;
    readonly getTextContent: Mock<() => Promise<unknown>>;
};

export interface FakePdf {
    readonly document: PdfDocument;
    readonly pages: ReadonlyArray<FakePage>;
    readonly destroy: Mock<() => Promise<void>>;
}

function textItemsOf(page: PdfPage): ReadonlyArray<{ readonly str: string; readonly hasEOL: boolean }> {
    return (page as unknown as { textItems: ReadonlyArray<{ str: string; hasEOL: boolean }> }).textItems;
}

export function createFakePdf(options: FakePdfOptions): FakePdf {
    const pages = options.pages.map(([width, height], index): FakePage => {
        const viewportAt = (scale: number): unknown => ({
            width: width * scale,
            height: height * scale,
            scale,
            rotation: 0,
            convertToViewportPoint: (pointX: number, pointY: number) => [
                pointX * scale,
                (height - pointY) * scale,
            ],
        });

        const textItems = (options.texts?.[index] ?? [`Text of page ${index + 1}`])
            .map((item) => (typeof item === 'string' ? { str: item, hasEOL: false } : item));

        return {
            pageNumber: index + 1,
            view: [0, 0, width, height],
            rotate: 0,
            userUnit: 1,
            textItems,
            getViewport: ({ scale }: { scale: number }) => viewportAt(scale),
            getAnnotations: vi.fn(async () => options.annotations?.[index] ?? []),
            // pdf.js puts the marks of the document's structure among the items when asked to.
            getTextContent: vi.fn(async () => ({
                items: [{ type: 'beginMarkedContent', tag: 'P' }, ...textItems, { type: 'endMarkedContent' }],
                styles: {},
                lang: null,
            })),
            cleanup: vi.fn(() => true),
        } as unknown as FakePage;
    });
    const destroy = vi.fn(async () => {});
    const info = { PDFFormatVersion: '1.7', IsLinearized: false, ...options.info };
    const document = {
        numPages: pages.length,
        loadingTask: { destroy },
        getPage: vi.fn(async (number: number) => {
            const page = pages[number - 1];

            if (page == null) {
                throw new Error(`No page ${number}`);
            }

            return page;
        }),
        getDestination: vi.fn(async (name: string) => options.destinations?.[name] ?? null),
        getPageIndex: vi.fn(async (reference: { num: number }) => options.references?.[reference.num] ?? -1),
        getMetadata: vi.fn(async () => ({ info, metadata: null })),
        getPermissions: vi.fn(async () => options.permissions ?? null),
        getMarkInfo: vi.fn(async () => options.markInfo ?? null),
    } as unknown as PdfDocument;

    return { document, pages, destroy };
}

export interface FakeDraw {
    readonly page: number;
    readonly pixelsPerPoint: number;
    readonly canvas: HTMLCanvasElement;
    readonly cancel: Mock<() => void>;
    finish(): void;
    fail(error: unknown): void;
}

export interface FakeEngine {
    readonly engine: PdfEngine;
    readonly draws: FakeDraw[];
    readonly texts: Array<{ readonly page: number; readonly cancel: Mock<() => void> }>;
    readonly openAsync: Mock<(data: Uint8Array, options: PdfOpenOptions) => Promise<PdfDocument>>;
    // Finishes every draw in progress, oldest first, and lets the next ones start; returns the pages drawn.
    finishDrawsAsync(): Promise<number[]>;
}

function pageNumberOf(page: PdfPage): number {
    return (page as unknown as { pageNumber: number }).pageNumber;
}

// An engine that opens `pdf`, or asks for `password` first when one is given;
// a cancelled prompt rejects as pdf.js does.
export function createFakeEngine(pdf: FakePdf | (() => FakePdf), password?: string): FakeEngine {
    const draws: FakeDraw[] = [];
    // Draws already finished or failed, which finishDrawsAsync leaves alone.
    const settled = new WeakSet<FakeDraw>();
    const texts: FakeEngine['texts'] = [];
    const resolvePdf = (): FakePdf => (typeof pdf === 'function' ? pdf() : pdf);
    const openAsync = vi.fn(async (_data: Uint8Array, options: PdfOpenOptions) => {
        if (password != null) {
            let reason: 'needed' | 'incorrect' = 'needed';

            for (;;) {
                const given = await options.promptPasswordAsync(reason);

                if (given == null) {
                    throw new PdfPasswordCancelledError();
                }

                if (given === password) {
                    break;
                }

                reason = 'incorrect';
            }
        }

        return resolvePdf().document;
    });
    const engine: PdfEngine = {
        openAsync,
        drawPage: (page, canvas, pixelsPerPoint) => {
            let finish = (): void => {};
            let fail = (_error: unknown): void => {};
            const promise = new Promise<void>((resolve, reject) => {
                finish = resolve;
                fail = reject;
            });
            canvas.width = Math.floor(page.view[2] as number * pixelsPerPoint);
            canvas.height = Math.floor(page.view[3] as number * pixelsPerPoint);
            const draw: FakeDraw = {
                page: pageNumberOf(page),
                pixelsPerPoint,
                canvas,
                cancel: vi.fn(() => {
                    settled.add(draw);
                    fail(Object.assign(new Error('Rendering cancelled'), {
                        name: 'RenderingCancelledException',
                    }));
                }),
                finish: () => finish(),
                fail: (error) => {
                    settled.add(draw);
                    fail(error);
                },
            };
            draws.push(draw);

            return { promise, cancel: () => draw.cancel() };
        },
        // Lays the text out as pdf.js does: a span for each item, kept out of the page when empty, and a line break after an item that ends its line.
        renderText: (page, container): PdfTextTask => {
            const spans = textItemsOf(page).map((item) => {
                const span = document.createElement('span');
                span.textContent = item.str;

                if (item.str !== '') {
                    container.append(span);
                }

                if (item.hasEOL) {
                    container.append(document.createElement('br'));
                }

                return span;
            });
            const cancel = vi.fn();
            texts.push({ page: pageNumberOf(page), cancel });

            return { promise: Promise.resolve(), cancel: () => cancel(), spans };
        },
    };

    return {
        engine,
        draws,
        texts,
        openAsync,
        finishDrawsAsync: async () => {
            const finished: number[] = [];

            for (let round = 0; round < 50; round += 1) {
                // A draw starts only after its page is fetched, so queued work runs first.
                for (let tick = 0; tick < 10; tick += 1) {
                    await Promise.resolve();
                }

                const pending = draws.filter((draw) => !settled.has(draw));

                if (pending.length === 0) {
                    break;
                }

                for (const draw of pending) {
                    settled.add(draw);
                    draw.finish();
                    finished.push(draw.page);
                }

                for (let tick = 0; tick < 10; tick += 1) {
                    await Promise.resolve();
                }
            }

            return finished;
        },
    };
}

export interface FakeObservers {
    readonly factory: PageObserverFactory;
    // Reports pages coming near the view (or leaving it) to the observer with that margin.
    report(
        margin: string,
        pages: ReadonlyArray<{ readonly element: Element; readonly isIntersecting: boolean }>,
    ): void;
    readonly disconnected: string[];
}

export function createFakeObservers(): FakeObservers {
    const callbacks = new Map<string, Parameters<PageObserverFactory>[0]>();
    const disconnected: string[] = [];

    return {
        factory: (callback, options) => {
            callbacks.set(options.rootMargin, callback);

            return { observe: () => {}, disconnect: () => disconnected.push(options.rootMargin) };
        },
        report: (margin, pages) => {
            const entries = pages.map((page) => ({
                target: page.element,
                isIntersecting: page.isIntersecting,
            }));
            callbacks.get(margin)?.(entries);
        },
        disconnected,
    };
}
