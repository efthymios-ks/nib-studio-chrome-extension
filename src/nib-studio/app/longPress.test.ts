import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LONG_PRESS_DELAY_MS, attachLongPress } from './longPress.js';

let detach: (() => void) | null = null;

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    detach?.();
    detach = null;
    vi.useRealTimers();
    document.body.replaceChildren();
});

function pointer(type: string, pointerType: string, clientX = 10, clientY = 20): PointerEvent {
    return new PointerEvent(type, { pointerType, clientX, clientY, isPrimary: true, bubbles: true });
}

function setup(): { element: HTMLElement; menus: MouseEvent[] } {
    const element = document.createElement('div');
    document.body.append(element);
    const menus: MouseEvent[] = [];
    element.addEventListener('contextmenu', (event) => menus.push(event as MouseEvent));
    detach = attachLongPress(element);

    return { element, menus };
}

describe('attachLongPress', () => {
    it('fires contextmenu at the press point after the delay', () => {
        const { element, menus } = setup();

        element.dispatchEvent(pointer('pointerdown', 'touch', 30, 40));
        vi.advanceTimersByTime(LONG_PRESS_DELAY_MS - 1);
        expect(menus).toHaveLength(0);

        vi.advanceTimersByTime(1);
        expect(menus).toHaveLength(1);
        expect(menus[0]?.clientX).toBe(30);
        expect(menus[0]?.clientY).toBe(40);
    });

    it('does not fire when the finger lifts early', () => {
        const { element, menus } = setup();

        element.dispatchEvent(pointer('pointerdown', 'touch'));
        vi.advanceTimersByTime(200);
        element.dispatchEvent(pointer('pointerup', 'touch'));
        vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);

        expect(menus).toHaveLength(0);
    });

    it('cancels when the finger moves', () => {
        const { element, menus } = setup();

        element.dispatchEvent(pointer('pointerdown', 'touch', 10, 10));
        element.dispatchEvent(pointer('pointermove', 'touch', 40, 10));
        vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);

        expect(menus).toHaveLength(0);
    });

    it('ignores the mouse, which has right-click', () => {
        const { element, menus } = setup();

        element.dispatchEvent(pointer('pointerdown', 'mouse'));
        vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);

        expect(menus).toHaveLength(0);
    });

    it('swallows the click that follows a long-press', () => {
        const { element } = setup();
        const clicks = vi.fn();
        element.addEventListener('click', clicks);

        element.dispatchEvent(pointer('pointerdown', 'touch'));
        vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);
        element.dispatchEvent(pointer('pointerup', 'touch'));
        element.click();

        expect(clicks).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1000);
        element.click();

        expect(clicks).toHaveBeenCalledTimes(1);
    });

    it('lets the browser menu through when it arrives first', () => {
        const { element, menus } = setup();

        element.dispatchEvent(pointer('pointerdown', 'touch'));
        element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);

        expect(menus).toHaveLength(1);
    });
});
