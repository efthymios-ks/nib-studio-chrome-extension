import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeResize, type FrameScheduler } from './observeResize.js';

interface FakeEntry {
    readonly contentRect: { readonly width: number; readonly height: number };
    readonly borderBoxSize?: ReadonlyArray<{ readonly inlineSize: number; readonly blockSize: number }>;
}

class FakeResizeObserver {
    static latest: FakeResizeObserver | null = null;

    box: string | null = null;
    disconnected = false;

    constructor(readonly callback: (entries: ReadonlyArray<FakeEntry>) => void) {
        FakeResizeObserver.latest = this;
    }

    observe(_target: Element, options?: { readonly box?: string }): void {
        this.box = options?.box ?? null;
    }

    disconnect(): void {
        this.disconnected = true;
    }

    report(width: number, height: number, border?: { readonly width: number; readonly height: number }): void {
        const borderBoxSize = border == null ? undefined : [{ inlineSize: border.width, blockSize: border.height }];
        this.callback([{ contentRect: { width, height }, borderBoxSize }]);
    }
}

function createFrames(): FrameScheduler & { run(): void; readonly pending: Map<number, () => void> } {
    const pending = new Map<number, () => void>();
    let nextHandle = 1;

    return {
        pending,
        requestFrame: (callback) => {
            const handle = nextHandle;
            nextHandle += 1;
            pending.set(handle, callback);

            return handle;
        },
        cancelFrame: (handle) => {
            pending.delete(handle);
        },
        run: () => {
            const due = [...pending.values()];
            pending.clear();

            for (const callback of due) {
                callback();
            }
        },
    };
}

function observed(): FakeResizeObserver {
    return FakeResizeObserver.latest as FakeResizeObserver;
}

describe('observeResize', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        FakeResizeObserver.latest = null;
    });

    it('waits for the next frame and runs once for several notifications', () => {
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
        const frames = createFrames();
        const onResize = vi.fn();
        observeResize(document.createElement('div'), onResize, { frames });

        observed().report(300, 200);
        observed().report(320, 200);

        expect(onResize).not.toHaveBeenCalled();
        expect(frames.pending.size).toBe(1);
        frames.run();
        expect(onResize).toHaveBeenCalledTimes(1);
    });

    it('skips a notification whose size has not changed', () => {
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
        const frames = createFrames();
        const onResize = vi.fn();
        observeResize(document.createElement('div'), onResize, { frames });

        observed().report(300, 200);
        frames.run();
        observed().report(300, 200);
        observed().report(300.2, 200);

        expect(frames.pending.size).toBe(0);
        expect(onResize).toHaveBeenCalledTimes(1);
    });

    it('watching the border box, ignores scroll bars that change only the content box', () => {
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
        const frames = createFrames();
        const onResize = vi.fn();
        observeResize(document.createElement('div'), onResize, { box: 'border-box', frames });

        expect(observed().box).toBe('border-box');
        observed().report(783, 600, { width: 800, height: 600 });
        frames.run();
        observed().report(783, 583, { width: 800, height: 600 });
        frames.run();

        expect(onResize).toHaveBeenCalledTimes(1);
    });

    it('stops watching and drops a frame still to come', () => {
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
        const frames = createFrames();
        const onResize = vi.fn();
        const stop = observeResize(document.createElement('div'), onResize, { frames });

        observed().report(300, 200);
        stop();
        frames.run();

        expect(observed().disconnected).toBe(true);
        expect(onResize).not.toHaveBeenCalled();
    });

    it('does nothing where the browser has no ResizeObserver', () => {
        vi.stubGlobal('ResizeObserver', undefined);

        expect(() => observeResize(document.createElement('div'), () => {})()).not.toThrow();
    });
});
