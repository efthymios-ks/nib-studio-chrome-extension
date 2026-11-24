import { describe, expect, it } from 'vitest';
import {
    EMPTY_SELECTION,
    clear,
    orderedSelection,
    rowAfterRemoval,
    selectAll,
    selectOnly,
    selectRange,
    toggle,
    type SelectionState,
} from './selection.js';

describe('selection', () => {
    describe('selectOnly', () => {
        it('replaces whatever was selected with just the path', () => {
            const state: SelectionState = {
                selectedPaths: new Set(['a', 'b', 'c']),
                anchorPath: 'b',
            };
            const next = selectOnly(state, 'd');

            expect([...next.selectedPaths]).toEqual(['d']);
            expect(next.anchorPath).toBe('d');
        });
    });

    describe('toggle', () => {
        it('adds the path when it is not selected and makes it the anchor', () => {
            const next = toggle(EMPTY_SELECTION, 'a');

            expect(next.selectedPaths.has('a')).toBe(true);
            expect(next.anchorPath).toBe('a');
        });

        it('removes the path when it is already selected', () => {
            const state: SelectionState = {
                selectedPaths: new Set(['a', 'b']),
                anchorPath: 'a',
            };
            const next = toggle(state, 'b');

            expect(next.selectedPaths.has('b')).toBe(false);
            expect(next.anchorPath).toBe('a');
        });

        it('drops the anchor when the anchor is deselected', () => {
            const state: SelectionState = {
                selectedPaths: new Set(['a', 'b']),
                anchorPath: 'b',
            };
            const next = toggle(state, 'b');

            expect(next.anchorPath).toBeNull();
        });
    });

    describe('selectRange', () => {
        it('selects every path between anchor and target inclusive', () => {
            const ordered = ['a', 'b', 'c', 'd', 'e'];
            const next = selectRange(EMPTY_SELECTION, ordered, 'b', 'd');

            expect([...next.selectedPaths].sort()).toEqual(['b', 'c', 'd']);
            expect(next.anchorPath).toBe('b');
        });

        it('works when the range is reversed', () => {
            const ordered = ['a', 'b', 'c', 'd', 'e'];
            const next = selectRange(EMPTY_SELECTION, ordered, 'd', 'b');

            expect([...next.selectedPaths].sort()).toEqual(['b', 'c', 'd']);
        });

        it('falls back to the target when anchor is null', () => {
            const ordered = ['a', 'b', 'c'];
            const next = selectRange(EMPTY_SELECTION, ordered, null, 'c');

            expect([...next.selectedPaths]).toEqual(['c']);
        });

        it('leaves state untouched when target is not visible', () => {
            const state: SelectionState = {
                selectedPaths: new Set(['a']),
                anchorPath: 'a',
            };
            const next = selectRange(state, ['a', 'b'], 'a', 'z');

            expect(next).toBe(state);
        });
    });

    describe('clear', () => {
        it('returns an empty selection', () => {
            const state: SelectionState = {
                selectedPaths: new Set(['a', 'b']),
                anchorPath: 'a',
            };
            const next = clear(state);

            expect(next.selectedPaths.size).toBe(0);
            expect(next.anchorPath).toBeNull();
        });
    });

    describe('selectAll', () => {
        it('selects every visible path and anchors at the last one', () => {
            const next = selectAll(EMPTY_SELECTION, ['a', 'b', 'c']);

            expect([...next.selectedPaths].sort()).toEqual(['a', 'b', 'c']);
            expect(next.anchorPath).toBe('c');
        });

        it('returns empty when the input is empty', () => {
            const next = selectAll(EMPTY_SELECTION, []);

            expect(next.selectedPaths.size).toBe(0);
            expect(next.anchorPath).toBeNull();
        });
    });

    describe('orderedSelection', () => {
        it('returns selected paths in the given visible order', () => {
            const state: SelectionState = {
                selectedPaths: new Set(['c', 'a']),
                anchorPath: 'a',
            };
            const ordered = orderedSelection(state, ['a', 'b', 'c', 'd']);

            expect([...ordered]).toEqual(['a', 'c']);
        });
    });
});

describe('rowAfterRemoval', () => {
    const rows = ['docs', 'docs/a.txt', 'docs/b.txt', 'notes.txt', 'readme.md'];

    it('is the first row after the removed ones that stays', () => {
        expect(rowAfterRemoval(rows, (path) => path === 'notes.txt')).toBe('readme.md');
        expect(rowAfterRemoval(rows, (path) => path === 'docs/a.txt' || path === 'notes.txt')).toBe('docs/b.txt');
    });

    it('skips the rows inside a removed folder', () => {
        expect(rowAfterRemoval(rows, (path) => path === 'docs' || path.startsWith('docs/'))).toBe('notes.txt');
    });

    it('is the last row before them when nothing stays after', () => {
        expect(rowAfterRemoval(rows, (path) => path === 'readme.md')).toBe('notes.txt');
    });

    it('is null when no row stays, or none was removed', () => {
        expect(rowAfterRemoval(rows, () => true)).toBeNull();
        expect(rowAfterRemoval(rows, () => false)).toBeNull();
    });
});

