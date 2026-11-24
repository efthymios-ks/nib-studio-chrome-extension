import { describe, expect, it } from 'vitest';
import { JsonComparer } from './jsonComparer.js';

describe('JsonComparer.compare', () => {
    it('reports no differences for deeply equal objects', () => {
        const left = { a: 1, b: { c: [1, 2] } };
        const right = { a: 1, b: { c: [1, 2] } };
        expect(JsonComparer.compare(left, right)).toEqual([]);
    });

    it('detects a changed scalar', () => {
        const diffs = JsonComparer.compare({ a: 1 }, { a: 2 });
        expect(diffs).toHaveLength(1);
        expect(diffs[0]?.kind).toBe('changed');
        expect(diffs[0]?.path).toBe('$.a');
        expect(diffs[0]?.leftValue).toBe(1);
        expect(diffs[0]?.rightValue).toBe(2);
    });

    it('differences carry segments alongside path', () => {
        const diffs = JsonComparer.compare({ a: { b: 1 } }, { a: { b: 2 } });
        expect(diffs[0]?.segments).toEqual(['a', 'b']);
    });

    it('detects an added key', () => {
        const diffs = JsonComparer.compare({ a: 1 }, { a: 1, b: 2 });
        expect(diffs).toEqual([
            expect.objectContaining({ kind: 'added', path: '$.b', rightValue: 2 }),
        ]);
    });

    it('detects a removed key', () => {
        const diffs = JsonComparer.compare({ a: 1, b: 2 }, { a: 1 });
        expect(diffs).toEqual([
            expect.objectContaining({ kind: 'removed', path: '$.b', leftValue: 2 }),
        ]);
    });

    it('detects a type change', () => {
        const diffs = JsonComparer.compare({ a: 1 }, { a: '1' });
        expect(diffs[0]?.kind).toBe('typeChanged');
    });

    it('sorts object keys alphabetically so key order is never a diff', () => {
        const left = { b: 1, a: 2 };
        const right = { a: 2, b: 1 };
        expect(JsonComparer.compare(left, right)).toEqual([]);
    });

    it('emits added keys in alphabetical order', () => {
        const diffs = JsonComparer.compare({}, { z: 1, a: 1 });
        expect(diffs.map((difference) => difference.path)).toEqual(['$.a', '$.z']);
    });

    it('positionally diffs arrays by default', () => {
        const diffs = JsonComparer.compare([1, 2, 3], [1, 9, 3]);
        expect(diffs).toEqual([
            expect.objectContaining({ kind: 'changed', path: '$[1]' }),
        ]);
    });

    it('reports added items at the tail of a positional array', () => {
        const diffs = JsonComparer.compare([1], [1, 2]);
        expect(diffs).toEqual([
            expect.objectContaining({ kind: 'added', path: '$[1]', rightValue: 2 }),
        ]);
    });

    it('uses matchBy to pair items across arrays', () => {
        const left = { items: [{ id: 1, v: 'a' }, { id: 2, v: 'b' }] };
        const right = { items: [{ id: 2, v: 'bb' }, { id: 1, v: 'a' }] };
        const diffs = JsonComparer.compare(left, right, {
            arrayRules: [{ path: '$.items[*]', matchBy: ['id'] }],
        });
        expect(diffs).toHaveLength(1);
        expect(diffs[0]?.kind).toBe('changed');
    });

    it('falls back to position when matchBy is missing on an item', () => {
        const left = { items: [{ v: 'a' }, { v: 'b' }] };
        const right = { items: [{ v: 'a' }, { v: 'bb' }] };
        const diffs = JsonComparer.compare(left, right, {
            arrayRules: [{ path: '$.items[*]', matchBy: ['id'] }],
        });
        expect(diffs).toEqual([
            expect.objectContaining({ kind: 'changed' }),
        ]);
    });

    it('applies sortBy before comparing positional arrays', () => {
        const left = { items: [{ k: 2 }, { k: 1 }] };
        const right = { items: [{ k: 1 }, { k: 2 }] };
        const diffs = JsonComparer.compare(left, right, {
            arrayRules: [{ path: '$.items[*]', sortBy: ['k'] }],
        });
        expect(diffs).toEqual([]);
    });

    it('targets nested arrays with the [*] path', () => {
        const left = { lines: [[1, 2], [3, 4]] };
        const right = { lines: [[1, 2], [3, 9]] };
        const diffs = JsonComparer.compare(left, right, {
            arrayRules: [{ path: '$.lines[*]' }],
        });
        expect(diffs).toEqual([
            expect.objectContaining({ path: '$.lines[1][1]' }),
        ]);
    });

    it('sorts nulls, booleans, numbers, then strings', () => {
        const left = { items: [{ k: 'b' }, { k: 1 }, { k: true }, { k: null }, { k: 'a' }] };
        const normalized = JsonComparer.normalize(left, {
            arrayRules: [{ path: '$.items[*]', sortBy: ['k'] }],
        }) as { items: Array<{ k: unknown }> };
        expect(normalized.items.map((item) => item.k)).toEqual([null, true, 1, 'a', 'b']);
    });

    it('places missing sort fields last', () => {
        const left = { items: [{ k: 1 }, { other: 'x' }, { k: 2 }] };
        const normalized = JsonComparer.normalize(left, {
            arrayRules: [{ path: '$.items[*]', sortBy: ['k'] }],
        }) as { items: Array<Record<string, unknown>> };
        expect(normalized.items).toEqual([{ k: 1 }, { k: 2 }, { other: 'x' }]);
    });

    it('normalize round-trips to an equal diff of []', () => {
        const left = { items: [{ id: 2, v: 'b' }, { id: 1, v: 'a' }] };
        const right = { items: [{ id: 1, v: 'a' }, { id: 2, v: 'b' }] };
        const options = { arrayRules: [{ path: '$.items[*]', sortBy: ['id'] }] };
        const normalizedLeft = JsonComparer.normalize(left, options);
        const normalizedRight = JsonComparer.normalize(right, options);
        expect(JsonComparer.compare(normalizedLeft, normalizedRight)).toEqual([]);
    });

    it('detects an added nested key', () => {
        const diffs = JsonComparer.compare({ a: {} }, { a: { b: 1 } });
        expect(diffs).toEqual([
            expect.objectContaining({ kind: 'added', path: '$.a.b', rightValue: 1 }),
        ]);
    });

    it('handles null equality correctly', () => {
        expect(JsonComparer.compare({ a: null }, { a: null })).toEqual([]);
    });

    it('treats null vs undefined-missing-key as removed', () => {
        const diffs = JsonComparer.compare({ a: null }, {});
        expect(diffs[0]?.kind).toBe('removed');
    });

    it('reports a value in place of null as added, not as a type change', () => {
        const diffs = JsonComparer.compare({ a: null, b: null, c: null }, { a: 'x', b: { k: 1 }, c: [1] });

        expect(diffs).toEqual([
            { kind: 'added', path: '$.a', segments: ['a'], rightValue: 'x' },
            { kind: 'added', path: '$.b', segments: ['b'], rightValue: { k: 1 } },
            { kind: 'added', path: '$.c', segments: ['c'], rightValue: [1] },
        ]);
    });

    it('reports null in place of a value as removed, not as a type change', () => {
        const diffs = JsonComparer.compare({ a: 0, items: [false] }, { a: null, items: [null] });

        expect(diffs).toEqual([
            { kind: 'removed', path: '$.a', segments: ['a'], leftValue: 0 },
            { kind: 'removed', path: '$.items[0]', segments: ['items', 0], leftValue: false },
        ]);
    });

    it('keeps type changes for values of different non-null types', () => {
        const diffs = JsonComparer.compare({ a: 'x', b: {}, c: 1 }, { a: 1, b: [], c: true });

        expect(diffs.map((diff) => `${diff.kind} ${diff.path}`)).toEqual(['typeChanged $.a', 'typeChanged $.b', 'typeChanged $.c']);
    });

    it('matches with a composite matchBy key', () => {
        const left = { items: [{ a: 1, b: 2, v: 'x' }, { a: 1, b: 3, v: 'y' }] };
        const right = { items: [{ a: 1, b: 3, v: 'yy' }, { a: 1, b: 2, v: 'x' }] };
        const diffs = JsonComparer.compare(left, right, {
            arrayRules: [{ path: '$.items[*]', matchBy: ['a', 'b'] }],
        });
        expect(diffs).toHaveLength(1);
        expect(diffs[0]?.kind).toBe('changed');
    });

    it('reports an unmatched item on the right as added', () => {
        const left = { items: [{ id: 1 }] };
        const right = { items: [{ id: 1 }, { id: 2 }] };
        const diffs = JsonComparer.compare(left, right, {
            arrayRules: [{ path: '$.items[*]', matchBy: ['id'] }],
        });
        expect(diffs).toEqual([
            expect.objectContaining({ kind: 'added' }),
        ]);
    });
});
