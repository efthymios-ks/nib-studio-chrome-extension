import { describe, expect, it } from 'vitest';
import { jsonPointerSegments, runJsonPath, type JsonPathError, type JsonPathResult } from './jsonPath.js';

function matches(root: unknown, expression: string): JsonPathResult['matches'] {
    const result = runJsonPath(root, expression);

    if (!result.ok) {
        throw new Error(`expected ok, got ${result.message}`);
    }

    return result.matches;
}

function failure(root: unknown, expression: string): JsonPathError {
    const result = runJsonPath(root, expression);

    if (result.ok) {
        throw new Error('expected an error');
    }

    return result;
}

describe('runJsonPath', () => {
    const document = {
        items: [
            { name: 'Mug', price: 8.5 },
            { name: 'Scarf', price: 24 },
            { name: 'Candle', price: 12 },
        ],
    };

    it('returns the names of items above 10', () => {
        expect(matches(document, '$.items[?(@.price > 10)].name').map((match) => match.value)).toEqual(['Scarf', 'Candle']);
    });

    it('returns an empty match list for an expression that matches nothing', () => {
        expect(matches(document, '$.items[?(@.price > 100)]')).toEqual([]);
    });

    it('returns no matches for a blank expression', () => {
        expect(matches(document, '   ')).toEqual([]);
    });

    it('gives each match its normalized path and the segments the JSON tree uses', () => {
        const found = matches({ 'first name': 'Ada', list: [[1, 2]], '0': 'zero', 'a/b~c': true }, '$..*');

        expect(found.map((match) => [match.path, match.segments])).toEqual([
            ['$[0]', ['0']],
            ["$['first name']", ['first name']],
            ["$['list']", ['list']],
            ["$['a/b~c']", ['a/b~c']],
            ["$['list'][0]", ['list', 0]],
            ["$['list'][0][0]", ['list', 0, 0]],
            ["$['list'][0][1]", ['list', 0, 1]],
        ]);
    });

    it.each([
        ['', []],
        ['/items/1/name', ['items', 1, 'name']],
        ['/a~1b/~0c', ['a/b', '~c']],
        ['/items/9', null],
        ['/items/x', null],
        ['/missing', null],
        ['/items/0/name/length', null],
    ])('follows the JSON Pointer %j to tree segments', (pointer, segments) => {
        expect(jsonPointerSegments({ ...document, 'a/b': { '~c': 1 } }, pointer)).toEqual(segments);
    });

    it('gives the root an empty segment list', () => {
        expect(matches(document, '$')[0]?.segments).toEqual([]);
    });

    it('gives no segments to a value that is not in the document, such as an array length', () => {
        const [length] = matches(document, '$.items.length');

        expect(length?.value).toBe(3);
        expect(length?.segments).toBeNull();
    });

    it.each([
        ['$.items[?(@', "Unclosed '('", 9, 10],
        ['$.items[0', "Unclosed '['", 7, 8],
        ['$.items]', "Unexpected ']'", 7, 8],
        ['$.items[0)', "Expected ']' but found ')'", 9, 10],
        ["$['name", 'Unterminated string', 2, 7],
    ])('says where %j is unbalanced', (expression, message, start, end) => {
        expect(failure(document, expression)).toEqual({ ok: false, message, span: { start, end } });
    });

    it('ignores brackets and escaped quotes inside quoted keys', () => {
        expect(runJsonPath({ 'a]': 1 }, "$['a]']").ok).toBe(true);
        expect(matches({ "it's": 2 }, "$['it\\'s']").map((match) => match.value)).toEqual([2]);
    });

    it('marks the filter an evaluation error comes from, without the evaluator\'s own character count', () => {
        const error = failure(document, '$.items[?(@.price > 1 && )]');

        expect(error.message).toBe('Expected expression after &&');
        expect(error.span).toEqual({ start: 8, end: 26 });
    });

    it('marks the filter whose text the error message quotes', () => {
        const expression = '$.items[?(@.price > 1)].name[?(@.missing.toUpperCase() == "A")]';
        const error = failure({ items: [{ price: 2, name: { first: {} } }] }, expression);

        expect(error.message).toContain('toUpperCase');
        expect(error.message.startsWith('jsonPath')).toBe(false);
        expect(expression.slice(error.span?.start, error.span?.end)).toBe('?(@.missing.toUpperCase() == "A")');
    });
});
