import {
    canvasPixelRatio,
    CSS_PIXELS_PER_POINT,
    currentPageIndex,
    drawOrder,
    layoutPages,
    nextPageToDraw,
    pageCentre,
    pageOffset,
    pagesOverBudget,
    type PageLayout,
    type PageSize,
} from '../../common/pdf/pdfPageLayout.js';
import {
    internalLinkTarget,
    namedActionPage,
    parseExplicitDestination,
    percentBox,
    type LinkTarget,
    type PercentBox,
} from '../../common/pdf/pdfLinks.js';
import { h } from '../app/dom.js';
import { errorMessage } from '../../common/errorMessage.js';
import type { PdfDocument, PdfEngine, PdfPage, PdfTask, PdfTextTask } from './pdfEngine.js';
import type { Point } from './previewZoom.js';

// A page's size at 100% in CSS pixels, and the PDF user unit its text layer scales by.
export interface PdfPageSize extends PageSize {
    readonly userUnit: number;
}

// Where a link goes: a page, and how far down it in CSS pixels at 100%, or null for its top.
export interface PdfLinkDestination {
    readonly index: number;
    readonly within: number | null;
}

// Watches the pages near the view; a stand-in for IntersectionObserver in tests.
export type PageObserverFactory = (
    callback: (entries: ReadonlyArray<PageObserverEntry>) => void,
    options: { readonly root: Element; readonly rootMargin: string },
) => { observe(target: Element): void; disconnect(): void };

interface PageObserverEntry {
    readonly target: Element;
    readonly isIntersecting: boolean;
}

export interface PdfDocumentViewOptions {
    readonly document: PdfDocument;
    readonly engine: PdfEngine;
    // The frame's scrolling area, which the observers watch from.
    readonly viewport: HTMLElement;
    readonly sizes: ReadonlyArray<PdfPageSize>;
    // The frame's settled zoom when the view is shown.
    readonly scale: number;
    readonly onCurrentPage: (index: number) => void;
    readonly onScroll?: (readingPoint: Point) => void;
    readonly onNavigate: (destination: PdfLinkDestination) => void;
    // Called when a page's text layer has been laid out, with its spans in pdf.js order, and with null when it is let go.
    readonly onTextLayer?: (index: number, spans: ReadonlyArray<HTMLElement> | null) => void;
    readonly devicePixelRatio?: () => number;
    readonly createObserver?: PageObserverFactory;
}

export interface PdfDocumentView {
    readonly element: HTMLElement;
    getLayout(): PageLayout;
    // Draws the pages near the view again, sharp at the zoom that just settled.
    setScale(scale: number): void;
    // Takes the measured size of every page, and returns the document's new size at 100%.
    updateSizes(sizes: ReadonlyArray<PdfPageSize>): PageLayout;
    // The scroll position that shows a destination at the top of the view, keeping the scroll across.
    scrollTargetFor(destination: PdfLinkDestination): Point | null;
    // The scroll position that puts the middle of a page in the middle of the view.
    centreTargetFor(index: number): Point | null;
    // Lays out a page's text layer, even one far from the view, so a place in its text can be found on screen;
    // resolves with its spans, or null when the page's text can't be read or the page was let go meanwhile.
    showTextAsync(index: number): Promise<ReadonlyArray<HTMLElement> | null>;
    // The content point, in CSS pixels at 100%, at the top left of the view;
    // null before the view is laid out.
    readingPoint(): Point | null;
    // Notes a scroll or zoom, to follow the page being read and draw what came into view.
    refresh(): void;
    destroy(): void;
}

// Pages within a view's height of the screen are drawn; pages three heights away are let go.
const NEAR_MARGIN = '100%';
const FAR_MARGIN = '300%';

interface PageState {
    readonly index: number;
    readonly element: HTMLElement;
    proxy: PdfPage | null;
    canvas: HTMLCanvasElement | null;
    drawnScale: number | null;
    pixels: number;
    text: PageText | null;
    links: HTMLElement | null;
}

interface PageText {
    readonly element: HTMLElement;
    readonly task: PdfTextTask;
}

interface VisibleBox {
    readonly left: number;
    readonly top: number;
    readonly bottom: number;
}

interface DrawJob {
    readonly index: number;
    readonly scale: number;
    task: PdfTask | null;
    isCancelled: boolean;
}

const BROWSER_OBSERVER: PageObserverFactory = (callback, options) =>
    new IntersectionObserver(callback, options);

// The pages of an open PDF, stacked in the frame's layer. Every page has its placeholder from the start,
// so the scroll bar is right at once, but only the pages near the view are drawn, nearest first,
// and pages far away are let go to save memory.
export function createPdfDocumentView(options: PdfDocumentViewOptions): PdfDocumentView {
    const { document: pdf, engine, viewport } = options;
    const pixelRatio = options.devicePixelRatio ?? (() => window.devicePixelRatio);
    let layout = layoutPages(options.sizes);
    let scale = options.scale;
    let current = 0;
    let active: DrawJob | null = null;
    let isDestroyed = false;
    const near = new Set<number>();
    const failed = new Set<number>();

    const element = h('div', { class: 'pdf-document' });
    const pages: PageState[] = options.sizes.map((size, index) => {
        const page = h('div', {
            class: 'pdf-page',
            dataset: { pageNumber: String(index + 1), state: 'empty' },
            attrs: { role: 'group', 'aria-label': `Page ${index + 1} of ${options.sizes.length}` },
        });
        sizePage(page, size);
        element.append(page);

        return {
            index,
            element: page,
            proxy: null,
            canvas: null,
            drawnScale: null,
            pixels: 0,
            text: null,
            links: null,
        };
    });

    // Pages are drawn once the view rests: not mid-zoom, and not on the way through a jump.
    const isMoving = (): boolean => viewport.dataset['zooming'] === 'true'
        || viewport.dataset['jumping'] === 'true';

    const drawnScales = (): Map<number, number> => {
        const drawn = new Map<number, number>();

        for (const page of pages) {
            if (page.drawnScale != null) {
                drawn.set(page.index, page.drawnScale);
            }
        }

        return drawn;
    };

    const pump = (): void => {
        if (isDestroyed || active != null || isMoving()) {
            return;
        }

        const index = nextPageToDraw(drawOrder(near, current), drawnScales(), scale, failed);

        if (index != null) {
            void drawAsync(index);
        }
    };

    const drawAsync = async (index: number): Promise<void> => {
        const state = pages[index];
        const size = layout.pages[index];

        if (state == null || size == null) {
            return;
        }

        const job: DrawJob = { index, scale, task: null, isCancelled: false };
        active = job;
        let canvas: HTMLCanvasElement | null = null;

        try {
            const page = state.proxy ?? await pdf.getPage(index + 1);
            state.proxy = page;

            if (job.isCancelled) {
                return;
            }

            const ratio = canvasPixelRatio({
                cssWidth: size.width * job.scale,
                cssHeight: size.height * job.scale,
                devicePixelRatio: pixelRatio(),
                scale: job.scale,
            });
            canvas = h('canvas', { class: 'pdf-page-canvas', attrs: { 'aria-hidden': 'true' } });
            job.task = engine.drawPage(page, canvas, job.scale * ratio * CSS_PIXELS_PER_POINT);
            await job.task.promise;

            if (job.isCancelled) {
                return;
            }

            showCanvas(state, canvas, job.scale);
            canvas = null;
            addTextLayer(state, page);
            void addLinksAsync(state, page);
            releaseOverBudget();
        }
        catch (error) {
            if (!job.isCancelled && !isCancellation(error)) {
                markFailed(state, error);
            }
        }
        finally {
            freeCanvas(canvas);

            if (active === job) {
                active = null;
            }

            pump();
        }
    };

    const showCanvas = (state: PageState, canvas: HTMLCanvasElement, drawnScale: number): void => {
        const previous = state.canvas;
        state.element.prepend(canvas);
        state.canvas = canvas;
        state.drawnScale = drawnScale;
        state.pixels = canvas.width * canvas.height;
        state.element.dataset['state'] = 'drawn';
        previous?.remove();
        freeCanvas(previous);
    };

    // The reason shows when the pointer rests on the message.
    const markFailed = (state: PageState, error: unknown): void => {
        failed.add(state.index);
        state.element.dataset['state'] = 'failed';
        state.element.append(h('p', {
            class: 'pdf-page-error',
            text: 'This page could not be drawn.',
            attrs: { title: errorMessage(error) },
        }));
    };

    const addTextLayer = (state: PageState, page: PdfPage): void => {
        if (state.text != null) {
            return;
        }

        const layer = h('div', { class: 'pdf-text-layer' });
        state.element.append(layer);
        const text = { element: layer, task: engine.renderText(page, layer) };
        state.text = text;
        void finishTextLayerAsync(state, text);
    };

    // The end marker after the text keeps a drag that leaves the text inside the page's text,
    // as in Chrome's own viewer.
    const finishTextLayerAsync = async (state: PageState, text: PageText): Promise<void> => {
        try {
            await text.task.promise;
        }
        catch {
            // A page whose text can't be read still shows; its text just can't be selected.
            return;
        }

        if (state.text !== text) {
            return;
        }

        text.element.append(h('div', { class: 'pdf-text-end' }));
        options.onTextLayer?.(state.index, text.task.spans);
    };

    const addLinksAsync = async (state: PageState, page: PdfPage): Promise<void> => {
        if (state.links != null) {
            return;
        }

        const layer = h('div', { class: 'pdf-link-layer' });
        state.links = layer;
        state.element.append(layer);

        try {
            const annotations: ReadonlyArray<Readonly<Record<string, unknown>>> = await page.getAnnotations({
                intent: 'display',
            });
            const pageViewport = page.getViewport({ scale: 1 });

            for (const annotation of annotations) {
                const target = internalLinkTarget(annotation);
                const rectangle = annotation['rect'];

                if (target == null || !Array.isArray(rectangle) || state.links !== layer) {
                    continue;
                }

                const [left, bottom, right, top] = rectangle as number[];
                const corners = [
                    ...pageViewport.convertToViewportPoint(left ?? 0, bottom ?? 0),
                    ...pageViewport.convertToViewportPoint(right ?? 0, top ?? 0),
                ] as number[];
                const box = percentBox(corners, pageViewport.width, pageViewport.height);

                if (box != null) {
                    layer.append(linkButton(box, target, state.index));
                }
            }
        }
        catch {
            // Links are a convenience; a page whose annotations can't be read keeps its text and picture.
        }
    };

    const linkButton = (box: PercentBox, target: LinkTarget, fromIndex: number): HTMLElement => {
        const button = h('button', {
            class: 'pdf-link',
            attrs: { type: 'button', tabindex: '-1', 'aria-label': 'Go to the linked place in the document' },
            on: {
                click: (event) => {
                    event.preventDefault();
                    void followLinkAsync(target, fromIndex);
                },
            },
        });
        button.style.left = `${box.left}%`;
        button.style.top = `${box.top}%`;
        button.style.width = `${box.width}%`;
        button.style.height = `${box.height}%`;

        return button;
    };

    const followLinkAsync = async (target: LinkTarget, fromIndex: number): Promise<void> => {
        const destination = await resolveLinkAsync(pdf, target, fromIndex, pages.length);

        if (destination != null && !isDestroyed) {
            options.onNavigate(destination);
        }
    };

    const release = (index: number): void => {
        const state = pages[index];

        if (state == null) {
            return;
        }

        if (active?.index === index) {
            cancelActive();
        }

        state.canvas?.remove();
        freeCanvas(state.canvas);
        state.canvas = null;
        state.drawnScale = null;
        state.pixels = 0;
        const text = state.text;
        state.text = null;

        if (text != null) {
            text.task.cancel();
            text.element.remove();
            options.onTextLayer?.(index, null);
        }

        state.links?.remove();
        state.links = null;
        state.element.dataset['state'] = failed.has(index) ? 'failed' : 'empty';
        state.proxy?.cleanup();
        state.proxy = null;
    };

    const cancelActive = (): void => {
        if (active == null) {
            return;
        }

        active.isCancelled = true;
        active.task?.cancel();
        active = null;
    };

    // A selection in a page keeps it, so text being copied never disappears under the pointer.
    const holdsSelection = (index: number): boolean => {
        const selection = window.getSelection();
        const page = pages[index]?.element;

        return selection != null
            && selection.rangeCount > 0
            && !selection.isCollapsed
            && page != null
            && selection.containsNode(page, true);
    };

    const releaseOverBudget = (): void => {
        const drawn = pages
            .filter((page) => page.drawnScale != null)
            .map((page) => ({ index: page.index, pixels: page.pixels }));

        for (const index of pagesOverBudget(drawn, near, current)) {
            release(index);
        }
    };

    const indexOf = (target: Element): number =>
        Number((target as HTMLElement).dataset['pageNumber'] ?? '0') - 1;
    const browserObserver = typeof IntersectionObserver === 'function' ? BROWSER_OBSERVER : null;
    const createObserver = options.createObserver ?? browserObserver;
    const nearObserver = createObserver?.((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                near.add(indexOf(entry.target));
            }
            else {
                near.delete(indexOf(entry.target));
            }
        }

        pump();
    }, { root: viewport, rootMargin: NEAR_MARGIN });
    const farObserver = createObserver?.((entries) => {
        for (const entry of entries) {
            const index = indexOf(entry.target);

            if (!entry.isIntersecting && !holdsSelection(index)) {
                release(index);
            }
        }
    }, { root: viewport, rootMargin: FAR_MARGIN });

    for (const page of pages) {
        nearObserver?.observe(page.element);
        farObserver?.observe(page.element);
    }

    // While a selection is dragged, the page's end marker covers the gaps between lines.
    const endSelecting = (): void => {
        for (const layer of element.querySelectorAll<HTMLElement>('.pdf-text-layer[data-selecting]')) {
            delete layer.dataset['selecting'];
        }
    };
    const onPointerDown = (event: PointerEvent): void => {
        const layer = event.button === 0 && event.target instanceof Element
            ? event.target.closest<HTMLElement>('.pdf-text-layer')
            : null;

        if (layer == null || viewport.dataset['panMode'] != null) {
            return;
        }

        layer.dataset['selecting'] = 'true';
        window.addEventListener('pointerup', endSelecting, { once: true });
    };
    element.addEventListener('pointerdown', onPointerDown);

    // Where the view is in the document, from where the document is drawn on screen,
    // so it holds during a zoom too.
    const visibleBox = (): VisibleBox | null => {
        const box = element.getBoundingClientRect();

        if (box.height <= 0 || layout.height <= 0) {
            return null;
        }

        const ratio = box.height / layout.height;
        const view = viewport.getBoundingClientRect();
        const left = (view.left + viewport.clientLeft - box.left) / ratio;
        const top = (view.top + viewport.clientTop - box.top) / ratio;

        return { left, top, bottom: top + viewport.clientHeight / ratio };
    };

    const refresh = (): void => {
        const box = visibleBox();

        if (box == null || isDestroyed) {
            return;
        }

        const index = currentPageIndex(layout, box.top, box.bottom);

        if (index !== current) {
            current = index;
            options.onCurrentPage(index);
        }

        options.onScroll?.({ x: box.left, y: box.top });
        pump();
    };

    return {
        element,
        getLayout: () => layout,
        setScale: (next) => {
            scale = next;

            if (active != null && active.scale !== next) {
                cancelActive();
            }

            pump();
        },
        updateSizes: (next) => {
            layout = layoutPages(next);

            for (const page of pages) {
                const size = next[page.index];

                if (size != null) {
                    sizePage(page.element, size);
                }
            }

            return layout;
        },
        scrollTargetFor: (destination) => {
            const box = element.getBoundingClientRect();

            if (box.height <= 0 || layout.height <= 0) {
                return null;
            }

            const ratio = box.height / layout.height;
            const view = viewport.getBoundingClientRect();
            const offset = pageOffset(layout, destination.index, destination.within ?? 0);
            const documentTop = box.top - (view.top + viewport.clientTop);

            return { x: viewport.scrollLeft, y: viewport.scrollTop + documentTop + offset * ratio };
        },
        centreTargetFor: (index) => {
            const box = element.getBoundingClientRect();
            const centre = pageCentre(layout, index);

            if (centre == null || box.height <= 0 || layout.height <= 0) {
                return null;
            }

            const ratio = box.height / layout.height;
            const view = viewport.getBoundingClientRect();

            return {
                x: viewport.scrollLeft + box.left - (view.left + viewport.clientLeft) + centre.x * ratio - viewport.clientWidth / 2,
                y: viewport.scrollTop + box.top - (view.top + viewport.clientTop) + centre.y * ratio - viewport.clientHeight / 2,
            };
        },
        showTextAsync: async (index) => {
            const state = pages[index];

            if (state == null || isDestroyed) {
                return null;
            }

            if (state.text == null) {
                try {
                    const page = state.proxy ?? await pdf.getPage(index + 1);

                    if (isDestroyed) {
                        return null;
                    }

                    state.proxy = page;
                    addTextLayer(state, page);
                }
                catch {
                    return null;
                }
            }

            const text = state.text;

            try {
                await text?.task.promise;
            }
            catch {
                return null;
            }

            return text != null && state.text === text ? text.task.spans : null;
        },
        readingPoint: () => {
            const box = visibleBox();

            return box == null ? null : { x: box.left, y: box.top };
        },
        refresh,
        destroy: () => {
            isDestroyed = true;
            cancelActive();
            nearObserver?.disconnect();
            farObserver?.disconnect();
            element.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('pointerup', endSelecting);

            for (const page of pages) {
                release(page.index);
            }
        },
    };
}

function sizePage(page: HTMLElement, size: PdfPageSize): void {
    page.style.setProperty('--pdf-page-width', String(size.width));
    page.style.setProperty('--pdf-page-height', String(size.height));
    page.style.setProperty('--pdf-user-unit', String(size.userUnit));
}

// A canvas's pixels are freed at once by shrinking it, rather than whenever it is collected.
function freeCanvas(canvas: HTMLCanvasElement | null): void {
    if (canvas != null) {
        canvas.width = 0;
        canvas.height = 0;
    }
}

function isCancellation(error: unknown): boolean {
    const name = (error as { name?: unknown } | null)?.name;

    return name === 'RenderingCancelledException' || name === 'AbortException';
}

// Where an internal link goes: a named page action, a named destination or one spelled out.
export async function resolveLinkAsync(
    pdf: Pick<PdfDocument, 'getDestination' | 'getPageIndex' | 'getPage'>,
    target: LinkTarget,
    fromIndex: number,
    pageCount: number,
): Promise<PdfLinkDestination | null> {
    if (target.kind === 'named') {
        return { index: namedActionPage(target.action, fromIndex, pageCount), within: null };
    }

    try {
        const explicit = typeof target.destination === 'string'
            ? await pdf.getDestination(target.destination)
            : target.destination;
        const parsed = parseExplicitDestination(explicit);

        if (parsed == null) {
            return null;
        }

        const index = 'index' in parsed.page
            ? parsed.page.index
            : await pdf.getPageIndex(parsed.page.reference);

        if (index < 0 || index >= pageCount) {
            return null;
        }

        if (parsed.top == null) {
            return { index, within: null };
        }

        const page = await pdf.getPage(index + 1);
        const pageViewport = page.getViewport({ scale: CSS_PIXELS_PER_POINT });
        const [, within] = pageViewport.convertToViewportPoint(parsed.left ?? 0, parsed.top);

        return { index, within: Math.max(0, within ?? 0) };
    }
    catch {
        return null;
    }
}
