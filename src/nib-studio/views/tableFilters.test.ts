import { describe, expect, it } from 'vitest';
import { applyFilters, evaluateFilter, type TableFilter } from './tableFilters.js';

describe('evaluateFilter', () => {
    it('contains is case-insensitive', () => {
        expect(evaluateFilter('Hello World', { columnId: 'a', operator: 'contains', value: 'hello' })).toBe(true);
    });

    it('notContains inverts contains', () => {
        expect(evaluateFilter('Hello', { columnId: 'a', operator: 'notContains', value: 'bye' })).toBe(true);
    });

    it('empty matches null / blank', () => {
        expect(evaluateFilter(null, { columnId: 'a', operator: 'empty' })).toBe(true);
        expect(evaluateFilter('   ', { columnId: 'a', operator: 'empty' })).toBe(true);
        expect(evaluateFilter('x', { columnId: 'a', operator: 'empty' })).toBe(false);
    });

    it('between is inclusive', () => {
        expect(evaluateFilter(5, { columnId: 'n', operator: 'between', value: 1, valueTo: 10 })).toBe(true);
        expect(evaluateFilter(11, { columnId: 'n', operator: 'between', value: 1, valueTo: 10 })).toBe(false);
    });

    it('oneOf matches any value loosely', () => {
        expect(evaluateFilter('2', {
            columnId: 'n',
            operator: 'oneOf',
            values: [1, 2, 3],
        })).toBe(true);
    });

    it('startsWith respects case-insensitive match', () => {
        expect(evaluateFilter('Alpha', { columnId: 'a', operator: 'startsWith', value: 'alp' })).toBe(true);
    });
});

describe('applyFilters', () => {
    const columns = new Map<string, number>([['name', 0], ['age', 1]]);
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
        ['Alice', 30],
        ['Bob', 25],
        ['Carol', 40],
    ];

    it('passes rows through when no filters are set', () => {
        expect(applyFilters(rows, columns, [])).toHaveLength(3);
    });

    it('applies AND across multiple filters', () => {
        const filters: TableFilter[] = [
            { columnId: 'name', operator: 'startsWith', value: 'A' },
            { columnId: 'age', operator: 'gt', value: 20 },
        ];

        expect(applyFilters(rows, columns, filters)).toEqual([['Alice', 30]]);
    });

    it('ignores unknown columns gracefully', () => {
        const filters: TableFilter[] = [{ columnId: 'missing', operator: 'equals', value: 'x' }];

        expect(applyFilters(rows, columns, filters)).toHaveLength(3);
    });
});
