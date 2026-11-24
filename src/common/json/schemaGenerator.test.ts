import { describe, expect, it } from 'vitest';
import { checkSchema } from './jsonSchema.js';
import { generateSchema, MAX_SCHEMA_DEPTH, SCHEMA_DIALECT } from './schemaGenerator.js';

// The schema without its `$schema` line, for comparing shapes.
function shape(document: unknown): Record<string, unknown> {
    const { $schema, ...rest } = generateSchema(document);

    expect($schema).toBe(SCHEMA_DIALECT);

    return rest;
}

describe('generateSchema', () => {
    it('names the Draft 2020-12 dialect first', () => {
        expect(Object.keys(generateSchema({ a: 1 }))[0]).toBe('$schema');
        expect(generateSchema(1).$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    });

    it.each([
        ['text', { type: 'string' }],
        [7, { type: 'integer' }],
        [7.5, { type: 'number' }],
        [true, { type: 'boolean' }],
        [null, { type: 'null' }],
        [{}, { type: 'object' }],
        [[], { type: 'array' }],
    ])('gives %j its type', (document, expected) => {
        expect(shape(document)).toEqual(expected);
    });

    it('lists properties in document order and requires every key of a single object', () => {
        const schema = shape({ zeta: 1, alpha: 'a', mid: false });

        expect(schema).toEqual({
            type: 'object',
            properties: { zeta: { type: 'integer' }, alpha: { type: 'string' }, mid: { type: 'boolean' } },
            required: ['zeta', 'alpha', 'mid'],
        });
        expect(Object.keys(schema['properties'] as object)).toEqual(['zeta', 'alpha', 'mid']);
    });

    it('merges the items of an array of objects, requiring only the keys every item has', () => {
        expect(shape([{ id: 1, name: 'a' }, { id: 2, note: 'x' }, { name: 'c', id: 3 }])).toEqual({
            type: 'array',
            items: {
                type: 'object',
                properties: { id: { type: 'integer' }, name: { type: 'string' }, note: { type: 'string' } },
                required: ['id'],
            },
        });
    });

    it('leaves out required when no key is in every object', () => {
        expect(shape([{ a: 1 }, { b: 2 }])).toEqual({
            type: 'array',
            items: { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'integer' } } },
        });
    });

    it('uses integer only when every number is whole', () => {
        expect(shape([1, 2, 3])).toEqual({ type: 'array', items: { type: 'integer' } });
        expect(shape([1, 2.5, 3])).toEqual({ type: 'array', items: { type: 'number' } });
        expect(shape([1.0, -4, 1e21])).toEqual({ type: 'array', items: { type: 'integer' } });
    });

    it('puts mixed primitive types in a type array, with null last', () => {
        expect(shape([null, 'a', 1])).toEqual({ type: 'array', items: { type: ['string', 'integer', 'null'] } });
        expect(shape([{ v: 'x' }, { v: null }])).toEqual({
            type: 'array',
            items: { type: 'object', properties: { v: { type: ['string', 'null'] } }, required: ['v'] },
        });
    });

    it('makes an object or array nullable with a type array', () => {
        expect(shape([{ a: 1 }, null])).toEqual({
            type: 'array',
            items: { type: ['object', 'null'], properties: { a: { type: 'integer' } }, required: ['a'] },
        });
        expect(shape([null, [1]])).toEqual({ type: 'array', items: { type: ['array', 'null'], items: { type: 'integer' } } });
    });

    it('uses anyOf when objects, arrays and other values mix', () => {
        expect(shape([1, { a: true }, [false], 'x', null])).toEqual({
            type: 'array',
            items: {
                anyOf: [
                    { type: ['integer', 'string', 'null'] },
                    { type: 'object', properties: { a: { type: 'boolean' } }, required: ['a'] },
                    { type: 'array', items: { type: 'boolean' } },
                ],
            },
        });
    });

    it('merges the elements of every array sample into one items schema', () => {
        expect(shape({ rows: [[1, 2], [], ['a']] })).toEqual({
            type: 'object',
            properties: {
                rows: { type: 'array', items: { type: 'array', items: { type: ['integer', 'string'] } } },
            },
            required: ['rows'],
        });
    });

    it('keeps empty arrays and objects to their type', () => {
        expect(shape({ list: [], map: {} })).toEqual({
            type: 'object',
            properties: { list: { type: 'array' }, map: { type: 'object' } },
            required: ['list', 'map'],
        });
        expect(shape([[], []])).toEqual({ type: 'array', items: { type: 'array' } });
    });

    it.each([
        ['date-time', ['2024-05-01T10:30:00Z', '2023-12-31T23:59:59.123+02:00']],
        ['date', ['2024-05-01', '2024-02-29']],
        ['email', ['ada@example.com', 'linus.t@kernel.org']],
        ['uri', ['https://example.com/a?b=1', 'ftp://files.example.org/x']],
        ['uuid', ['6f1c2c2e-6b3a-4a6e-9d1f-0f3a2b1c4d5e', 'A1B2C3D4-0000-4000-8000-123456789ABC']],
    ])('detects the %s format when every string fits it', (expected, values) => {
        expect(shape(values)).toEqual({ type: 'array', items: { type: 'string', format: expected } });
    });

    it.each([
        ['one value does not fit', ['2024-05-01', 'soon']],
        ['an impossible date', ['2023-02-29']],
        ['a date-time without a time zone', ['2024-05-01T10:30:00']],
        ['a scheme without //', ['urn:isbn:0451450523', 'mailto:ada@example.com']],
        ['plain words', ['red', 'green']],
    ])('leaves out the format when %s', (_label, values) => {
        expect(shape(values)).toEqual({ type: 'array', items: { type: 'string' } });
    });

    it('keeps the format next to null', () => {
        expect(shape(['2024-05-01', null])).toEqual({ type: 'array', items: { type: ['string', 'null'], format: 'date' } });
    });

    it('never adds enum, additionalProperties or examples', () => {
        const text = JSON.stringify(generateSchema({ status: ['paid', 'paid', 'open'], nested: { a: [{ b: 1 }] } }));

        expect(text).not.toMatch(/"enum"|"additionalProperties"|"examples"|"const"/);
    });

    it.each([
        ['an order list', {
            orders: [
                { id: 'A-1', placed: '2024-05-01T10:30:00Z', total: 120.5, paid: true, lines: [{ sku: 'X', qty: 2 }], note: null },
                { id: 'B-2', placed: '2024-05-02T08:00:00+01:00', total: 30, paid: false, lines: [], customer: { email: 'ada@example.com' } },
            ],
            meta: { generated: '2024-05-03', source: 'https://example.com/feed', version: 3 },
        }],
        ['mixed arrays', [1, 'two', null, { three: [3, 3.5] }, [4, [5]], true]],
        ['nested arrays of arrays', { grid: [[1, 2], [3, null], []], tags: [['a'], ['b', 'c']] }],
        ['keys that need escaping', { 'first name': 'Ada', 'a/b': 1, '~tilde': [{ 'x.y': null }] }],
        ['a lone value', 'just text'],
        ['an empty object', {}],
        ['an array of empty things', [{}, [], '', 0]],
    ])('generates a schema that %s passes', (_label, document) => {
        const result = checkSchema(document, JSON.stringify(generateSchema(document)));

        expect(result).toMatchObject({ ok: true });
    });

    it('stays fast on a large document and handles deep nesting', () => {
        const rows = Array.from({ length: 60_000 }, (_, index) => ({
            id: index,
            name: `customer ${index}`,
            email: `user${index}@example.com`,
            placed: '2024-05-01T10:30:00Z',
            total: index * 1.25,
            tags: ['a', 'b', index % 2 === 0 ? 'even' : 'odd'],
            address: { city: 'Patras', zip: String(26000 + (index % 500)), geo: [21.73, 38.24] },
        }));
        const text = JSON.stringify({ rows });

        expect(text.length).toBeGreaterThan(10_000_000);

        const started = performance.now();
        const schema = generateSchema(JSON.parse(text));
        const elapsed = performance.now() - started;

        expect(elapsed).toBeLessThan(5_000);
        expect((schema['properties'] as Record<string, Record<string, unknown>>)['rows']?.['items']).toMatchObject({
            required: ['id', 'name', 'email', 'placed', 'total', 'tags', 'address'],
        });

        let deep: unknown = 'bottom';

        for (let depth = 0; depth < 5_000; depth += 1) {
            deep = { level: deep, list: [depth] };
        }

        expect(checkSchema(deep, JSON.stringify(generateSchema(deep)))).toMatchObject({ ok: true });
    });

    it('gives values below the depth limit the empty schema, which accepts anything', () => {
        let document: unknown = { leaf: 1 };

        for (let depth = 1; depth < MAX_SCHEMA_DEPTH; depth += 1) {
            document = { down: document };
        }

        let schema = generateSchema({ down: document }) as Record<string, unknown>;

        for (let depth = 0; depth < MAX_SCHEMA_DEPTH; depth += 1) {
            schema = (schema['properties'] as Record<string, Record<string, unknown>>)['down'] as Record<string, unknown>;
        }

        expect(schema).toEqual({});
        expect(generateSchema([[{ a: 1 }]])).toMatchObject({ items: { items: { required: ['a'] } } });
    });
});
