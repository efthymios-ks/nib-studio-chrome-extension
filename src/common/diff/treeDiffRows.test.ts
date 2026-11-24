import { describe, expect, it } from 'vitest';
import { JsonComparer, type JsonDifference } from '../json/jsonComparer.js';
import { JsonPathBuilder, type JsonPathSegment } from '../paths/jsonPathBuilder.js';
import type { DiffRow } from './diffDocument.js';
import { alignTreeRows, isPathWithin, naturalCompare, orderKeys, type TreeRowsInput } from './treeDiffRows.js';

function inputOf(left: unknown, right: unknown, overrides: Partial<TreeRowsInput> = {}): TreeRowsInput {
    const differences = left === undefined || right === undefined ? [] : JsonComparer.compare(left, right);

    return {
        left,
        right,
        differences,
        ids: differences.map((difference) => difference.path),
        sortKeys: true,
        matchByFor: () => null,
        rulePathFor: (segments) => `${JsonPathBuilder.anyItemsOf(segments)}[*]`,
        ...overrides,
    };
}

function describeRows(rows: ReadonlyArray<DiffRow>): string[] {
    return rows.map((row) => {
        const cell = row.left ?? row.right;

        return `${cell?.node}:${cell?.label ?? ''}:${row.left == null ? '-' : 'L'}${row.right == null ? '-' : 'R'}`;
    });
}

describe('alignTreeRows', () => {
    it('gives every key one row on both sides, with a placeholder where a side lacks it', () => {
        const { rows } = alignTreeRows(inputOf({ a: 1, b: 2 }, { a: 1, c: 3 }));

        expect(describeRows(rows)).toEqual(['open::LR', 'leaf:a:LR', 'leaf:b:L-', 'leaf:c:-R', 'close::LR']);
    });

    it('fills a whole missing object with placeholder rows on the other side, all of it added', () => {
        const { rows } = alignTreeRows(inputOf({ keep: 1 }, { keep: 1, extra: { x: 1, y: [1] } }));
        const extra = rows.filter((row) => row.left == null);

        expect(describeRows(extra)).toEqual(['open:extra:-R', 'leaf:x:-R', 'open:y:-R', 'leaf:[0]:-R', 'close::-R', 'close::-R']);
        expect(extra.map((row) => row.right?.status)).toEqual(['added', 'added', 'added', 'added', 'added', 'added']);
        expect(extra.map((row) => row.change ?? null)).toEqual(['$.extra', null, null, null, null, null]);
    });

    it('pairs array items by position', () => {
        const { rows } = alignTreeRows(inputOf([1, 2, 3], [1, 2]));

        expect(describeRows(rows)).toEqual(['open::LR', 'leaf:[0]:LR', 'leaf:[1]:LR', 'leaf:[2]:L-', 'close::LR']);
    });

    it('pairs matched array items by their match fields, with unmatched ones opposite placeholders', () => {
        const left = [{ id: 1, v: 'a' }, { id: 2, v: 'b' }];
        const right = [{ id: 2, v: 'b' }, { id: 3, v: 'c' }];
        const { rows } = alignTreeRows(inputOf(left, right, { matchByFor: () => ['id'] }));
        const items = rows.filter((row) => (row.left ?? row.right)?.depth === 1 && (row.left ?? row.right)?.node === 'open');

        expect(describeRows(items)).toEqual(['open:[id=1]:L-', 'open:[id=2]:LR', 'open:[id=3]:-R']);
        expect(items[1]?.left?.path).toBe('$[1]');
        expect(items[1]?.right?.path).toBe('$[0]');
    });

    it('types the value tokens and counts the children of objects and arrays', () => {
        const { rows } = alignTreeRows(inputOf({ list: [1, 'a', true, null] }, { list: [1, 'a', true, null] }));

        expect(rows.map((row) => row.left?.tokens)).toEqual([
            [{ text: '{', type: 'object' }, { text: '1 key', type: 'count' }],
            [{ text: '[', type: 'array' }, { text: '4 items', type: 'count' }],
            [{ text: '1', type: 'number' }],
            [{ text: '"a"', type: 'string' }],
            [{ text: 'true', type: 'boolean' }],
            [{ text: 'null', type: 'null' }],
            [{ text: ']', type: 'array' }],
            [{ text: '}', type: 'object' }],
        ]);
        expect(rows.map((row) => row.left?.depth)).toEqual([0, 1, 2, 2, 2, 2, 1, 0]);
    });

    it('closes the branches with no change under them, and keeps everything open when nothing changed', () => {
        const changed = alignTreeRows(inputOf({ same: { x: 1 }, changed: { v: 1 } }, { same: { x: 1 }, changed: { v: 2 } }));
        const collapsed = (rows: ReadonlyArray<DiffRow>): string[] => rows
            .filter((row) => row.left?.collapsed === true)
            .map((row) => row.left?.path ?? '');

        expect(collapsed(changed.rows)).toEqual(['$.same']);
        expect(collapsed(alignTreeRows(inputOf({ o: { x: 1 } }, { o: { x: 1 } })).rows)).toEqual([]);
    });

    it('names the array rule path on array rows', () => {
        const { rows } = alignTreeRows(inputOf({ orders: [{ lines: [1] }] }, { orders: [{ lines: [1] }] }));
        const rulePaths = rows.map((row) => row.left?.rulePath).filter((path) => path != null);

        expect(rulePaths).toEqual(['$.orders[*]', '$.orders[*].lines[*]']);
    });

    it('marks a changed value on both sides and points the change at its row', () => {
        const { rows, changes } = alignTreeRows(inputOf({ a: 1, b: { c: true } }, { a: 2, b: { c: 'yes' } }));

        expect(changes.map((change) => [change.id, change.kind, change.row, change.before, change.after])).toEqual([
            ['$.a', 'changed', 1, 1, 2],
            ['$.b.c', 'typeChanged', 3, true, 'yes'],
        ]);
        expect(rows[1]?.change).toBe('$.a');
        expect([rows[1]?.left?.status, rows[1]?.right?.status]).toEqual(['changed', 'changed']);
        expect(changes[0]?.location).toEqual({ path: '$.a', pointer: '$.a' });
    });

    it('treats null as missing: a value in its place is added, and the null stays unmarked', () => {
        const { rows, changes } = alignTreeRows(inputOf({ a: null }, { a: 5 }));

        expect(changes.map((change) => [change.kind, change.after, 'before' in change])).toEqual([['added', 5, false]]);
        expect([rows[1]?.left?.status, rows[1]?.right?.status]).toEqual(['unchanged', 'added']);
    });

    it('orders the changes as the rows show them, with ids made unique', () => {
        const differences: JsonDifference[] = [
            { kind: 'changed', path: '$.z', segments: ['z'], leftValue: 1, rightValue: 2 },
            { kind: 'changed', path: '$.a', segments: ['a'], leftValue: 1, rightValue: 2 },
        ];
        const { changes } = alignTreeRows({
            ...inputOf({ a: 1, z: 1 }, { a: 2, z: 2 }),
            differences,
            ids: ['same', 'same'],
        });

        expect(changes.map((change) => `${change.id} @${change.row}`)).toEqual(['same @1', 'same (2) @2']);
    });

    it('lays out one side alone when the other is not chosen yet', () => {
        const { rows, changes } = alignTreeRows(inputOf({ a: { b: 1 } }, undefined));

        expect(describeRows(rows)).toEqual(['open::L-', 'open:a:L-', 'leaf:b:L-', 'close::L-', 'close::L-']);
        expect(rows.some((row) => row.left?.collapsed === true)).toBe(false);
        expect(changes).toEqual([]);
    });

    it('applies the label mapping', () => {
        const { rows } = alignTreeRows(inputOf({ '@id': 1 }, { '@id': 1 }, { labelFor: (label) => `<${label}>` }));

        expect(rows[1]?.left?.label).toBe('<@id>');
    });

    it('builds the same rows for the same inputs', () => {
        const left = { b: [1, { c: 2 }], a: 'x' };
        const right = { b: [1, { c: 3 }, 4], a: 'y' };

        expect(JSON.stringify(alignTreeRows(inputOf(left, right)))).toBe(JSON.stringify(alignTreeRows(inputOf(left, right))));
    });

    it('keeps file order when keys are not sorted', () => {
        const { rows } = alignTreeRows(inputOf({ b: 1, a: 1 }, { b: 1, c: 1 }, { sortKeys: false }));

        expect(rows.map((row) => (row.left ?? row.right)?.label ?? '')).toEqual(['', 'b', 'a', 'c', '']);
    });
});

describe('orderKeys', () => {
    it('sorts naturally and case-insensitively when asked', () => {
        expect(orderKeys(['item10', 'Beta', 'item2', 'alpha'], [], true)).toEqual(['alpha', 'Beta', 'item2', 'item10']);
    });

    it('keeps the left order followed by the keys only the right has', () => {
        expect(orderKeys(['b', 'a'], ['c', 'a'], false)).toEqual(['b', 'a', 'c']);
    });

    it('breaks case ties consistently', () => {
        expect(naturalCompare('a', 'A')).not.toBe(0);
    });
});

describe('isPathWithin', () => {
    it('tells a path at or under another from a sibling with the same start', () => {
        const segments: JsonPathSegment[] = ['items', 0];

        expect(isPathWithin(JsonPathBuilder.of(segments), '$.items')).toBe(true);
        expect(isPathWithin('$.items', '$.items')).toBe(true);
        expect(isPathWithin('$.items2', '$.items')).toBe(false);
    });
});
