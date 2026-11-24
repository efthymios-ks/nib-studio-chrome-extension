import { describe, expect, it } from 'vitest';
import { compareRecordsBy, compareRowSets, type RowSet } from './rowCompare.js';

const left: RowSet = {
    columns: ['id', 'name', 'email', 'active'],
    rows: [
        [1, 'Ada', 'ada@example.com', 'true'],
        [2, 'Alan', 'alan@example.com', 'true'],
        [3, 'Grace', 'grace@example.com', 'true'],
        [4, 'Donald', 'donald@example.com', 'false'],
    ],
};

const right: RowSet = {
    columns: ['id', 'name', 'email', 'active'],
    rows: [
        [1, 'Ada', 'ada@example.com', 'true'],
        [2, 'Alan', 'alan@example.com', 'true'],
        [3, 'Grace', 'grace.hopper@example.com', 'true'],
        [5, 'Linus', 'linus@example.com', 'true'],
    ],
};

describe('compareRowSets', () => {
    it('finds the changed, removed and added rows when matched by id', () => {
        const result = compareRowSets(left, right, { keyColumns: ['id'] });

        expect(result.addedCount).toBe(1);
        expect(result.removedCount).toBe(1);
        expect(result.changedCount).toBe(1);
        expect(result.unchangedCount).toBe(2);

        const changed = result.differences.find((difference) => difference.kind === 'changed');
        expect(changed?.cells).toHaveLength(1);
        expect(changed?.cells[0]?.column).toBe('email');

        const removed = result.differences.find((difference) => difference.kind === 'removed');
        expect(removed?.key).toBe('4');

        const added = result.differences.find((difference) => difference.kind === 'added');
        expect(added?.key).toBe('5');
    });

    it('ignores columns the caller asked to skip', () => {
        const result = compareRowSets(left, right, {
            keyColumns: ['id'],
            ignoreColumns: ['email'],
        });

        expect(result.changedCount).toBe(0);
    });

    it('supports composite keys', () => {
        const composite: RowSet = {
            columns: ['sku', 'size', 'qty'],
            rows: [
                ['MUG', 'S', 10],
                ['MUG', 'L', 5],
                ['SCF', 'M', 20],
            ],
        };
        const next: RowSet = {
            columns: ['sku', 'size', 'qty'],
            rows: [
                ['MUG', 'S', 12],
                ['MUG', 'L', 5],
                ['SCF', 'M', 20],
            ],
        };
        const result = compareRowSets(composite, next, { keyColumns: ['sku', 'size'] });
        expect(result.changedCount).toBe(1);
        expect(result.differences[0]?.key).toBe('MUG\u001fS');
    });

    it('rejects an empty key spec', () => {
        expect(() => compareRowSets(left, right, { keyColumns: [] })).toThrow(/keyColumns/);
    });

    it('reports columns that appear on only one side', () => {
        const leftWithExtra: RowSet = {
            columns: ['id', 'name', 'joined'],
            rows: [[1, 'Ada', '2024-01-01']],
        };
        const rightWithExtra: RowSet = {
            columns: ['id', 'name', 'role'],
            rows: [[1, 'Ada', 'admin']],
        };
        const result = compareRowSets(leftWithExtra, rightWithExtra, { keyColumns: ['id'] });
        expect(result.sharedColumns).toEqual(['id', 'name']);
        expect(result.onlyInOriginalColumns).toEqual(['joined']);
        expect(result.onlyInModifiedColumns).toEqual(['role']);
    });
});

describe('row keys and sort columns', () => {
    it('builds composite keys in the picked column order', () => {
        const rows: RowSet = { columns: ['a', 'b'], rows: [['1', '2']] };
        const changed: RowSet = { columns: ['a', 'b'], rows: [['1', '3']] };
        const byAB = compareRowSets(rows, changed, { keyColumns: ['a', 'b'] });
        const byBA = compareRowSets(rows, changed, { keyColumns: ['b', 'a'] });

        expect(byAB.differences.map((difference) => difference.key)[0]?.startsWith('1')).toBe(true);
        expect(byBA.differences.map((difference) => difference.key)[0]?.startsWith('2')).toBe(true);
    });

    it('orders the differences by the sort columns in priority order', () => {
        const result = compareRowSets(left, right, { keyColumns: ['id'], sortColumns: ['name'] });

        expect(result.differences.map((difference) => difference.key)).toEqual(['4', '3', '5']);
    });

    it('falls back to key order without sort columns', () => {
        const result = compareRowSets(left, right, { keyColumns: ['id'] });

        expect(result.differences.map((difference) => difference.key)).toEqual(['3', '4', '5']);
    });

    it('compares records by later columns only when earlier ones tie', () => {
        expect(compareRecordsBy({ a: 'x', b: 2 }, { a: 'x', b: 10 }, ['a', 'b'])).toBeLessThan(0);
        expect(compareRecordsBy({ a: 'y', b: 1 }, { a: 'x', b: 10 }, ['a', 'b'])).toBeGreaterThan(0);
    });
});
