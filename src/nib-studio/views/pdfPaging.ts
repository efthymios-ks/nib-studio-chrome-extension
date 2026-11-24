import { isTextEntry } from './previewFrame.js';
import { wheelDeltaPixels, type Point } from './previewZoom.js';
import { BROWSER_CLOCK, type AnimationClock } from './previewZoomController.js';
import { jumpScroll, reachableScroll, type ScrollJump } from './pdfScroll.js';

// Fit page: one wheel gesture, PageDown or PageUp, ↓ or ↑,
// or a tap of Space or Shift+Space moves exactly one page,
// in one eased scroll that lands with the page whole in the middle of the view. Home and End go to the first and last page.

// Wheel travel that turns a page: half a mouse-wheel notch,
// so a notch turns one page and a light touch on a trackpad doesn't.
export const PAGE_TURN_THRESHOLD = 50;

// A pause this long between wheel events ends a gesture,
// so a trackpad still coasting after a flick never turns a second page.
export const GESTURE_GAP_MS = 120;

// Only a press of the pointer or a touch stops a page turn;
// the wheel and keys meanwhile are the turn's own input.
const TURN_STOPS = ['pointerdown', 'touchstart'];

const PAGE_KEYS: Readonly<Record<string, 1 | -1>> = Object.freeze({
    PageDown: 1,
    ArrowDown: 1,
    PageUp: -1,
    ArrowUp: -1,
});

export interface WheelGesture {
    // Takes one wheel event's travel in pixels; returns 1 or -1 to turn a page that way, or 0.
    feed(deltaPixels: number, now: number, isTurning: boolean): -1 | 0 | 1;
}

// Collects a gesture's travel until it is enough for a page. Once a gesture has turned a page, or arrived
// while a page was turning, the rest of it is ignored;
// the next gesture starts after a pause of GESTURE_GAP_MS.
export function createWheelGesture(): WheelGesture {
    let collected = 0;
    let lastAt = Number.NEGATIVE_INFINITY;
    let hasTurned = false;

    return {
        feed: (deltaPixels, now, isTurning) => {
            if (now - lastAt >= GESTURE_GAP_MS) {
                collected = 0;
                hasTurned = false;
            }

            lastAt = now;

            if (isTurning) {
                hasTurned = true;

                return 0;
            }

            if (hasTurned || deltaPixels === 0) {
                return 0;
            }

            if (Math.sign(deltaPixels) !== Math.sign(collected)) {
                collected = 0;
            }

            collected += deltaPixels;

            if (Math.abs(collected) < PAGE_TURN_THRESHOLD) {
                return 0;
            }

            const direction = collected > 0 ? 1 : -1;
            collected = 0;
            hasTurned = true;

            return direction;
        },
    };
}

export interface PdfPagingOptions {
    readonly viewport: HTMLElement;
    // Whether Fit page is on with a document shown.
    readonly isOn: () => boolean;
    readonly pageCount: () => number;
    // The page being read.
    readonly currentPage: () => number;
    // The scroll position that puts a page whole in the middle of the view.
    readonly targetFor: (index: number) => Point | null;
    readonly prefersReducedMotion: () => boolean;
    readonly clock?: AnimationClock;
    // Called when a turn lands, or stops part way.
    readonly onLanded?: () => void;
}

export interface PdfPaging {
    // Moves to a page and centres it; the page box, links and Find use it in Fit page.
    goTo(index: number): void;
    // For a tap of Space: turns a page and returns true in Fit page, and returns false otherwise.
    turnBySpace(direction: 1 | -1): boolean;
    // Stops a turn where it is, such as when a zoom leaves Fit page.
    stop(): void;
    detach(): void;
}

interface Turn {
    readonly page: number;
    jump: ScrollJump | null;
}

export function attachPdfPaging(options: PdfPagingOptions): PdfPaging {
    const { viewport } = options;
    const clock = options.clock ?? BROWSER_CLOCK;
    const gesture = createWheelGesture();
    let turning: Turn | null = null;

    const isZooming = (): boolean => viewport.dataset['zooming'] === 'true';

    const lastIndex = (): number => Math.max(0, options.pageCount() - 1);
    const clampPage = (index: number): number => Math.min(Math.max(0, index), lastIndex());

    const goTo = (index: number): void => {
        const page = clampPage(index);
        const target = options.targetFor(page);

        if (target == null) {
            return;
        }

        const previous = turning;
        const next: Turn = { page, jump: null };
        turning = next;
        previous?.jump?.cancel();
        next.jump = jumpScroll(viewport, target, {
            prefersReducedMotion: options.prefersReducedMotion(),
            clock,
            stopOn: TURN_STOPS,
            onDone: () => {
                if (turning === next) {
                    turning = null;
                }

                options.onLanded?.();
            },
        });
    };

    const isCentred = (index: number): boolean => {
        const target = options.targetFor(index);

        if (target == null) {
            return true;
        }

        const reachable = reachableScroll(viewport, target);

        return Math.abs(viewport.scrollTop - reachable.y) < 1 && Math.abs(viewport.scrollLeft - reachable.x) < 1;
    };

    // Moves one page on or back from the one being read, or the one a turn is heading to.
    const turn = (direction: 1 | -1): void => {
        if (options.pageCount() <= 0) {
            return;
        }

        const from = turning?.page ?? options.currentPage();
        const to = clampPage(from + direction);

        // At the first or last page there is nowhere to go, though a page left off centre is centred again.
        if (to === from && (turning != null || isCentred(to))) {
            return;
        }

        goTo(to);
    };

    const onWheel = (event: WheelEvent): void => {
        const isSideways = Math.abs(event.deltaX) > Math.abs(event.deltaY);

        if (!options.isOn() || event.ctrlKey || event.metaKey || isSideways) {
            return;
        }

        event.preventDefault();
        const pixels = wheelDeltaPixels(event.deltaY, event.deltaMode, viewport.clientHeight);
        const direction = gesture.feed(pixels, clock.now(), turning != null || isZooming());

        if (direction !== 0) {
            turn(direction);
        }
    };

    const onKeyDown = (event: KeyboardEvent): void => {
        if (!options.isOn() || event.ctrlKey || event.altKey || event.metaKey || isTextEntry(event.target)) {
            return;
        }

        const direction = PAGE_KEYS[event.key];
        const isHomeOrEnd = event.key === 'Home' || event.key === 'End';

        if (direction == null && !isHomeOrEnd) {
            return;
        }

        event.preventDefault();

        if (isZooming()) {
            return;
        }

        if (direction != null) {
            turn(direction);

            return;
        }

        goTo(event.key === 'Home' ? 0 : lastIndex());
    };

    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('keydown', onKeyDown);

    const stop = (): void => {
        const current = turning;
        turning = null;
        current?.jump?.cancel();
    };

    return {
        goTo,
        turnBySpace: (direction) => {
            if (!options.isOn()) {
                return false;
            }

            if (!isZooming()) {
                turn(direction);
            }

            return true;
        },
        stop,
        detach: () => {
            stop();
            viewport.removeEventListener('wheel', onWheel);
            viewport.removeEventListener('keydown', onKeyDown);
        },
    };
}
