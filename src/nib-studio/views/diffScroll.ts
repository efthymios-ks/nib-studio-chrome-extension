import type { ScrollMemory } from './diffViewState.js';

// Restores and then tracks the scroll offsets of every [data-scroll-key] element under root.
// Restoring waits a frame as well, because a freshly built view has no layout until it is attached.
export function rememberScroll(root: HTMLElement, memory: ScrollMemory): void {
    const scrollers = Array.from(root.querySelectorAll<HTMLElement>('[data-scroll-key]'));
    const restore = (): void => {
        for (const scroller of scrollers) {
            const saved = memory[scroller.dataset['scrollKey'] ?? ''];

            if (saved != null) {
                scroller.scrollTop = saved.top;
                scroller.scrollLeft = saved.left;
            }
        }
    };

    restore();

    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(restore);
    }

    for (const scroller of scrollers) {
        scroller.addEventListener('scroll', () => {
            const key = scroller.dataset['scrollKey'];

            if (key != null && scroller.isConnected) {
                memory[key] = { top: scroller.scrollTop, left: scroller.scrollLeft };
            }
        }, { passive: true });
    }
}
