import { describe, expect, it, vi } from 'vitest';
import { findTarget, scrollToTarget } from './fragmentScroll.js';

describe('findTarget', () => {
    it('finds an id, then an anchor name, then the id a heading\'s text gives', () => {
        const root = document.createElement('div');
        root.innerHTML = '<h2 id="release-notes">Release notes</h2><a name="setup"></a><p id="exact">x</p>';

        expect(findTarget(root, 'exact')?.tagName).toBe('P');
        expect(findTarget(root, 'setup')?.tagName).toBe('A');
        expect(findTarget(root, 'Release Notes')?.id).toBe('release-notes');
        expect(findTarget(root, 'missing')).toBeNull();
    });
});

describe('scrollToTarget', () => {
    it('scrolls the target to the top, smoothly unless reduced motion is asked for', () => {
        const target = document.createElement('h2');
        const scrollIntoView = vi.fn();
        target.scrollIntoView = scrollIntoView;

        scrollToTarget(target, () => false);
        scrollToTarget(target, () => true);

        expect(scrollIntoView.mock.calls).toEqual([
            [{ behavior: 'smooth', block: 'start' }],
            [{ behavior: 'auto', block: 'start' }],
        ]);
    });
});
