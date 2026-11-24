import { headingSlug } from '../../common/markdown/preview.js';

// The element a `#fragment` names: an id, an anchor's name, or the id the heading's text gives.
export function findTarget(root: ParentNode, fragment: string): HTMLElement | null {
    const candidates = [...root.querySelectorAll<HTMLElement>('[id], a[name]')];
    const slug = headingSlug(fragment);

    return candidates.find((element) => element.id === fragment)
        ?? candidates.find((element) => element.getAttribute('name') === fragment)
        ?? candidates.find((element) => slug !== '' && element.id === slug)
        ?? null;
}

// Scrolls the target to the top of its scroller, smoothly unless the system asks for reduced motion.
export function scrollToTarget(target: HTMLElement, prefersReducedMotion: () => boolean): void {
    target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}
