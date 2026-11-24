import { describe, expect, it } from 'vitest';
import { Decoration } from '@codemirror/view';
import { HIDDEN, atomicItems, hiddenItem, type LiveItem } from './liveItems.js';

describe('hiddenItem', () => {
    it('hides the range and keeps the side the caret belongs on', () => {
        expect(hiddenItem(2, 4, 'after')).toEqual({ from: 2, to: 4, decoration: HIDDEN, side: 'after' });
    });
});

describe('atomicItems', () => {
    it('keeps only the hidden and replaced ranges, sorted by start and then end', () => {
        const mark = Decoration.mark({ class: 'cm-live-link' });
        const items: LiveItem[] = [
            hiddenItem(9, 11, 'before'),
            { from: 3, to: 8, decoration: mark },
            hiddenItem(1, 3, 'after'),
            hiddenItem(1, 2, 'both'),
            hiddenItem(5, 5, 'before'),
        ];

        expect(atomicItems(items).map((item) => [item.from, item.to])).toEqual([[1, 2], [1, 3], [9, 11]]);
    });
});
