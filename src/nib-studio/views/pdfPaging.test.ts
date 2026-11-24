import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeAnimationClock, setClientSize, type FakeAnimationClock } from '../testing/fakeAnimationClock.js';
import { attachPdfPaging, createWheelGesture, GESTURE_GAP_MS, PAGE_TURN_THRESHOLD, type PdfPaging, type PdfPagingOptions } from './pdfPaging.js';
import { JUMP_DURATION_MS } from './pdfScroll.js';

const PAGE_PITCH = 1000;

let viewport: HTMLElement;
let time: FakeAnimationClock;
let isOn: boolean;
let currentPage: number;
let paging: PdfPaging | null = null;
let reducedMotion: boolean;

// Pages 1000 pixels apart, each centred when the scroll is a multiple of that.
function attach(overrides: Partial<PdfPagingOptions> = {}): PdfPaging {
    paging = attachPdfPaging({
        viewport,
        isOn: () => isOn,
        pageCount: () => 5,
        currentPage: () => currentPage,
        targetFor: (index) => ({ x: 0, y: index * PAGE_PITCH }),
        prefersReducedMotion: () => reducedMotion,
        clock: time.clock,
        onLanded: () => {
            currentPage = Math.round(viewport.scrollTop / PAGE_PITCH);
        },
        ...overrides,
    });

    return paging;
}

function wheel(deltaY: number, init: WheelEventInit = {}): WheelEvent {
    const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, 'ctrlKey', { value: init.ctrlKey ?? false });
    viewport.dispatchEvent(event);

    return event;
}

function key(name: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
    viewport.dispatchEvent(event);

    return event;
}

beforeEach(() => {
    viewport = document.createElement('div');
    document.body.append(viewport);
    setClientSize(viewport, 800, 600);
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, get: () => 5000 });
    time = createFakeAnimationClock();
    isOn = true;
    currentPage = 0;
    reducedMotion = true;
});

afterEach(() => {
    paging?.detach();
    paging = null;
    viewport.remove();
});

describe('createWheelGesture', () => {
    it('collects a gesture\'s travel until it is enough for one page', () => {
        const gesture = createWheelGesture();

        expect(gesture.feed(20, 0, false)).toBe(0);
        expect(gesture.feed(20, 16, false)).toBe(0);
        expect(gesture.feed(PAGE_TURN_THRESHOLD, 32, false)).toBe(1);
    });

    it('turns one page for a whole gesture, however long it coasts, and the next gesture turns the next', () => {
        const gesture = createWheelGesture();
        const turns = Array.from({ length: 60 }, (_, index) => gesture.feed(40, index * 16, false));

        expect(turns.filter((turn) => turn !== 0)).toEqual([1]);
        expect(gesture.feed(100, 59 * 16 + GESTURE_GAP_MS, false)).toBe(1);
    });

    it('ignores a gesture that comes while a page is turning, even after the turn ends', () => {
        const gesture = createWheelGesture();

        expect(gesture.feed(100, 0, true)).toBe(0);
        expect(gesture.feed(100, 50, false)).toBe(0);
        expect(gesture.feed(100, 50 + GESTURE_GAP_MS, false)).toBe(1);
    });

    it('starts over when the direction changes or the gesture pauses, and turns back with an upward wheel', () => {
        const gesture = createWheelGesture();

        expect(gesture.feed(40, 0, false)).toBe(0);
        expect(gesture.feed(-40, 16, false)).toBe(0);
        expect(gesture.feed(-20, 32, false)).toBe(-1);
        expect(gesture.feed(40, 500, false)).toBe(0);
        expect(gesture.feed(40, 500 + GESTURE_GAP_MS, false)).toBe(0);
    });
});

describe('attachPdfPaging', () => {
    it('turns one page per wheel notch in Fit page, and keeps the wheel from scrolling', () => {
        attach();
        const notch = wheel(100);

        expect(notch.defaultPrevented).toBe(true);
        expect(viewport.scrollTop).toBe(1000);
        wheel(100);

        expect(viewport.scrollTop).toBe(1000);
        time.advance(GESTURE_GAP_MS);
        wheel(-100);

        expect(viewport.scrollTop).toBe(0);
    });

    it('ignores the wheel while a turn eases, then turns again for the next gesture, never skipping', () => {
        reducedMotion = false;
        attach();
        wheel(100);

        for (let frame = 0; frame < 10; frame += 1) {
            time.advance(16);
            wheel(100);
        }

        time.advance(JUMP_DURATION_MS);

        expect(viewport.scrollTop).toBe(1000);
        time.advance(GESTURE_GAP_MS);
        wheel(100);
        time.advance(JUMP_DURATION_MS + 16);

        expect(viewport.scrollTop).toBe(2000);
    });

    it('eases each turn over the jump time, through positions in between', () => {
        reducedMotion = false;
        attach();
        key('PageDown');
        time.advance(JUMP_DURATION_MS / 2);

        expect(viewport.scrollTop).toBeGreaterThan(0);
        expect(viewport.scrollTop).toBeLessThan(1000);
        time.advance(JUMP_DURATION_MS);

        expect(viewport.scrollTop).toBe(1000);
    });

    it('turns with PageDown, PageUp, the arrows, Home and End, from the page a quick press is heading to', () => {
        reducedMotion = false;
        attach();
        key('PageDown');
        key('ArrowDown');
        time.advance(JUMP_DURATION_MS + 16);

        expect(viewport.scrollTop).toBe(2000);
        key('PageUp');
        time.advance(JUMP_DURATION_MS + 16);

        expect(viewport.scrollTop).toBe(1000);
        key('End');
        time.advance(JUMP_DURATION_MS + 16);

        expect(viewport.scrollTop).toBe(4000);
        key('Home');
        time.advance(JUMP_DURATION_MS + 16);

        expect(viewport.scrollTop).toBe(0);
        expect(key('ArrowUp').defaultPrevented).toBe(true);
    });

    it('stops at the first and last pages, centring a page left off centre', () => {
        attach();
        key('ArrowUp');

        expect(viewport.scrollTop).toBe(0);
        currentPage = 4;
        viewport.scrollTop = 3900;
        key('PageDown');

        expect(viewport.scrollTop).toBe(4000);
        key('PageDown');

        expect(viewport.scrollTop).toBe(4000);
    });

    it('turns for a tap of Space only in Fit page', () => {
        const pager = attach();

        expect(pager.turnBySpace(1)).toBe(true);
        expect(viewport.scrollTop).toBe(1000);
        isOn = false;

        expect(pager.turnBySpace(1)).toBe(false);
    });

    it('leaves the wheel and keys alone outside Fit page, with Ctrl, sideways, in a text box or mid-zoom', () => {
        attach();
        isOn = false;

        expect(wheel(100).defaultPrevented).toBe(false);
        expect(key('PageDown').defaultPrevented).toBe(false);
        isOn = true;

        expect(wheel(100, { ctrlKey: true }).defaultPrevented).toBe(false);
        expect(wheel(10, { deltaX: 80 }).defaultPrevented).toBe(false);
        const input = document.createElement('input');
        viewport.append(input);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true }));
        viewport.dataset['zooming'] = 'true';
        key('PageDown');

        expect(viewport.scrollTop).toBe(0);
    });

    it('goes straight to a page, and stops a turn part way when asked', () => {
        reducedMotion = false;
        const pager = attach();
        pager.goTo(3);
        time.advance(JUMP_DURATION_MS / 3);
        pager.stop();
        const stoppedAt = viewport.scrollTop;
        time.advance(JUMP_DURATION_MS);

        expect(stoppedAt).toBeGreaterThan(0);
        expect(viewport.scrollTop).toBe(stoppedAt);
    });

    it('stops listening once detached', () => {
        attach().detach();
        paging = null;

        expect(wheel(100).defaultPrevented).toBe(false);
    });
});
