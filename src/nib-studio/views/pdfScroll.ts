import { easeOutCubic, type Point } from './previewZoom.js';
import { BROWSER_CLOCK, type AnimationClock } from './previewZoomController.js';

// How long a jump to a page takes, whatever the distance, so a far page comes as quickly as a near one.
export const JUMP_DURATION_MS = 320;

// Events that mean the viewer takes over the scroll, which stops a jump where it is.
const TAKEOVER_EVENTS = ['wheel', 'pointerdown', 'keydown', 'touchstart'];

export interface ScrollJump {
    cancel(): void;
}

interface JumpScrollOptions {
    readonly prefersReducedMotion: boolean;
    readonly clock?: AnimationClock;
    readonly onDone?: () => void;
    // The events that stop the jump where it is; by default the wheel, a press of the pointer, a key or a touch.
    readonly stopOn?: ReadonlyArray<string>;
}

// The scroll position nearest `target` that the viewport can reach.
export function reachableScroll(viewport: HTMLElement, target: Point): Point {
    return {
        x: clampTo(target.x, viewport.scrollWidth - viewport.clientWidth),
        y: clampTo(target.y, viewport.scrollHeight - viewport.clientHeight),
    };
}

// Scrolls the viewport to `target`, easing out over JUMP_DURATION_MS, or at once when motion is reduced.
// While it runs the viewport carries data-jumping, so the pages it passes are not drawn on the way.
export function jumpScroll(viewport: HTMLElement, target: Point, options: JumpScrollOptions): ScrollJump {
    const clock = options.clock ?? BROWSER_CLOCK;
    const stopOn = options.stopOn ?? TAKEOVER_EVENTS;
    const { x: left, y: top } = reachableScroll(viewport, target);

    if (options.prefersReducedMotion) {
        viewport.scrollLeft = left;
        viewport.scrollTop = top;
        options.onDone?.();

        return { cancel: () => {} };
    }

    const from = { x: viewport.scrollLeft, y: viewport.scrollTop };
    const start = clock.now();
    let handle: number | null = null;

    const stop = (): void => {
        if (handle == null) {
            return;
        }

        clock.cancelFrame(handle);
        handle = null;
        delete viewport.dataset['jumping'];

        for (const type of stopOn) {
            viewport.removeEventListener(type, stop);
        }

        options.onDone?.();
    };

    const step = (): void => {
        const progress = easeOutCubic((clock.now() - start) / JUMP_DURATION_MS);
        viewport.scrollLeft = from.x + (left - from.x) * progress;
        viewport.scrollTop = from.y + (top - from.y) * progress;

        if (progress >= 1) {
            stop();

            return;
        }

        handle = clock.requestFrame(step);
    };

    viewport.dataset['jumping'] = 'true';

    for (const type of stopOn) {
        viewport.addEventListener(type, stop, { passive: true });
    }

    handle = clock.requestFrame(step);

    return { cancel: stop };
}

function clampTo(value: number, maximum: number): number {
    return Math.min(Math.max(0, value), Math.max(0, maximum));
}

// The scroll position that puts the middle of a box on screen, such as a match, in the middle of the view.
export function centreTargetOf(viewport: HTMLElement, box: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): Point {
    const view = viewport.getBoundingClientRect();

    return {
        x: viewport.scrollLeft + box.left + box.width / 2 - (view.left + viewport.clientLeft) - viewport.clientWidth / 2,
        y: viewport.scrollTop + box.top + box.height / 2 - (view.top + viewport.clientTop) - viewport.clientHeight / 2,
    };
}
