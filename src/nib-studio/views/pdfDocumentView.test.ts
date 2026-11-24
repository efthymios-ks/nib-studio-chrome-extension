import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CSS_PIXELS_PER_POINT, PAGE_GAP } from '../../common/pdf/pdfPageLayout.js';
import { setClientSize } from '../testing/fakeAnimationClock.js';
import { createFakeEngine, createFakeObservers, createFakePdf, type FakeEngine, type FakeObservers, type FakePdf } from '../testing/fakePdf.js';
import { flushAsync } from '../testing/testHelpers.js';
import { createPdfDocumentView, resolveLinkAsync, type PdfDocumentView, type PdfDocumentViewOptions } from './pdfDocumentView.js';

const LETTER: readonly [number, number] = [612, 792];
const NEAR = '100%';
const FAR = '300%';

let viewport: HTMLElement;
let observers: FakeObservers;
let views: PdfDocumentView[] = [];

function sizesOf(pdf: FakePdf): PdfDocumentViewOptions['sizes'] {
    return pdf.pages.map((page) => ({ width: (page.view[2] as number) * CSS_PIXELS_PER_POINT, height: (page.view[3] as number) * CSS_PIXELS_PER_POINT, userUnit: 1 }));
}

function mount(pdf: FakePdf, fake: FakeEngine, overrides: Partial<PdfDocumentViewOptions> = {}): PdfDocumentView {
    const view = createPdfDocumentView({
        document: pdf.document,
        engine: fake.engine,
        viewport,
        sizes: sizesOf(pdf),
        scale: 1,
        onCurrentPage: vi.fn(),
        onNavigate: vi.fn(),
        devicePixelRatio: () => 2,
        createObserver: observers.factory,
        ...overrides,
    });
    viewport.append(view.element);
    views.push(view);

    return view;
}

function page(view: PdfDocumentView, number: number): HTMLElement {
    return view.element.querySelector(`.pdf-page[data-page-number="${number}"]`) as HTMLElement;
}

function bringNear(view: PdfDocumentView, numbers: ReadonlyArray<number>, isIntersecting = true): void {
    observers.report(NEAR, numbers.map((number) => ({ element: page(view, number), isIntersecting })));
}

beforeEach(() => {
    viewport = document.createElement('div');
    document.body.append(viewport);
    setClientSize(viewport, 800, 600);
    observers = createFakeObservers();
    views = [];
});

afterEach(() => {
    for (const view of views) {
        view.destroy();
    }

    viewport.remove();
});

describe('createPdfDocumentView', () => {
    it('gives every page a placeholder of its size from the start', () => {
        const pdf = createFakePdf({ pages: [LETTER, [792, 612], LETTER] });
        const view = mount(pdf, createFakeEngine(pdf));
        const second = page(view, 2);

        expect(view.element.querySelectorAll('.pdf-page')).toHaveLength(3);
        expect(second.dataset['state']).toBe('empty');
        expect(second.getAttribute('aria-label')).toBe('Page 2 of 3');
        expect(second.style.getPropertyValue('--pdf-page-width')).toBe(String(792 * CSS_PIXELS_PER_POINT));
        expect(second.style.getPropertyValue('--pdf-page-height')).toBe(String(612 * CSS_PIXELS_PER_POINT));
        expect(view.getLayout().height).toBeCloseTo((792 + 612 + 792) * CSS_PIXELS_PER_POINT + 2 * PAGE_GAP, 6);
        expect(view.getLayout().width).toBeCloseTo(792 * CSS_PIXELS_PER_POINT, 6);
    });

    it('draws only the pages near the view, one at a time, nearest the page being read first', async () => {
        const pdf = createFakePdf({ pages: [LETTER, LETTER, LETTER, LETTER, LETTER] });
        const fake = createFakeEngine(pdf);
        const view = mount(pdf, fake);
        bringNear(view, [2, 1, 3]);
        await flushAsync();

        expect(fake.draws.map((draw) => draw.page)).toEqual([1]);
        expect(await fake.finishDrawsAsync()).toEqual([1, 2, 3]);
        expect([...view.element.querySelectorAll<HTMLElement>('.pdf-page')].map((element) => element.dataset['state'])).toEqual(['drawn', 'drawn', 'drawn', 'empty', 'empty']);
    });

    it('draws a page sharp for the screen at the zoom shown', async () => {
        const pdf = createFakePdf({ pages: [LETTER] });
        const fake = createFakeEngine(pdf);
        const view = mount(pdf, fake, { scale: 1.5 });
        bringNear(view, [1]);
        await flushAsync();

        expect(fake.draws[0]?.pixelsPerPoint).toBeCloseTo(1.5 * 2 * CSS_PIXELS_PER_POINT, 10);
    });

    it('lays the text and the internal links over a drawn page', async () => {
        const pdf = createFakePdf({
            pages: [LETTER, LETTER],
            annotations: {
                0: [
                    { subtype: 'Link', rect: [72, 692, 172, 712], dest: [{ num: 9, gen: 0 }, { name: 'XYZ' }, 0, 700, null] },
                    { subtype: 'Link', rect: [72, 600, 300, 620], url: 'https://example.com/' },
                ],
            },
            references: { 9: 1 },
        });
        const fake = createFakeEngine(pdf);
        const onNavigate = vi.fn();
        const view = mount(pdf, fake, { onNavigate });
        bringNear(view, [1]);
        await fake.finishDrawsAsync();
        await flushAsync();
        const first = page(view, 1);
        const links = first.querySelectorAll<HTMLButtonElement>('.pdf-link');

        expect(first.querySelector('.pdf-page-canvas')).not.toBeNull();
        expect(first.querySelector('.pdf-text-layer')?.textContent).toBe('Text of page 1');
        expect(first.querySelector('.pdf-text-end')).not.toBeNull();
        expect(links).toHaveLength(1);
        expect(links[0]?.style.left).toBe(`${(100 * 72) / 612}%`);
        expect(links[0]?.style.top).toBe(`${(100 * (792 - 712)) / 792}%`);
        links[0]?.click();
        await flushAsync();

        expect(onNavigate).toHaveBeenCalledWith({ index: 1, within: (792 - 700) * CSS_PIXELS_PER_POINT });
    });

    it('draws the pages near the view again once a zoom settles, stopping a draw at the old zoom', async () => {
        const pdf = createFakePdf({ pages: [LETTER, LETTER] });
        const fake = createFakeEngine(pdf);
        const view = mount(pdf, fake);
        bringNear(view, [1, 2]);
        await fake.finishDrawsAsync();
        bringNear(view, [1, 2]);
        view.setScale(2);
        await flushAsync();
        const inFlight = fake.draws.at(-1);
        view.setScale(1.5);
        await flushAsync();

        expect(inFlight?.cancel).toHaveBeenCalled();
        expect(await fake.finishDrawsAsync()).toEqual([1, 2]);
        expect(fake.draws.slice(-2).map((draw) => draw.pixelsPerPoint)).toEqual([1.5 * 2 * CSS_PIXELS_PER_POINT, 1.5 * 2 * CSS_PIXELS_PER_POINT]);
    });

    it('waits while the view zooms or jumps, and draws once it rests', async () => {
        const pdf = createFakePdf({ pages: [LETTER] });
        const fake = createFakeEngine(pdf);
        const view = mount(pdf, fake);
        viewport.dataset['zooming'] = 'true';
        bringNear(view, [1]);
        await flushAsync();

        expect(fake.draws).toHaveLength(0);
        delete viewport.dataset['zooming'];
        viewport.dataset['jumping'] = 'true';
        view.setScale(1);
        await flushAsync();

        expect(fake.draws).toHaveLength(0);
        delete viewport.dataset['jumping'];
        view.setScale(1);
        await flushAsync();

        expect(fake.draws).toHaveLength(1);
    });

    it('lets a page far from the view go, freeing its canvas, text and page data', async () => {
        const pdf = createFakePdf({ pages: [LETTER, LETTER] });
        const fake = createFakeEngine(pdf);
        const view = mount(pdf, fake);
        bringNear(view, [1]);
        await fake.finishDrawsAsync();
        await flushAsync();
        const canvas = page(view, 1).querySelector('canvas') as HTMLCanvasElement;
        observers.report(FAR, [{ element: page(view, 1), isIntersecting: false }]);

        expect(page(view, 1).dataset['state']).toBe('empty');
        expect(page(view, 1).querySelector('canvas, .pdf-text-layer, .pdf-link-layer')).toBeNull();
        expect(canvas.width).toBe(0);
        expect(fake.texts[0]?.cancel).toHaveBeenCalled();
        expect(pdf.pages[0]?.cleanup).toHaveBeenCalled();
    });

    it('says a page could not be drawn, and doesn\'t try it again', async () => {
        const pdf = createFakePdf({ pages: [LETTER, LETTER] });
        const fake = createFakeEngine(pdf);
        const view = mount(pdf, fake);
        bringNear(view, [1, 2]);
        await flushAsync();
        fake.draws[0]?.fail(new Error('Bad XObject'));
        await flushAsync();
        const message = page(view, 1).querySelector('.pdf-page-error');

        expect(page(view, 1).dataset['state']).toBe('failed');
        expect(message?.textContent).toBe('This page could not be drawn.');
        expect(message?.getAttribute('title')).toBe('Bad XObject');
        await fake.finishDrawsAsync();
        view.setScale(1);
        await flushAsync();

        expect(fake.draws.filter((draw) => draw.page === 1)).toHaveLength(1);
        expect(page(view, 2).dataset['state']).toBe('drawn');
    });

    it('follows the page being read from where the document sits on screen', () => {
        const pdf = createFakePdf({ pages: [LETTER, LETTER, LETTER] });
        const onCurrentPage = vi.fn();
        const onScroll = vi.fn();
        const view = mount(pdf, createFakeEngine(pdf), { onCurrentPage, onScroll });
        const height = view.getLayout().height;
        vi.spyOn(view.element, 'getBoundingClientRect').mockReturnValue({ top: -1500, left: 10, height, width: 816 } as DOMRect);
        view.refresh();

        expect(onCurrentPage).toHaveBeenCalledWith(1);
        expect(onScroll).toHaveBeenCalledWith({ x: -10, y: 1500 });
        expect(view.scrollTargetFor({ index: 2, within: null })).toEqual({
            x: 0,
            y: viewport.scrollTop - 1500 + 2 * (1056 + PAGE_GAP) - PAGE_GAP / 2,
        });
    });

    it('takes the measured sizes of every page', () => {
        const pdf = createFakePdf({ pages: [LETTER, LETTER] });
        const view = mount(pdf, createFakeEngine(pdf));
        const layout = view.updateSizes([{ width: 816, height: 1056, userUnit: 1 }, { width: 1056, height: 816, userUnit: 2 }]);

        expect(layout.width).toBe(1056);
        expect(page(view, 2).style.getPropertyValue('--pdf-page-width')).toBe('1056');
        expect(page(view, 2).style.getPropertyValue('--pdf-user-unit')).toBe('2');
    });

    it('stops watching and drawing once destroyed', async () => {
        const pdf = createFakePdf({ pages: [LETTER] });
        const fake = createFakeEngine(pdf);
        const view = mount(pdf, fake);
        bringNear(view, [1]);
        await flushAsync();
        view.destroy();
        views = [];

        expect(fake.draws[0]?.cancel).toHaveBeenCalled();
        expect(observers.disconnected).toEqual([NEAR, FAR]);
    });
});

describe('createPdfDocumentView text for Find', () => {
    it('tells when a page\'s text layer is laid out, with a span for each item, and when it is let go', async () => {
        const pdf = createFakePdf({ pages: [LETTER, LETTER], texts: { 0: ['One ', { str: 'two', hasEOL: true }, '', 'three'] } });
        const fake = createFakeEngine(pdf);
        const onTextLayer = vi.fn();
        const view = mount(pdf, fake, { onTextLayer });
        bringNear(view, [1]);
        await fake.finishDrawsAsync();
        await flushAsync();
        const spans = onTextLayer.mock.calls[0]?.[1] as HTMLElement[];

        expect(onTextLayer.mock.calls[0]?.[0]).toBe(0);
        expect(spans.map((span) => span.textContent)).toEqual(['One ', 'two', '', 'three']);
        expect(page(view, 1).querySelector('.pdf-text-layer br')).not.toBeNull();
        observers.report(FAR, [{ element: page(view, 1), isIntersecting: false }]);

        expect(onTextLayer).toHaveBeenLastCalledWith(0, null);
    });

    it('lays out the text of a page far from the view without drawing it, once however often it is asked', async () => {
        const pdf = createFakePdf({ pages: [LETTER, LETTER, LETTER] });
        const fake = createFakeEngine(pdf);
        const onTextLayer = vi.fn();
        const view = mount(pdf, fake, { onTextLayer });
        const [spans, again] = await Promise.all([view.showTextAsync(2), view.showTextAsync(2)]);

        expect(spans?.map((span) => span.textContent)).toEqual(['Text of page 3']);
        expect(again).toBe(spans);
        expect(fake.texts.map((text) => text.page)).toEqual([3]);
        expect(fake.draws).toEqual([]);
        expect(page(view, 3).dataset['state']).toBe('empty');
        expect(onTextLayer).toHaveBeenCalledWith(2, spans);
        expect(await view.showTextAsync(9)).toBeNull();
    });

    it('gives nothing for a page whose text can\'t be laid out', async () => {
        const pdf = createFakePdf({ pages: [LETTER] });
        const fake = createFakeEngine(pdf);
        fake.engine.renderText = () => ({ promise: Promise.reject(new Error('No text')), cancel: () => {}, spans: [] });
        const view = mount(pdf, fake);

        expect(await view.showTextAsync(0)).toBeNull();
    });

    it('works out the scroll that puts the middle of a page in the middle of the view', () => {
        const pdf = createFakePdf({ pages: [LETTER, LETTER, LETTER] });
        const view = mount(pdf, createFakeEngine(pdf));
        const height = view.getLayout().height;
        vi.spyOn(view.element, 'getBoundingClientRect').mockReturnValue({ top: -1500, left: 0, height, width: 816 } as DOMRect);

        expect(view.centreTargetFor(1)).toEqual({
            x: 408 - 400,
            y: -1500 + 1056 + PAGE_GAP + 528 - 300,
        });
        expect(view.centreTargetFor(5)).toBeNull();
    });
});

describe('resolveLinkAsync', () => {
    const pdf = createFakePdf({
        pages: [LETTER, LETTER, LETTER],
        destinations: { 'chapter.2': [{ num: 7, gen: 0 }, { name: 'FitH' }, 500], 'broken': [{ num: 99, gen: 0 }, { name: 'Fit' }] },
        references: { 7: 1 },
    });

    it('goes to a named destination\'s page and line', async () => {
        expect(await resolveLinkAsync(pdf.document, { kind: 'destination', destination: 'chapter.2' }, 0, 3))
            .toEqual({ index: 1, within: (792 - 500) * CSS_PIXELS_PER_POINT });
    });

    it('goes to the top of a page given by index', async () => {
        expect(await resolveLinkAsync(pdf.document, { kind: 'destination', destination: [2, { name: 'Fit' }] }, 0, 3)).toEqual({ index: 2, within: null });
    });

    it('follows the page actions from the page the link is on', async () => {
        expect(await resolveLinkAsync(pdf.document, { kind: 'named', action: 'next' }, 1, 3)).toEqual({ index: 2, within: null });
        expect(await resolveLinkAsync(pdf.document, { kind: 'named', action: 'last' }, 0, 3)).toEqual({ index: 2, within: null });
    });

    it('is null for a destination that goes nowhere in the document', async () => {
        expect(await resolveLinkAsync(pdf.document, { kind: 'destination', destination: 'missing' }, 0, 3)).toBeNull();
        expect(await resolveLinkAsync(pdf.document, { kind: 'destination', destination: 'broken' }, 0, 3)).toBeNull();
        expect(await resolveLinkAsync(pdf.document, { kind: 'destination', destination: [8, { name: 'Fit' }] }, 0, 3)).toBeNull();
    });
});
