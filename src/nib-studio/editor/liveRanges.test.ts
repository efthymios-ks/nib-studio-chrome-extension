import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { clusterAfter, clusterBefore, rangeAround, skipRanges, subtractSpans, type Span } from './liveRanges.js';

interface Marked extends Span {
    readonly kind: 'tag' | 'divider';
}

const RANGES: ReadonlyArray<Marked> = [
    { from: 2, to: 4, kind: 'tag' },
    { from: 4, to: 6, kind: 'tag' },
    { from: 6, to: 7, kind: 'divider' },
    { from: 9, to: 9, kind: 'tag' },
];

describe('rangeAround', () => {
    it('finds the range the position falls strictly inside', () => {
        expect(rangeAround(RANGES, 3)).toBe(RANGES[0]);
        expect(rangeAround(RANGES, 5)).toBe(RANGES[1]);
    });

    it('finds none on a range\'s edge, in an empty range or outside every range', () => {
        expect(rangeAround(RANGES, 2)).toBeUndefined();
        expect(rangeAround(RANGES, 4)).toBeUndefined();
        expect(rangeAround(RANGES, 9)).toBeUndefined();
        expect(rangeAround(RANGES, 12)).toBeUndefined();
    });
});

describe('skipRanges', () => {
    const anyRange = (): boolean => true;
    const tagsOnly = (range: Marked): boolean => range.kind === 'tag';

    it('passes ranges one after another in either direction', () => {
        expect(skipRanges(RANGES, 2, true, anyRange)).toBe(7);
        expect(skipRanges(RANGES, 7, false, anyRange)).toBe(2);
        expect(skipRanges(RANGES, 4, false, anyRange)).toBe(2);
    });

    it('stops at a range the test keeps', () => {
        expect(skipRanges(RANGES, 2, true, tagsOnly)).toBe(6);
        expect(skipRanges(RANGES, 7, false, tagsOnly)).toBe(7);
    });

    it('stays put with no range beside the position, and never crosses an empty range', () => {
        expect(skipRanges(RANGES, 1, true, anyRange)).toBe(1);
        expect(skipRanges(RANGES, 2, false, anyRange)).toBe(2);
        expect(skipRanges(RANGES, 9, true, anyRange)).toBe(9);
        expect(skipRanges(RANGES, 9, false, anyRange)).toBe(9);
    });
});

describe('subtractSpans', () => {
    it('gives the parts of the range no kept span covers, in order', () => {
        expect(subtractSpans({ from: 0, to: 10 }, [{ from: 2, to: 4 }, { from: 6, to: 7 }])).toEqual([
            { from: 0, to: 2 },
            { from: 4, to: 6 },
            { from: 7, to: 10 },
        ]);
    });

    it('takes kept spans in any order, overlapping or reaching past the range', () => {
        const kept = [{ from: 8, to: 20 }, { from: 3, to: 6 }, { from: 4, to: 5 }, { from: -5, to: 1 }];

        expect(subtractSpans({ from: 0, to: 10 }, kept)).toEqual([{ from: 1, to: 3 }, { from: 6, to: 8 }]);
    });

    it('gives the whole range with nothing kept in it, and nothing when all of it is kept', () => {
        expect(subtractSpans({ from: 3, to: 5 }, [{ from: 0, to: 3 }, { from: 5, to: 9 }])).toEqual([{ from: 3, to: 5 }]);
        expect(subtractSpans({ from: 3, to: 5 }, [{ from: 2, to: 6 }])).toEqual([]);
        expect(subtractSpans({ from: 4, to: 4 }, [])).toEqual([]);
    });
});

describe('clusterBefore and clusterAfter', () => {
    // A thumbs-up with a skin tone is four UTF-16 code units that show as one character.
    const state = EditorState.create({ doc: 'a👍🏽b\ncd' });

    it('step over one shown character, a whole emoji at a time', () => {
        expect(clusterBefore(state, 5)).toBe(1);
        expect(clusterBefore(state, 1)).toBe(0);
        expect(clusterAfter(state, 1)).toBe(5);
        expect(clusterAfter(state, 5)).toBe(6);
    });

    it('step over the line break at the edge of a line', () => {
        expect(clusterBefore(state, 7)).toBe(6);
        expect(clusterAfter(state, 6)).toBe(7);
    });
});
