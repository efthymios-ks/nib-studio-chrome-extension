import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setClientSize } from '../testing/fakeAnimationClock.js';
import { attachPdfPan, SPACE_SCROLL_FRACTION } from './pdfPan.js';

let viewport: HTMLElement;
let detach: () => void;
let reducedMotion = false;

function key(type: 'keydown' | 'keyup', init: KeyboardEventInit, target: EventTarget = viewport): KeyboardEvent {
    const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, key: ' ', code: 'Space', ...init });
    target.dispatchEvent(event);

    return event;
}

// happy-dom's PointerEvent leaves out the button and position, so they are set on the event itself.
function pointer(type: string, init: { button?: number; clientX?: number; clientY?: number; pointerId?: number }): PointerEvent {
    const event = new PointerEvent(type, { bubbles: true, cancelable: true });

    for (const [name, value] of Object.entries({ button: 0, clientX: 0, clientY: 0, pointerId: 1, ...init })) {
        Object.defineProperty(event, name, { value });
    }

    viewport.dispatchEvent(event);

    return event;
}

beforeEach(() => {
    viewport = document.createElement('div');
    viewport.tabIndex = 0;
    document.body.append(viewport);
    setClientSize(viewport, 800, 600);
    viewport.scrollLeft = 300;
    viewport.scrollTop = 1000;
    viewport.scrollBy = vi.fn();
    reducedMotion = false;
    detach = attachPdfPan(viewport, { prefersReducedMotion: () => reducedMotion });
});

afterEach(() => {
    detach();
    viewport.remove();
});

describe('attachPdfPan', () => {
    it('shows it can pan while Space is held, and keeps Space from scrolling', () => {
        const down = key('keydown', {});

        expect(down.defaultPrevented).toBe(true);
        expect(viewport.dataset['panMode']).toBe('ready');
    });

    it('pans with Space held and a drag, without a page scroll on release', () => {
        key('keydown', {});
        const press = pointer('pointerdown', { clientX: 400, clientY: 300 });
        pointer('pointermove', { clientX: 350, clientY: 220 });

        expect(press.defaultPrevented).toBe(true);
        expect(viewport.dataset['panMode']).toBe('panning');
        expect([viewport.scrollLeft, viewport.scrollTop]).toEqual([350, 1080]);
        pointer('pointerup', {});
        key('keyup', {});

        expect(viewport.scrollBy).not.toHaveBeenCalled();
        expect(viewport.dataset['panMode']).toBeUndefined();
    });

    it('pans with a middle-button drag, and keeps the middle button from autoscrolling', () => {
        const press = pointer('pointerdown', { button: 1, clientX: 400, clientY: 300 });
        pointer('pointermove', { clientX: 420, clientY: 340 });
        pointer('pointerup', {});
        const mouse = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1 });
        viewport.dispatchEvent(mouse);

        expect(press.defaultPrevented).toBe(true);
        expect([viewport.scrollLeft, viewport.scrollTop]).toEqual([280, 960]);
        expect(mouse.defaultPrevented).toBe(true);
    });

    it('leaves a plain drag alone, so it selects text', () => {
        const press = pointer('pointerdown', { clientX: 400, clientY: 300 });
        pointer('pointermove', { clientX: 300, clientY: 200 });

        expect(press.defaultPrevented).toBe(false);
        expect([viewport.scrollLeft, viewport.scrollTop]).toEqual([300, 1000]);
    });

    it('scrolls a page on a tap of Space, and back with Shift', () => {
        key('keydown', {});
        key('keyup', {});
        key('keydown', { shiftKey: true });
        key('keyup', { shiftKey: true });

        expect(viewport.scrollBy).toHaveBeenNthCalledWith(1, { top: 600 * SPACE_SCROLL_FRACTION, behavior: 'smooth' });
        expect(viewport.scrollBy).toHaveBeenNthCalledWith(2, { top: -600 * SPACE_SCROLL_FRACTION, behavior: 'smooth' });
    });

    it('lets Fit page take a tap of Space, and scrolls when it does not', () => {
        detach();
        const onSpaceTap = vi.fn((direction: 1 | -1) => direction > 0);
        detach = attachPdfPan(viewport, { prefersReducedMotion: () => reducedMotion, onSpaceTap });
        key('keydown', {});
        key('keyup', {});
        key('keydown', { shiftKey: true });
        key('keyup', { shiftKey: true });

        expect(onSpaceTap.mock.calls).toEqual([[1], [-1]]);
        expect(viewport.scrollBy).toHaveBeenCalledTimes(1);
        expect(viewport.scrollBy).toHaveBeenCalledWith({ top: -600 * SPACE_SCROLL_FRACTION, behavior: 'smooth' });
    });

    it('scrolls at once when motion is reduced', () => {
        reducedMotion = true;
        key('keydown', {});
        key('keyup', {});

        expect(viewport.scrollBy).toHaveBeenCalledWith({ top: 600 * SPACE_SCROLL_FRACTION, behavior: 'auto' });
    });

    it('ignores Space typed in a box and with Ctrl', () => {
        const box = document.createElement('input');
        viewport.append(box);

        expect(key('keydown', {}, box).defaultPrevented).toBe(false);
        expect(key('keydown', { ctrlKey: true }).defaultPrevented).toBe(false);
        expect(viewport.dataset['panMode']).toBeUndefined();
    });

    it('stops listening once detached', () => {
        detach();

        expect(key('keydown', {}).defaultPrevented).toBe(false);
        detach = () => {};
    });
});
