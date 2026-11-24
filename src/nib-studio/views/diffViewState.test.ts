import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXT_COMPARE_RULES } from '../../common/text/textCompareRules.js';
import { createDiffViewState, swapSideMemory, type DiffViewState } from './diffViewState.js';

describe('createDiffViewState', () => {
    it('starts every view with its defaults', () => {
        const state = createDiffViewState();

        expect(state.text.navigation).toEqual({ view: 'diff', current: null, movedAt: 0, reveal: false });
        expect(Object.keys(state.text).sort()).toEqual(['cache', 'navigation', 'rules', 'scroll']);
        expect(state.json.navigation).toEqual(state.text.navigation);
        expect(state.xml.navigation).toEqual(state.text.navigation);
        expect(state.rows.navigation).toEqual(state.text.navigation);
        expect(state.text.rules).toBe(DEFAULT_TEXT_COMPARE_RULES);
        expect(state.json.sortKeys).toBe(true);
        expect(state.json.expansion.size).toBe(0);
        expect(state.xml.view).toBe('xml');
        expect(state.xml.sortKeys).toBe(false);
        expect(state.xml.options).toEqual({
            ignoreWhitespaceOnly: true,
            trimText: true,
            ignoreNamespacePrefixes: false,
            caseSensitiveNames: true,
        });
        expect(state.markdown).toEqual({ view: 'diff', scrollY: 0, cache: null });
        expect(state.rows.keysChosen).toBe(false);
        expect(state.rows.loaded).toEqual({});
    });

    it('gives each state its own mutable memory', () => {
        const first = createDiffViewState();
        const second = createDiffViewState();
        first.json.expansion.set('$.a', true);
        first.text.scroll['original'] = { top: 1, left: 0 };

        expect(second.json.expansion.size).toBe(0);
        expect(second.text.scroll).toEqual({});
        expect(first.text.navigation).not.toBe(second.text.navigation);
        expect(first.json.navigation).not.toBe(first.xml.navigation);
    });
});

describe('swapSideMemory', () => {
    function stateWithScroll(): DiffViewState {
        const state = createDiffViewState();
        state.text.scroll['original'] = { top: 10, left: 1 };
        state.text.scroll['modified'] = { top: 20, left: 2 };
        state.text.scroll['list'] = { top: 5, left: 0 };
        state.json.scroll['original'] = { top: 30, left: 0 };

        return state;
    }

    it('swaps the per-side scroll offsets and leaves shared ones alone', () => {
        const state = stateWithScroll();

        swapSideMemory(state);

        expect(state.text.scroll).toEqual({ original: { top: 20, left: 2 }, modified: { top: 10, left: 1 }, list: { top: 5, left: 0 } });
        expect(state.json.scroll).toEqual({ modified: { top: 30, left: 0 } });
    });

    it('swaps the loaded row sets', () => {
        const state = createDiffViewState();
        const loaded = { source: 'a,b', rowSet: null };
        state.rows.loaded = { original: loaded };

        swapSideMemory(state);

        expect(state.rows.loaded.modified).toBe(loaded);
        expect(state.rows.loaded.original).toBeUndefined();
    });

    it('restores the original memory after swapping twice', () => {
        const state = stateWithScroll();
        const before = structuredClone(state.text.scroll);

        swapSideMemory(state);
        swapSideMemory(state);

        expect(state.text.scroll).toEqual(before);
    });
});
