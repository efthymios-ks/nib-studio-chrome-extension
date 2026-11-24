export const LONG_PRESS_DELAY_MS = 500;
const MOVE_TOLERANCE_PX = 10;
// The click that follows lifting the finger arrives shortly after pointerup.
const CLICK_SUPPRESS_WINDOW_MS = 350;

const syntheticEvents = new WeakSet<Event>();

// A touch or pen held still on the element fires the same contextmenu event a right-click would,
// so existing context-menu handlers work unchanged. Returns a function that detaches it.
export function attachLongPress(element: HTMLElement, delayMs: number = LONG_PRESS_DELAY_MS): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let fired = false;
    let startX = 0;
    let startY = 0;

    const cancelTimer = (): void => {
        if (timer != null) {
            clearTimeout(timer);
            timer = null;
        }
    };

    const suppressClick = (event: Event): void => {
        event.preventDefault();
        event.stopPropagation();
        window.removeEventListener('click', suppressClick, true);
    };

    const onPointerDown = (event: PointerEvent): void => {
        if (event.pointerType === 'mouse' || !event.isPrimary) {
            return;
        }

        cancelTimer();
        fired = false;
        startX = event.clientX;
        startY = event.clientY;
        timer = setTimeout(() => {
            timer = null;
            fired = true;
            window.addEventListener('click', suppressClick, true);
            const synthetic = new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: startX,
                clientY: startY,
            });
            syntheticEvents.add(synthetic);
            element.dispatchEvent(synthetic);
        }, delayMs);
    };

    const onPointerMove = (event: PointerEvent): void => {
        if (timer == null) {
            return;
        }

        if (Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_TOLERANCE_PX) {
            cancelTimer();
        }
    };

    const onPointerEnd = (): void => {
        cancelTimer();

        if (fired) {
            fired = false;
            setTimeout(() => window.removeEventListener('click', suppressClick, true), CLICK_SUPPRESS_WINDOW_MS);
        }
    };

    const onContextMenu = (event: Event): void => {
        if (syntheticEvents.has(event)) {
            return;
        }

        // The browser's own long-press menu event got there first; let it through and skip ours.
        if (timer != null) {
            cancelTimer();

            return;
        }

        // Ours already opened the menu for this press.
        if (fired) {
            event.preventDefault();
            event.stopPropagation();
        }
    };

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerEnd);
    element.addEventListener('pointercancel', onPointerEnd);
    element.addEventListener('contextmenu', onContextMenu, true);

    return () => {
        cancelTimer();
        window.removeEventListener('click', suppressClick, true);
        element.removeEventListener('pointerdown', onPointerDown);
        element.removeEventListener('pointermove', onPointerMove);
        element.removeEventListener('pointerup', onPointerEnd);
        element.removeEventListener('pointercancel', onPointerEnd);
        element.removeEventListener('contextmenu', onContextMenu, true);
    };
}

// Touch-first devices start a native drag on a long-press of a draggable row, which would swallow the menu.
export function prefersCoarsePointer(): boolean {
    if (typeof window.matchMedia !== 'function') {
        return false;
    }

    return window.matchMedia('(pointer: coarse)').matches;
}
