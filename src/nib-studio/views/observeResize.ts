// Animation frames, which tests replace to run frames by hand.
export interface FrameScheduler {
    requestFrame(callback: () => void): number;
    cancelFrame(handle: number): void;
}

export interface ObserveResizeOptions {
    // The box to watch. The border box keeps its size when scroll bars come and go inside the element.
    readonly box?: ResizeObserverBoxOptions;
    readonly frames?: FrameScheduler;
}

interface BoxSize {
    readonly width: number;
    readonly height: number;
}

const BROWSER_FRAMES: FrameScheduler = {
    requestFrame: (callback) => requestAnimationFrame(() => callback()),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
};

// Runs `onResize` in the next frame after the element changes size: once however many notifications arrive,
// and never for a size already handled, so work that resizes the page can't set off a ResizeObserver loop.
// Returns the function that stops watching.
export function observeResize(element: Element, onResize: () => void, options: ObserveResizeOptions = {}): () => void {
    if (typeof ResizeObserver !== 'function') {
        return () => {};
    }

    const frames = options.frames ?? BROWSER_FRAMES;
    const box = options.box ?? 'content-box';
    let handled: BoxSize | null = null;
    let pending: number | null = null;

    const observer = new ResizeObserver((entries) => {
        const entry = entries.at(-1);
        const size = entry == null ? null : entrySize(entry, box);

        if (size == null || isSameSize(handled, size)) {
            return;
        }

        handled = size;
        pending ??= frames.requestFrame(() => {
            pending = null;
            onResize();
        });
    });
    observer.observe(element, { box });

    return () => {
        observer.disconnect();

        if (pending != null) {
            frames.cancelFrame(pending);
            pending = null;
        }
    };
}

function isSameSize(handled: BoxSize | null, size: BoxSize): boolean {
    return handled != null && Math.abs(handled.width - size.width) < 0.5 && Math.abs(handled.height - size.height) < 0.5;
}

function entrySize(entry: ResizeObserverEntry, box: ResizeObserverBoxOptions): BoxSize | null {
    const border = box === 'border-box' ? entry.borderBoxSize?.[0] : undefined;

    if (border != null) {
        return { width: border.inlineSize, height: border.blockSize };
    }

    return entry.contentRect == null ? null : { width: entry.contentRect.width, height: entry.contentRect.height };
}
