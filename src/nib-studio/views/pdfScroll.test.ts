import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeAnimationClock, setClientSize, type FakeAnimationClock } from '../testing/fakeAnimationClock.js';
import { centreTargetOf, JUMP_DURATION_MS, jumpScroll, reachableScroll } from './pdfScroll.js';

let viewport: HTMLElement;
let time: FakeAnimationClock;

beforeEach(() => {
    viewport = document.createElement('div');
    document.body.append(viewport);
    setClientSize(viewport, 800, 600);
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, get: () => 20_000 });
    Object.defineProperty(viewport, 'scrollWidth', { configurable: true, get: () => 1600 });
    time = createFakeAnimationClock();
});

afterEach(() => {
    viewport.remove();
});

describe('jumpScroll', () => {
    it('eases to the target within the jump\'s time, through positions in between', () => {
        const onDone = vi.fn();
        jumpScroll(viewport, { x: 0, y: 10_000 }, { prefersReducedMotion: false, clock: time.clock, onDone });
        const seen: number[] = [];

        for (let elapsed = 0; elapsed < JUMP_DURATION_MS; elapsed += 48) {
            time.advance(48);
            seen.push(viewport.scrollTop);
        }

        time.advance(48);

        expect(viewport.dataset['jumping']).toBeUndefined();
        expect(viewport.scrollTop).toBe(10_000);
        expect(new Set(seen).size).toBeGreaterThan(3);
        expect(seen.every((value, index) => index === 0 || value >= (seen[index - 1] ?? 0))).toBe(true);
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('marks the viewport while it runs, so pages passed on the way are not drawn', () => {
        jumpScroll(viewport, { x: 0, y: 4000 }, { prefersReducedMotion: false, clock: time.clock });
        time.advance(16);

        expect(viewport.dataset['jumping']).toBe('true');
    });

    it('stops where it is when the viewer turns the wheel', () => {
        const onDone = vi.fn();
        jumpScroll(viewport, { x: 0, y: 10_000 }, { prefersReducedMotion: false, clock: time.clock, onDone });
        time.advance(64);
        const stoppedAt = viewport.scrollTop;
        viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
        time.advance(400);

        expect(viewport.scrollTop).toBe(stoppedAt);
        expect(viewport.dataset['jumping']).toBeUndefined();
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('lands at once when motion is reduced', () => {
        const onDone = vi.fn();
        jumpScroll(viewport, { x: 50, y: 7000 }, { prefersReducedMotion: true, clock: time.clock, onDone });

        expect([viewport.scrollLeft, viewport.scrollTop]).toEqual([50, 7000]);
        expect(onDone).toHaveBeenCalledTimes(1);
        expect(time.pendingFrames()).toBe(0);
    });

    it('keeps the target within what can scroll', () => {
        jumpScroll(viewport, { x: -40, y: 99_999 }, { prefersReducedMotion: true, clock: time.clock });

        expect([viewport.scrollLeft, viewport.scrollTop]).toEqual([0, 19_400]);
    });

    it('stops only on the events it is given, so a page turn rides out the wheel', () => {
        jumpScroll(viewport, { x: 0, y: 10_000 }, { prefersReducedMotion: false, clock: time.clock, stopOn: ['pointerdown'] });
        time.advance(48);
        viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
        time.advance(JUMP_DURATION_MS);

        expect(viewport.scrollTop).toBe(10_000);
    });
});

describe('reachableScroll', () => {
    it('keeps a scroll position within what the viewport can scroll', () => {
        expect(reachableScroll(viewport, { x: 900, y: -5 })).toEqual({ x: 800, y: 0 });
    });
});

describe('centreTargetOf', () => {
    it('puts the middle of a box on screen in the middle of the view', () => {
        viewport.scrollTop = 1000;
        vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ top: 50, left: 0, width: 800, height: 600 } as DOMRect);

        expect(centreTargetOf(viewport, { left: 100, top: 950, width: 40, height: 20 })).toEqual({ x: 120 - 400, y: 1000 + 960 - 50 - 300 });
    });
});
