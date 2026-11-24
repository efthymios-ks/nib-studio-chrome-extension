import { isTextEntry } from './previewFrame.js';

// A document's plain drag selects text, so panning takes either Space held down while dragging,
// or a drag with the middle button, with a grab cursor while it can pan. A tap of Space still scrolls a page.

// How much of the view a tap of Space scrolls, so a line of the view before it stays in sight.
export const SPACE_SCROLL_FRACTION = 0.9;

interface Pan {
    readonly pointerId: number;
    readonly start: { readonly x: number; readonly y: number };
    readonly scroll: { readonly left: number; readonly top: number };
}

function isSpace(event: KeyboardEvent): boolean {
    return event.code === 'Space' || event.key === ' ';
}

// Returns what undoes it.
export function attachPdfPan(
    viewport: HTMLElement,
    options: {
        readonly prefersReducedMotion: () => boolean;
        // Takes a tap of Space, 1 down or -1 up with Shift, before it scrolls a screen; true when it was used.
        readonly onSpaceTap?: (direction: 1 | -1) => boolean;
    },
): () => void {
    let isSpaceHeld = false;
    let hasPanned = false;
    let pan: Pan | null = null;

    const showMode = (): void => {
        if (pan != null) {
            viewport.dataset['panMode'] = 'panning';

            return;
        }

        if (isSpaceHeld) {
            viewport.dataset['panMode'] = 'ready';

            return;
        }

        delete viewport.dataset['panMode'];
    };

    const onKeyDown = (event: KeyboardEvent): void => {
        if (
            !isSpace(event)
            || event.ctrlKey
            || event.altKey
            || event.metaKey
            || isTextEntry(event.target)
        ) {
            return;
        }

        event.preventDefault();

        if (!isSpaceHeld) {
            isSpaceHeld = true;
            hasPanned = false;
            showMode();
        }
    };

    const onKeyUp = (event: KeyboardEvent): void => {
        if (!isSpace(event) || !isSpaceHeld) {
            return;
        }

        event.preventDefault();
        isSpaceHeld = false;

        if (!hasPanned && pan == null && options.onSpaceTap?.(event.shiftKey ? -1 : 1) !== true) {
            const distance = viewport.clientHeight * SPACE_SCROLL_FRACTION * (event.shiftKey ? -1 : 1);
            const behavior = options.prefersReducedMotion() ? 'auto' : 'smooth';
            viewport.scrollBy({ top: distance, behavior });
        }

        showMode();
    };

    const onPointerDown = (event: PointerEvent): void => {
        const isPanButton = event.button === 1 || (event.button === 0 && isSpaceHeld);

        if (!isPanButton || pan != null) {
            return;
        }

        event.preventDefault();
        viewport.focus({ preventScroll: true });
        pan = {
            pointerId: event.pointerId,
            start: { x: event.clientX, y: event.clientY },
            scroll: { left: viewport.scrollLeft, top: viewport.scrollTop },
        };
        viewport.setPointerCapture?.(event.pointerId);
        showMode();
    };

    const onPointerMove = (event: PointerEvent): void => {
        if (pan == null || event.pointerId !== pan.pointerId) {
            return;
        }

        hasPanned = true;
        viewport.scrollLeft = pan.scroll.left - (event.clientX - pan.start.x);
        viewport.scrollTop = pan.scroll.top - (event.clientY - pan.start.y);
    };

    const onPointerUp = (event: PointerEvent): void => {
        if (pan == null || event.pointerId !== pan.pointerId) {
            return;
        }

        viewport.releasePointerCapture?.(event.pointerId);
        pan = null;
        showMode();
    };

    // The middle button would otherwise start Chrome's autoscroll, or paste on Linux.
    const onMiddleButton = (event: MouseEvent): void => {
        if (event.button === 1) {
            event.preventDefault();
        }
    };

    const onBlur = (): void => {
        isSpaceHeld = false;
        showMode();
    };

    viewport.addEventListener('keydown', onKeyDown);
    viewport.addEventListener('keyup', onKeyUp);
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove, { passive: true });
    viewport.addEventListener('pointerup', onPointerUp);
    viewport.addEventListener('pointercancel', onPointerUp);
    viewport.addEventListener('mousedown', onMiddleButton);
    viewport.addEventListener('auxclick', onMiddleButton);
    viewport.addEventListener('blur', onBlur);

    return () => {
        viewport.removeEventListener('keydown', onKeyDown);
        viewport.removeEventListener('keyup', onKeyUp);
        viewport.removeEventListener('pointerdown', onPointerDown);
        viewport.removeEventListener('pointermove', onPointerMove);
        viewport.removeEventListener('pointerup', onPointerUp);
        viewport.removeEventListener('pointercancel', onPointerUp);
        viewport.removeEventListener('mousedown', onMiddleButton);
        viewport.removeEventListener('auxclick', onMiddleButton);
        viewport.removeEventListener('blur', onBlur);
    };
}
