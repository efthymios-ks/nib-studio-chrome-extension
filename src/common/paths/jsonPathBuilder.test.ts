import { describe, expect, it } from 'vitest';
import { JsonPathBuilder, type JsonIndexChoice, type JsonPathSegment } from './jsonPathBuilder.js';

describe('JsonPathBuilder', () => {
    it('returns the root token', () => {
        expect(JsonPathBuilder.root()).toBe('$');
    });

    it('emits a dot segment for a safe identifier', () => {
        expect(JsonPathBuilder.member('$', 'name')).toBe('$.name');
    });

    it('emits bracket notation for a key with a space', () => {
        expect(JsonPathBuilder.member('$', 'first name')).toBe('$["first name"]');
    });

    it('escapes double quotes inside a double-quoted bracket key', () => {
        // A backslash without a single quote takes the double-quoted form.
        expect(JsonPathBuilder.member('$', 'a\\b')).toBe('$["a\\\\b"]');
    });

    it('uses single quotes when the key contains a double quote', () => {
        // The evaluator reads single-quoted bracket keys without escape
        // processing, so we emit single quotes when the key has a
        // double quote but no single quote.
        expect(JsonPathBuilder.member('$', 'q"k')).toBe("$['q\"k']");
    });

    it('builds an indexed segment', () => {
        expect(JsonPathBuilder.index('$.items', 2)).toBe('$.items[2]');
    });

    it('builds a wildcard segment', () => {
        expect(JsonPathBuilder.anyItem('$.items')).toBe('$.items[*]');
    });

    it('collects numeric segments as indexSteps', () => {
        const segments: JsonPathSegment[] = ['orders', 0, 'lines', 3];
        const steps = JsonPathBuilder.indexSteps(segments);
        expect(steps).toEqual([
            { segmentIndex: 1, clickedIndex: 0, count: 1 },
            { segmentIndex: 3, clickedIndex: 3, count: 4 },
        ]);
    });

    it('builds a full path with default clicked indices', () => {
        const segments: JsonPathSegment[] = ['orders', 2, 'lines', 0, 'qty'];
        expect(JsonPathBuilder.of(segments)).toBe('$.orders[2].lines[0].qty');
    });

    it('applies choices to override segments', () => {
        const segments: JsonPathSegment[] = ['orders', 2, 'lines', 0, 'qty'];
        const choices = new Map<number, JsonIndexChoice>([
            [1, 'any'],
            [3, 5],
        ]);
        expect(JsonPathBuilder.of(segments, choices)).toBe('$.orders[*].lines[5].qty');
    });

    it('turns every numeric segment into a wildcard with anyItemsOf', () => {
        const segments: JsonPathSegment[] = ['orders', 2, 'lines', 0, 'qty'];
        expect(JsonPathBuilder.anyItemsOf(segments)).toBe('$.orders[*].lines[*].qty');
    });

    it('builds fieldOf as a dot path relative to the array item', () => {
        const element: JsonPathSegment[] = ['orders', 2];
        const clicked: JsonPathSegment[] = ['orders', 2, 'id'];
        expect(JsonPathBuilder.fieldOf(element, clicked)).toBe('id');
    });

    it('builds fieldOf for a nested dot path', () => {
        const element: JsonPathSegment[] = ['orders', 2];
        const clicked: JsonPathSegment[] = ['orders', 2, 'customer', 'id'];
        expect(JsonPathBuilder.fieldOf(element, clicked)).toBe('customer.id');
    });

    it('fieldOf joins keys with dots (known dots-in-keys limitation)', () => {
        const element: JsonPathSegment[] = ['items', 0];
        const clicked: JsonPathSegment[] = ['items', 0, 'a.b'];
        // Produces 'a.b' which cannot be distinguished from a nested
        // path; documented in the JSDoc as a known limitation.
        expect(JsonPathBuilder.fieldOf(element, clicked)).toBe('a.b');
    });

    it('returns empty when clicked path does not descend from the element', () => {
        const element: JsonPathSegment[] = ['orders', 2];
        const clicked: JsonPathSegment[] = ['orders', 3, 'id'];
        expect(JsonPathBuilder.fieldOf(element, clicked)).toBe('');
    });
});
