// A hand-driven clock for animation frames and timers, so zoom tests step through time exactly.
import type { AnimationClock } from '../views/previewZoomController.js';

export interface FakeAnimationClock {
    readonly clock: AnimationClock;
    // Moves time on in 16 ms frames, running the frames and timers that fall due.
    advance(milliseconds: number): void;
    pendingFrames(): number;
}

const FRAME_MS = 16;

export function createFakeAnimationClock(): FakeAnimationClock {
    let time = 0;
    let nextHandle = 1;
    const frames = new Map<number, () => void>();
    const timers = new Map<number, { readonly at: number; readonly callback: () => void }>();

    const runFrames = (): void => {
        const due = [...frames.values()];
        frames.clear();

        for (const callback of due) {
            callback();
        }
    };

    const runTimers = (): void => {
        for (const [handle, timer] of [...timers.entries()].sort((left, right) => left[1].at - right[1].at)) {
            if (timer.at <= time && timers.has(handle)) {
                timers.delete(handle);
                timer.callback();
            }
        }
    };

    return {
        clock: {
            now: () => time,
            requestFrame: (callback) => {
                const handle = nextHandle;
                nextHandle += 1;
                frames.set(handle, callback);

                return handle;
            },
            cancelFrame: (handle) => {
                frames.delete(handle);
            },
            setTimer: (callback, milliseconds) => {
                const handle = nextHandle;
                nextHandle += 1;
                timers.set(handle, { at: time + milliseconds, callback });

                return handle;
            },
            clearTimer: (handle) => {
                timers.delete(handle);
            },
        },
        advance: (milliseconds) => {
            const end = time + milliseconds;

            while (time < end) {
                time = Math.min(end, time + FRAME_MS);
                runFrames();
                runTimers();
            }
        },
        pendingFrames: () => frames.size,
    };
}

// Gives an element the client size a browser would lay it out at; happy-dom has no layout.
export function setClientSize(element: HTMLElement, width: number, height: number): void {
    Object.defineProperty(element, 'clientWidth', { configurable: true, get: () => width });
    Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => height });
}
