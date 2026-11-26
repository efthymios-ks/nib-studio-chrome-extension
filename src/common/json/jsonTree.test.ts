import { describe, expect, it } from 'vitest';
import { findJsonError, isPlainObject, parseJson } from './jsonTree.js';

describe('parseJson', () => {
    it('parses an object', () => {
        const result = parseJson('{"name":"nib"}');

        if (!result.ok) {
            throw new Error('expected ok');
        }

        expect(result.root.kind).toBe('object');
        expect(result.root.children).toHaveLength(1);
        expect(result.root.children[0]?.key).toBe('name');
        expect(result.root.children[0]?.kind).toBe('string');
    });

    it('parses nested arrays with per-item paths', () => {
        const result = parseJson('{"items":[{"n":1},{"n":2}]}');

        if (!result.ok) {
            throw new Error('expected ok');
        }

        expect(result.root.children[0]?.children[0]?.path).toBe('$.items[0]');
        expect(result.root.children[0]?.children[1]?.children[0]?.path).toBe('$.items[1].n');
    });

    it('returns a positioned error for malformed JSON', () => {
        const result = parseJson('{"name":}');
        expect(result.ok).toBe(false);

        if (result.ok) {
            throw new Error('expected error');
        }

        expect(result.line).toBeGreaterThan(0);
        expect(result.column).toBeGreaterThan(0);
    });

    it.each([
        { name: 'a trailing comma', text: '{"a":1,}', line: 1, column: 8 },
        { name: 'a missing comma across lines', text: '{"a":1\n  "b":2}', line: 2, column: 3 },
        { name: 'a misspelt literal', text: '{"a": tru}', line: 1, column: 7 },
        { name: 'an unterminated array', text: '[1,2', line: 1, column: 5 },
        { name: 'an unterminated string', text: '{"a":"x', line: 1, column: 8 },
        { name: 'empty input', text: '', line: 1, column: 1 },
        { name: 'a bad escape', text: '["a\\q"]', line: 1, column: 5 },
        { name: 'text after the value', text: '{}\n\n  x', line: 3, column: 3 },
        { name: 'an error deep in a later line', text: '{\n  "items": [\n    1,\n    2 3\n  ]\n}', line: 4, column: 7 },
    ])('points at $name', ({ text, line, column }) => {
        const result = parseJson(text);

        if (result.ok) {
            throw new Error('expected error');
        }

        expect({ line: result.line, column: result.column }).toEqual({ line, column });
        expect(result.message).toMatch(/^Expected /);
    });
});

describe('isPlainObject', () => {
    it('is true for an object only, never for an array or null', () => {
        expect(isPlainObject({ id: 1 })).toBe(true);
        expect(isPlainObject({})).toBe(true);
        expect(isPlainObject([1])).toBe(false);
        expect(isPlainObject(null)).toBe(false);
        expect(isPlainObject(undefined)).toBe(false);
        expect(isPlainObject('text')).toBe(false);
    });
});

describe('findJsonError', () => {
    it('accepts every valid JSON shape', () => {
        const valid = [
            '{}',
            '[]',
            '  "text with \\"quotes\\" and \\u00e9"  ',
            '-0.5e+10',
            '{"nested":{"list":[true,false,null,1,"x"]}}',
        ];

        for (const text of valid) {
            expect(findJsonError(text)).toBeNull();
        }
    });
});
