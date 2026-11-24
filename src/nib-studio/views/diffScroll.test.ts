import { afterEach, describe, expect, it, vi } from 'vitest';
import { h } from '../app/dom.js';
import { rememberScroll } from './diffScroll.js';
import type { ScrollMemory } from './diffViewState.js';

function buildRoot(): { root: HTMLElement; tree: HTMLElement; list: HTMLElement } {
    const tree = h('div', { dataset: { scrollKey: 'tree' } });
    const list = h('div', { dataset: { scrollKey: 'list' } });
    const root = h('div', { children: [tree, list, h('div', { class: 'not-tracked' })] });
    document.body.append(root);

    return { root, tree, list };
}

describe('rememberScroll', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        vi.unstubAllGlobals();
    });

    it('restores saved offsets immediately and again on the next frame', () => {
        const frames: FrameRequestCallback[] = [];
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
        const { root, tree, list } = buildRoot();
        const memory: ScrollMemory = { tree: { top: 40, left: 5 } };

        rememberScroll(root, memory);

        expect(tree.scrollTop).toBe(40);
        expect(tree.scrollLeft).toBe(5);
        expect(list.scrollTop).toBe(0);
        tree.scrollTop = 0;
        frames.forEach((frame) => frame(0));
        expect(tree.scrollTop).toBe(40);
    });

    it('records the offsets of a scroller when it scrolls', () => {
        const { root, list } = buildRoot();
        const memory: ScrollMemory = {};

        rememberScroll(root, memory);
        list.scrollTop = 120;
        list.scrollLeft = 7;
        list.dispatchEvent(new Event('scroll'));

        expect(memory).toEqual({ list: { top: 120, left: 7 } });
    });

    it('ignores scroll events from a detached view so a rebuilt view keeps the memory', () => {
        const { root, tree } = buildRoot();
        const memory: ScrollMemory = { tree: { top: 30, left: 0 } };

        rememberScroll(root, memory);
        root.remove();
        tree.scrollTop = 0;
        tree.dispatchEvent(new Event('scroll'));

        expect(memory['tree']).toEqual({ top: 30, left: 0 });
    });
});
