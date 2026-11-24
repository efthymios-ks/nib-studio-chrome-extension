import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeAnimationClock, setClientSize, type FakeAnimationClock } from '../testing/fakeAnimationClock.js';
import { CONTENT_PADDING, type Point, type Size } from './previewZoom.js';
import {
    createZoomController,
    SETTLE_DELAY_MS,
    ZOOM_ANIMATION_MS,
    type WheelZoomMode,
    type ZoomController,
    type ZoomControllerOptions,
} from './previewZoomController.js';

const VIEW = { width: 800, height: 600 };
const LARGE: Size = { width: 1600, height: 1200 };
const SMALL: Size = { width: 400, height: 300 };

interface Rig {
    readonly controller: ZoomController;
    readonly viewport: HTMLElement;
    readonly area: HTMLElement;
    readonly layer: HTMLElement;
    readonly time: FakeAnimationClock;
    readonly scales: number[];
    readonly settled: number[];
}

let rigs: Rig[] = [];

function createRig(overrides: Partial<ZoomControllerOptions> & { wheelZoom?: WheelZoomMode } = {}): Rig {
    const viewport = document.createElement('div');
    const area = document.createElement('div');
    const layer = document.createElement('div');
    area.append(layer);
    viewport.append(area);
    document.body.append(viewport);
    setClientSize(viewport, VIEW.width, VIEW.height);
    const time = createFakeAnimationClock();
    const scales: number[] = [];
    const settled: number[] = [];
    const controller = createZoomController({
        viewport,
        area,
        layer,
        wheelZoom: 'wheel',
        fitMode: 'contain',
        allowUpscaleOnFit: false,
        dragToPan: true,
        clock: time.clock,
        prefersReducedMotion: () => false,
        onScaleChange: (scale) => scales.push(scale),
        onSettled: (scale) => settled.push(scale),
        ...overrides,
    });
    const rig = { controller, viewport, area, layer, time, scales, settled };
    rigs.push(rig);

    return rig;
}

// The scale, offset and scroll the DOM shows, read back from the layer's size and transform.
function shown(rig: Rig, content: Size): { scale: number; offset: Point; scroll: Point } {
    const match = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(rig.layer.style.transform);

    if (match == null) {
        throw new Error(`Unexpected transform ${rig.layer.style.transform}`);
    }

    const settledScale = Number.parseFloat(rig.layer.style.width) / content.width;

    return {
        scale: settledScale * Number(match[3]),
        offset: { x: Number(match[1]), y: Number(match[2]) },
        scroll: rig.controller.getScroll(),
    };
}

function contentPointUnder(rig: Rig, content: Size, anchor: Point): Point {
    const view = shown(rig, content);

    return { x: (anchor.x + view.scroll.x - view.offset.x) / view.scale, y: (anchor.y + view.scroll.y - view.offset.y) / view.scale };
}

// happy-dom's WheelEvent leaves out the pointer position and modifier keys, so they are set on the event itself.
function wheel(rig: Rig, init: WheelEventInit): WheelEvent {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });

    for (const key of ['clientX', 'clientY', 'ctrlKey', 'shiftKey'] as const) {
        Object.defineProperty(event, key, { value: init[key] ?? (key.endsWith('Key') ? false : 0) });
    }

    rig.viewport.dispatchEvent(event);

    return event;
}

beforeEach(() => {
    rigs = [];
});

afterEach(() => {
    for (const rig of rigs) {
        rig.controller.destroy();
        rig.viewport.remove();
    }
});

describe('createZoomController fitting', () => {
    it('fits large content and lays the layer out at that scale', () => {
        const rig = createRig();
        rig.controller.setContentSize(LARGE);
        const fit = (VIEW.height - 2 * CONTENT_PADDING) / LARGE.height;

        expect(rig.controller.getScale()).toBeCloseTo(fit, 10);
        expect(rig.controller.isFitted()).toBe(true);
        expect(Number.parseFloat(rig.layer.style.width)).toBeCloseTo(LARGE.width * fit, 4);
        expect(rig.layer.style.getPropertyValue('--preview-scale')).toBe(String(fit));
        expect(shown(rig, LARGE).scale).toBeCloseTo(fit, 6);
        expect(rig.area.style.width).toBe(`${VIEW.width}px`);
    });

    it('shows small content at 100%, centred, unless upscaling is allowed', () => {
        const rig = createRig();
        rig.controller.setContentSize(SMALL);

        expect(rig.controller.getScale()).toBe(1);
        expect(shown(rig, SMALL).offset).toEqual({ x: 200, y: 150 });
        expect(rig.scales.at(-1)).toBe(1);

        const upscaled = createRig({ allowUpscaleOnFit: true });
        upscaled.controller.setContentSize(SMALL);

        expect(upscaled.controller.getScale()).toBeCloseTo(568 / 300, 10);
    });

    it('restores a remembered scale and scroll', () => {
        const rig = createRig();
        rig.controller.setContentSize(LARGE, { scale: 1, scroll: { x: 300, y: 200 } });

        expect(rig.controller.getScale()).toBe(1);
        expect(rig.controller.isFitted()).toBe(false);
        expect(rig.controller.getScroll()).toEqual({ x: 300, y: 200 });
    });
});

describe('createZoomController buttons and keys', () => {
    it('animates a step over the animation time, then settles once', () => {
        const rig = createRig();
        rig.controller.setContentSize(SMALL);
        rig.controller.zoomIn();

        expect(rig.controller.getScale()).toBe(1);
        rig.time.advance(64);
        const midway = rig.controller.getScale();
        rig.time.advance(ZOOM_ANIMATION_MS);

        expect(midway).toBeGreaterThan(1);
        expect(midway).toBeLessThan(1.1);
        expect(rig.controller.getScale()).toBeCloseTo(1.1, 10);
        expect(rig.settled).toEqual([]);
        expect(rig.viewport.dataset['zooming']).toBe('true');

        rig.time.advance(SETTLE_DELAY_MS + 16);

        expect(rig.settled).toEqual([rig.controller.getScale()]);
        expect(Number.parseFloat(rig.layer.style.width)).toBeCloseTo(SMALL.width * rig.controller.getScale(), 4);
        expect(rig.layer.style.transform).toMatch(/scale\(1\)$/);
        expect(rig.viewport.dataset['zooming']).toBeUndefined();
    });

    it('during a zoom only scales the laid-out layer with a transform', () => {
        const rig = createRig();
        rig.controller.setContentSize(SMALL);
        rig.controller.zoomIn();
        rig.time.advance(64);

        expect(rig.layer.style.width).toBe('400px');
        expect(rig.layer.style.transform).not.toMatch(/scale\(1\)$/);
    });

    it('retargets quick presses instead of queueing them', () => {
        const rig = createRig();
        rig.controller.setContentSize(SMALL);
        rig.controller.zoomIn();
        rig.time.advance(32);
        rig.controller.zoomIn();
        rig.time.advance(32);
        rig.controller.zoomIn();
        rig.time.advance(ZOOM_ANIMATION_MS);

        expect(rig.controller.getScale()).toBeCloseTo(1.5, 10);
        expect(rig.scales.every((scale, index) => index === 0 || scale >= (rig.scales[index - 1] ?? 0))).toBe(true);
    });

    it('steps out and fits again with Reset, centred', () => {
        const rig = createRig();
        rig.controller.setContentSize(LARGE);
        rig.controller.zoomTo(2, { x: 700, y: 500 });
        rig.time.advance(400);

        expect(rig.controller.isFitted()).toBe(false);

        rig.controller.reset();
        rig.time.advance(400);
        const fit = (VIEW.height - 2 * CONTENT_PADDING) / LARGE.height;

        expect(rig.controller.isFitted()).toBe(true);
        expect(rig.controller.getScale()).toBeCloseTo(fit, 10);
        expect(shown(rig, LARGE).offset.x).toBeCloseTo((VIEW.width - LARGE.width * fit) / 2, 6);
        expect(rig.controller.getScroll()).toEqual({ x: 0, y: 0 });
    });

    it('lands at once and settles straight away when motion is reduced', () => {
        const rig = createRig({ prefersReducedMotion: () => true });
        rig.controller.setContentSize(SMALL);
        rig.controller.zoomOut();

        expect(rig.controller.getScale()).toBe(0.9);
        expect(rig.settled).toEqual([0.9]);
        expect(rig.time.pendingFrames()).toBe(0);
    });
});

describe('createZoomController wheel', () => {
    it('in wheel mode zooms continuously at the pointer and keeps the point under it', () => {
        const rig = createRig();
        rig.controller.setContentSize(LARGE, { scale: 1, scroll: { x: 400, y: 300 } });
        const anchor = { x: 600, y: 200 };
        const before = contentPointUnder(rig, LARGE, anchor);

        for (let index = 0; index < 3; index += 1) {
            expect(wheel(rig, { deltaY: -100, clientX: anchor.x, clientY: anchor.y }).defaultPrevented).toBe(true);
        }

        rig.time.advance(16);
        const after = contentPointUnder(rig, LARGE, anchor);

        expect(rig.controller.getScale()).toBeCloseTo(Math.exp(0.6), 10);
        expect(after.x).toBeCloseTo(before.x, 6);
        expect(after.y).toBeCloseTo(before.y, 6);
        expect(rig.controller.isFitted()).toBe(false);
    });

    it('batches the events of a frame into one change and settles once after the burst', () => {
        const rig = createRig();
        rig.controller.setContentSize(SMALL);
        const changes = rig.scales.length;

        for (let index = 0; index < 5; index += 1) {
            wheel(rig, { deltaY: -4, clientX: 400, clientY: 300 });
        }

        rig.time.advance(16);

        expect(rig.scales.length).toBe(changes + 1);
        expect(rig.controller.getScale()).toBeCloseTo(Math.exp(0.2), 10);

        wheel(rig, { deltaY: -4, clientX: 400, clientY: 300 });
        rig.time.advance(SETTLE_DELAY_MS + 32);

        expect(rig.settled).toEqual([rig.controller.getScale()]);
    });

    it('zooms out for a downward wheel and never past the limits', () => {
        const rig = createRig();
        rig.controller.setContentSize(SMALL);

        for (let index = 0; index < 60; index += 1) {
            wheel(rig, { deltaY: 100, clientX: 400, clientY: 300 });
            rig.time.advance(16);
        }

        expect(rig.controller.getScale()).toBe(0.1);

        for (let index = 0; index < 60; index += 1) {
            wheel(rig, { deltaY: -100, clientX: 400, clientY: 300 });
            rig.time.advance(16);
        }

        expect(rig.controller.getScale()).toBe(8);
    });

    it('in wheel mode leaves sideways and Shift scrolling to the browser', () => {
        const rig = createRig();
        rig.controller.setContentSize(SMALL);

        expect(wheel(rig, { deltaX: 40, deltaY: 0 }).defaultPrevented).toBe(false);
        expect(wheel(rig, { deltaY: 40, shiftKey: true }).defaultPrevented).toBe(false);
    });

    it('in ctrl-wheel mode scrolls with the plain wheel and zooms with Ctrl+wheel, keeping it from the page', () => {
        const rig = createRig({ wheelZoom: 'ctrl-wheel' });
        rig.controller.setContentSize(SMALL);

        expect(wheel(rig, { deltaY: -100 }).defaultPrevented).toBe(false);
        rig.time.advance(16);
        expect(rig.controller.getScale()).toBe(1);

        expect(wheel(rig, { deltaY: -100, ctrlKey: true, clientX: 400, clientY: 300 }).defaultPrevented).toBe(true);
        rig.time.advance(16);
        expect(rig.controller.getScale()).toBeCloseTo(Math.exp(0.2), 10);
    });

    it('takes over from a running animation without a jump, and the animation stops there', () => {
        const rig = createRig();
        rig.controller.setContentSize(SMALL);
        rig.controller.zoomIn();
        rig.time.advance(48);
        const midway = rig.controller.getScale();
        wheel(rig, { deltaY: -10, clientX: 400, clientY: 300 });
        rig.time.advance(16);
        const afterWheel = rig.controller.getScale();

        expect(afterWheel).toBeGreaterThan(midway);
        expect(afterWheel).toBeLessThan(midway * Math.exp(0.1) * 1.05);
        rig.time.advance(ZOOM_ANIMATION_MS);
        expect(rig.controller.getScale()).toBe(afterWheel);
    });

    it('ignores the wheel before there is content', () => {
        const rig = createRig();

        expect(wheel(rig, { deltaY: -100 }).defaultPrevented).toBe(false);
    });
});

describe('createZoomController panning and scrolling', () => {
    const pointer = (type: string, x: number, y: number, pointerType = 'mouse'): PointerEvent => new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        pointerId: 1,
        pointerType,
    });

    it('moves the content 1:1 with a mouse, pen or touch drag, kept inside its bounds', () => {
        for (const pointerType of ['mouse', 'pen', 'touch']) {
            const rig = createRig();
            rig.controller.setContentSize(LARGE, { scale: 1, scroll: { x: 400, y: 300 } });
            rig.viewport.dispatchEvent(pointer('pointerdown', 300, 300, pointerType));
            rig.viewport.dispatchEvent(pointer('pointermove', 330, 260, pointerType));
            rig.viewport.dispatchEvent(pointer('pointermove', 370, 210, pointerType));

            expect(rig.controller.getScroll(), pointerType).toEqual({ x: 330, y: 390 });

            rig.viewport.dispatchEvent(pointer('pointermove', 9000, -9000, pointerType));
            rig.viewport.dispatchEvent(pointer('pointerup', 9000, -9000, pointerType));

            expect(rig.controller.getScroll(), pointerType).toEqual({ x: 0, y: LARGE.height + 2 * CONTENT_PADDING - VIEW.height });
        }
    });

    it('does nothing for a click without movement, and never starts a browser drag', () => {
        const rig = createRig();
        rig.controller.setContentSize(LARGE, { scale: 1, scroll: { x: 100, y: 100 } });
        rig.viewport.dispatchEvent(pointer('pointerdown', 300, 300));
        rig.viewport.dispatchEvent(pointer('pointerup', 300, 300));
        const drag = new Event('dragstart', { bubbles: true, cancelable: true });
        rig.viewport.dispatchEvent(drag);

        expect(rig.controller.getScroll()).toEqual({ x: 100, y: 100 });
        expect(drag.defaultPrevented).toBe(true);
    });

    it('pans by dragging only when the content is larger than the view', () => {
        const rig = createRig();
        rig.controller.setContentSize(SMALL);

        expect(rig.viewport.dataset['pannable']).toBe('false');

        rig.controller.setContentSize(LARGE, { scale: 1, scroll: { x: 100, y: 100 } });

        expect(rig.viewport.dataset['pannable']).toBe('true');

        rig.viewport.dispatchEvent(pointer('pointerdown', 300, 300));
        expect(rig.viewport.dataset['panning']).toBe('true');
        rig.viewport.dispatchEvent(pointer('pointermove', 250, 280));
        rig.viewport.dispatchEvent(pointer('pointerup', 250, 280));

        expect(rig.controller.getScroll()).toEqual({ x: 150, y: 120 });
        expect(rig.viewport.dataset['panning']).toBeUndefined();
    });

    it('never pans when dragging is turned off', () => {
        const rig = createRig({ dragToPan: false });
        rig.controller.setContentSize(LARGE, { scale: 1, scroll: { x: 100, y: 100 } });

        expect(rig.viewport.dataset['pannable']).toBe('false');
        rig.viewport.dispatchEvent(pointer('pointerdown', 300, 300));
        expect(rig.viewport.dataset['panning']).toBeUndefined();
    });

    it('reports scrolling for the tab memory', () => {
        const onScroll = vi.fn();
        const rig = createRig({ onScroll });
        rig.controller.setContentSize(LARGE, { scale: 1, scroll: { x: 0, y: 0 } });
        rig.viewport.scrollTop = 40;
        rig.viewport.dispatchEvent(new Event('scroll'));

        expect(onScroll).toHaveBeenCalledWith({ x: 0, y: 40 });
    });

    it('scrolls to a content point smoothly, or at once when motion is reduced', () => {
        const rig = createRig();
        const scrollTo = vi.fn();
        rig.viewport.scrollTo = scrollTo as typeof rig.viewport.scrollTo;
        rig.controller.setContentSize(LARGE, { scale: 1, scroll: { x: 0, y: 0 } });
        rig.controller.scrollContentTo({ x: 0, y: 600 });

        expect(scrollTo).toHaveBeenCalledWith({ left: CONTENT_PADDING, top: 600 + CONTENT_PADDING, behavior: 'smooth' });

        const reduced = createRig({ prefersReducedMotion: () => true });
        reduced.viewport.scrollTo = scrollTo as typeof reduced.viewport.scrollTo;
        reduced.controller.setContentSize(LARGE, { scale: 1, scroll: { x: 0, y: 0 } });
        reduced.controller.scrollContentTo({ x: 800, y: 600 }, { align: 'center' });

        expect(scrollTo).toHaveBeenLastCalledWith({ left: 400 + CONTENT_PADDING, top: 300 + CONTENT_PADDING, behavior: 'auto' });
    });
});

describe('createZoomController relayout', () => {
    it('fits again when the window changes while fitted', () => {
        const rig = createRig();
        rig.controller.setContentSize(LARGE);
        setClientSize(rig.viewport, 400, 300);
        rig.controller.relayout();

        expect(rig.controller.getScale()).toBeCloseTo((300 - 2 * CONTENT_PADDING) / LARGE.height, 10);
        expect(rig.settled).toEqual([rig.controller.getScale()]);
    });

    it('keeps a chosen zoom and its centre point', () => {
        const rig = createRig();
        rig.controller.setContentSize(LARGE, { scale: 1, scroll: { x: 400, y: 300 } });
        const centre = contentPointUnder(rig, LARGE, { x: 400, y: 300 });
        setClientSize(rig.viewport, 600, 400);
        rig.controller.relayout();

        expect(rig.controller.getScale()).toBe(1);
        expect(contentPointUnder(rig, LARGE, { x: 300, y: 200 }).x).toBeCloseTo(centre.x, 6);
    });

    // Chrome keeps the scroll position inside the view as it changes size, before the layout can follow,
    // and tells it with a scroll event.
    function resizeAsChromeDoes(rig: Rig, width: number, height: number): void {
        setClientSize(rig.viewport, width, height);
        const maxLeft = Math.max(0, Number.parseFloat(rig.area.style.width) - width);
        const maxTop = Math.max(0, Number.parseFloat(rig.area.style.height) - height);
        rig.viewport.scrollLeft = Math.min(rig.viewport.scrollLeft, maxLeft);
        rig.viewport.scrollTop = Math.min(rig.viewport.scrollTop, maxTop);
        rig.viewport.dispatchEvent(new Event('scroll'));
        rig.controller.relayout();
    }

    it('keeps the middle of a page a little wider than the view across a narrower window and back', () => {
        const page: Size = { width: 816, height: 1056 };
        const rig = createRig({ fitMode: 'width', wheelZoom: 'ctrl-wheel', dragToPan: false });
        rig.controller.setContentSize(page, { scale: 1, scroll: { x: 24, y: 200 } });
        const middle = contentPointUnder(rig, page, { x: 400, y: 300 });

        resizeAsChromeDoes(rig, 450, 600);
        resizeAsChromeDoes(rig, 800, 600);

        expect(rig.controller.getScroll().x).toBeCloseTo(24, 6);
        expect(contentPointUnder(rig, page, { x: 400, y: 300 }).x).toBeCloseTo(middle.x, 6);
        expect(contentPointUnder(rig, page, { x: 400, y: 300 }).y).toBeCloseTo(middle.y, 6);
    });

    it('keeps the line being read in the middle of a document fitted to the width, over a sweep down to no room and back', () => {
        const document: Size = { width: 600, height: 14_000 };
        const rig = createRig({ fitMode: 'width', wheelZoom: 'ctrl-wheel', allowUpscaleOnFit: false, dragToPan: false });
        rig.controller.setContentSize(document);
        rig.controller.scrollContentTo({ x: 0, y: 700 }, { smooth: false });
        const reading = contentPointUnder(rig, document, { x: 400, y: 300 });

        for (const width of [700, 500, 300, 100, 0, 100, 300, 500, 700, 800]) {
            resizeAsChromeDoes(rig, width, width === 0 ? 0 : 600);
        }

        expect(contentPointUnder(rig, document, { x: 400, y: 300 }).y).toBeCloseTo(reading.y, 4);
    });

    it('keeps the line being read when a page fitted to the width grows, as when a picture arrives late', () => {
        const document: Size = { width: 600, height: 3000 };
        const rig = createRig({ fitMode: 'width', wheelZoom: 'ctrl-wheel', allowUpscaleOnFit: false, dragToPan: false });
        rig.controller.setContentSize(document);
        rig.controller.scrollContentTo({ x: 0, y: 900 }, { smooth: false });
        const reading = contentPointUnder(rig, document, { x: 400, y: 300 });

        const grown: Size = { width: 600, height: 3400 };
        rig.controller.resizeContent(grown);

        expect(rig.controller.isFitted()).toBe(true);
        expect(contentPointUnder(rig, grown, { x: 400, y: 300 }).y).toBeCloseTo(reading.y, 4);
        expect(Number.parseFloat(rig.layer.style.height)).toBeCloseTo(3400 * rig.controller.getScale(), 4);
    });

    it('keeps the place the reader scrolled to while the size stays', () => {
        const page: Size = { width: 816, height: 1056 };
        const rig = createRig({ fitMode: 'width', wheelZoom: 'ctrl-wheel', dragToPan: false });
        rig.controller.setContentSize(page, { scale: 1, scroll: { x: 0, y: 0 } });
        rig.viewport.scrollLeft = 40;
        rig.viewport.scrollTop = 300;
        rig.viewport.dispatchEvent(new Event('scroll'));
        const middle = contentPointUnder(rig, page, { x: 400, y: 300 });

        resizeAsChromeDoes(rig, 600, 500);

        expect(contentPointUnder(rig, page, { x: 300, y: 250 }).x).toBeCloseTo(middle.x, 6);
        expect(contentPointUnder(rig, page, { x: 300, y: 250 }).y).toBeCloseTo(middle.y, 6);
    });

    it('stops listening once destroyed', () => {
        const rig = createRig();
        rig.controller.setContentSize(SMALL);
        rig.controller.destroy();

        expect(wheel(rig, { deltaY: -100 }).defaultPrevented).toBe(false);
    });
});

describe('createZoomController fitted to the width, as documents are', () => {
    const DOCUMENT: Size = { width: 600, height: 6000 };
    const CENTRE = { x: VIEW.width / 2, y: VIEW.height / 2 };

    function documentRig(): Rig {
        return createRig({ fitMode: 'width', wheelZoom: 'ctrl-wheel', allowUpscaleOnFit: true, dragToPan: false });
    }

    it('resets to the width at the line being read, centred across, rather than at the middle of the document', () => {
        const rig = documentRig();
        rig.controller.setContentSize(DOCUMENT, { scale: 2, scroll: { x: 300, y: 4000 } });
        const reading = contentPointUnder(rig, DOCUMENT, CENTRE);
        rig.controller.reset();
        rig.time.advance(400);
        const fit = (VIEW.width - 2 * CONTENT_PADDING) / DOCUMENT.width;

        expect(rig.controller.isFitted()).toBe(true);
        expect(rig.controller.getScale()).toBeCloseTo(fit, 10);
        expect(contentPointUnder(rig, DOCUMENT, CENTRE).y).toBeCloseTo(reading.y, 4);
        expect(contentPointUnder(rig, DOCUMENT, CENTRE).x).toBeCloseTo(DOCUMENT.width / 2, 4);
    });

    it('fits the new width when the window changes, keeping the line in the middle of the view', () => {
        const rig = documentRig();
        rig.controller.setContentSize(DOCUMENT);
        rig.controller.scrollContentTo({ x: 0, y: 3000 }, { smooth: false });
        const reading = contentPointUnder(rig, DOCUMENT, CENTRE);
        setClientSize(rig.viewport, 500, 400);
        rig.controller.relayout();

        expect(rig.controller.isFitted()).toBe(true);
        expect(rig.controller.getScale()).toBeCloseTo((500 - 2 * CONTENT_PADDING) / DOCUMENT.width, 10);
        expect(contentPointUnder(rig, DOCUMENT, { x: 250, y: 200 }).y).toBeCloseTo(reading.y, 4);
    });

    it('holds the point under the pointer when Ctrl+wheel takes a centred page past the width of the view', () => {
        const rig = createRig({ fitMode: 'width', wheelZoom: 'ctrl-wheel', dragToPan: false });
        const page: Size = { width: 600, height: 900 };
        rig.controller.setContentSize(page);
        const pointer = { x: 150, y: 300 };
        const before = contentPointUnder(rig, page, pointer);

        wheel(rig, { deltaY: -100, ctrlKey: true, clientX: pointer.x, clientY: pointer.y });
        wheel(rig, { deltaY: -100, ctrlKey: true, clientX: pointer.x, clientY: pointer.y });
        rig.time.advance(16);
        const after = contentPointUnder(rig, page, pointer);

        expect(rig.controller.getScale() * page.width).toBeGreaterThan(VIEW.width);
        expect(after.x).toBeCloseTo(before.x, 6);
        expect(after.y).toBeCloseTo(before.y, 6);
    });

    it('keeps the top of a document at the top when zooming out there, opening no gap above it', () => {
        const rig = documentRig();
        rig.controller.setContentSize(DOCUMENT);
        wheel(rig, { deltaY: 100, ctrlKey: true, clientX: 400, clientY: 300 });
        rig.time.advance(16);

        expect(rig.controller.getScale()).toBeLessThan((VIEW.width - 2 * CONTENT_PADDING) / DOCUMENT.width);
        expect(shown(rig, DOCUMENT).offset.y).toBe(CONTENT_PADDING);
        expect(rig.controller.getScroll().y).toBe(0);
    });

    it('still fits a picture centred on Reset', () => {
        const rig = createRig();
        rig.controller.setContentSize(LARGE, { scale: 2, scroll: { x: 1200, y: 900 } });
        rig.controller.reset();
        rig.time.advance(400);

        expect(contentPointUnder(rig, LARGE, CENTRE).x).toBeCloseTo(LARGE.width / 2, 4);
        expect(contentPointUnder(rig, LARGE, CENTRE).y).toBeCloseTo(LARGE.height / 2, 4);
    });
});

describe('createZoomController viewer fits', () => {
    const DOCUMENT: Size = { width: 600, height: 6000 };
    const CENTRE = { x: VIEW.width / 2, y: VIEW.height / 2 };
    // One page of the document: its height fills the view, and the point to centre is its middle.
    const pageFit = (view: Size): { scale: number; point: Point } => ({ scale: view.height / 1000, point: { x: 300, y: 2500 } });

    function documentRig(): Rig {
        return createRig({ fitMode: 'width', wheelZoom: 'ctrl-wheel', allowUpscaleOnFit: false, dragToPan: false });
    }

    it('eases to the viewer\'s fit with its point in the middle of the view, and settles once', () => {
        const rig = documentRig();
        rig.controller.setContentSize(DOCUMENT);
        rig.controller.fitTo(pageFit);
        rig.time.advance(ZOOM_ANIMATION_MS / 2);

        expect(rig.controller.hasViewerFit()).toBe(true);
        expect(rig.controller.getScale()).not.toBeCloseTo(0.6, 3);
        rig.time.advance(ZOOM_ANIMATION_MS + SETTLE_DELAY_MS);

        expect(rig.controller.getScale()).toBeCloseTo(0.6, 10);
        expect(rig.controller.isFitted()).toBe(false);
        expect(contentPointUnder(rig, DOCUMENT, CENTRE).y).toBeCloseTo(2500, 4);
        expect(rig.settled).toEqual([0.6]);
    });

    it('lands at once when asked not to animate', () => {
        const rig = documentRig();
        rig.controller.setContentSize(DOCUMENT);
        rig.controller.fitTo(pageFit, { animate: false });

        expect(rig.controller.getScale()).toBeCloseTo(0.6, 10);
        expect(contentPointUnder(rig, DOCUMENT, CENTRE).y).toBeCloseTo(2500, 4);
        expect(rig.viewport.dataset['zooming']).toBeUndefined();
    });

    it('fits again when the view changes size, until a zoom of any kind leaves it', () => {
        const rig = documentRig();
        rig.controller.setContentSize(DOCUMENT);
        rig.controller.fitTo(pageFit, { animate: false });
        setClientSize(rig.viewport, 800, 400);
        rig.controller.relayout();

        expect(rig.controller.getScale()).toBeCloseTo(0.4, 10);
        expect(contentPointUnder(rig, DOCUMENT, { x: 400, y: 200 }).y).toBeCloseTo(2500, 4);
        rig.controller.zoomIn();

        expect(rig.controller.hasViewerFit()).toBe(false);
        rig.controller.fitTo(pageFit, { animate: false });
        wheel(rig, { deltaY: -100, ctrlKey: true, clientX: 400, clientY: 200 });

        expect(rig.controller.hasViewerFit()).toBe(false);
        rig.controller.fitTo(pageFit, { animate: false });
        rig.controller.reset();

        expect(rig.controller.hasViewerFit()).toBe(false);
        expect(rig.controller.isFitted()).toBe(true);
    });

    it('does nothing without content or when the viewer has nothing to fit', () => {
        const rig = documentRig();
        rig.controller.fitTo(pageFit);

        expect(rig.controller.hasViewerFit()).toBe(false);
        rig.controller.setContentSize(DOCUMENT);
        rig.controller.fitTo(() => null);

        expect(rig.controller.hasViewerFit()).toBe(false);
        expect(rig.controller.isFitted()).toBe(true);
    });
});
