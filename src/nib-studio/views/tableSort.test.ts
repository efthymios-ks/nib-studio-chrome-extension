import { describe, expect, it } from 'vitest';
import { compareValues, cycleSort, sortRows, type TableSort } from './tableSort.js';

describe('compareValues', () => {
    it('sorts numbers numerically', () => {
        expect(compareValues(2, 10)).toBeLessThan(0);
        expect(compareValues(10, 2)).toBeGreaterThan(0);
    });

    it('sorts numeric strings as numbers', () => {
        expect(compareValues('2', '10')).toBeLessThan(0);
    });

    it('sorts ISO dates chronologically', () => {
        expect(compareValues('2024-01-01', '2023-12-31')).toBeGreaterThan(0);
    });

    it('places nulls last', () => {
        expect(compareValues(null, 1)).toBeGreaterThan(0);
        expect(compareValues(1, null)).toBeLessThan(0);
    });

    it('falls back to locale compare for arbitrary strings', () => {
        expect(compareValues('banana', 'apple')).toBeGreaterThan(0);
    });
});

describe('cycleSort', () => {
    it('adds ascending on first click', () => {
        expect(cycleSort([], 'a', false)).toEqual([{ columnId: 'a', direction: 'asc' }]);
    });

    it('cycles asc to desc on second click', () => {
        expect(cycleSort([{ columnId: 'a', direction: 'asc' }], 'a', false))
            .toEqual([{ columnId: 'a', direction: 'desc' }]);
    });

    it('clears sort on third click', () => {
        expect(cycleSort([{ columnId: 'a', direction: 'desc' }], 'a', false)).toEqual([]);
    });

    it('bare click replaces the whole chain', () => {
        const current: TableSort[] = [
            { columnId: 'a', direction: 'asc' },
            { columnId: 'b', direction: 'desc' },
        ];

        expect(cycleSort(current, 'c', false)).toEqual([{ columnId: 'c', direction: 'asc' }]);
    });

    it('additive click appends a secondary sort', () => {
        const current: TableSort[] = [{ columnId: 'a', direction: 'asc' }];

        expect(cycleSort(current, 'b', true)).toEqual([
            { columnId: 'a', direction: 'asc' },
            { columnId: 'b', direction: 'asc' },
        ]);
    });
});

describe('sortRows', () => {
    const columns = new Map<string, number>([['name', 0], ['age', 1]]);

    it('returns rows unchanged when no sorts are set', () => {
        const rows = [['Bob', 25], ['Alice', 30]] as unknown as ReadonlyArray<ReadonlyArray<unknown>>;

        expect(sortRows(rows, columns, [])).toEqual(rows);
    });

    it('applies ascending sort', () => {
        const rows = [['Bob', 25], ['Alice', 30]] as unknown as ReadonlyArray<ReadonlyArray<unknown>>;

        expect(sortRows(rows, columns, [{ columnId: 'name', direction: 'asc' }]))
            .toEqual([['Alice', 30], ['Bob', 25]]);
    });

    it('uses a secondary sort to break ties', () => {
        const rows = [['A', 2], ['A', 1], ['B', 1]] as unknown as ReadonlyArray<ReadonlyArray<unknown>>;

        const sorted = sortRows(rows, columns, [
            { columnId: 'name', direction: 'asc' },
            { columnId: 'age', direction: 'asc' },
        ]);

        expect(sorted).toEqual([['A', 1], ['A', 2], ['B', 1]]);
    });
});
