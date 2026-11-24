import { describe, expect, it } from 'vitest';
import { checkSchema } from './jsonSchema.js';
import { SAMPLE_DEPTH, sampleFromSchema, type SampleOptions, type SampleResult } from './sampleFromSchema.js';
import { generateSchema } from './schemaGenerator.js';

function sample(schema: unknown, options: SampleOptions = {}): SampleResult {
    return sampleFromSchema(JSON.stringify(schema), options);
}

// The sample of a schema it must satisfy in full: no notes, and the validator accepts it.
function valueOf(schema: unknown, options: SampleOptions = {}): unknown {
    const result = sample(schema, options);

    if (!result.ok) {
        throw new Error(result.message);
    }

    expect(result.notes).toEqual([]);
    expect(checkSchema(result.value, JSON.stringify(schema))).toMatchObject({ ok: true });

    return result.value;
}

function notesOf(schema: unknown, options: SampleOptions = {}): string[] {
    const result = sample(schema, options);

    if (!result.ok) {
        throw new Error(result.message);
    }

    return result.notes.map((note) => note.message);
}

function depthOf(value: unknown): number {
    if (value == null || typeof value !== 'object') {
        return 0;
    }

    return 1 + Math.max(0, ...Object.values(value).map(depthOf));
}

describe('sampleFromSchema', () => {
    describe('listed values', () => {
        it('takes const first, then examples, then default, then enum', () => {
            expect(valueOf({ type: 'integer', const: 5, examples: [6], default: 7 })).toBe(5);
            expect(valueOf({ type: 'string', examples: ['ex'], default: 'def', enum: ['ex', 'def', 'en'] })).toBe('ex');
            expect(valueOf({ enum: ['a', 'b'], default: 'b' })).toBe('b');
            expect(valueOf({ enum: ['red', 'green'] })).toBe('red');
        });

        it('skips listed values the schema rejects', () => {
            expect(valueOf({ type: 'string', minLength: 3, examples: ['ab'], default: 'abcd' })).toBe('abcd');
            expect(valueOf({ type: 'integer', default: 'x' })).toBe(0);
            expect(valueOf({ type: 'integer', minimum: 10, enum: [1, 20, 30] })).toBe(20);
        });

        it('copies listed objects and arrays whole', () => {
            const example = { id: 1, tags: ['a'] };

            expect(valueOf({ type: 'object', examples: [example] })).toEqual(example);
            expect(valueOf({ const: [1, { a: null }] })).toEqual([1, { a: null }]);
        });

        it('keeps a const the schema contradicts, and reports it', () => {
            const result = sample({ type: 'string', const: 5 });

            expect(result).toMatchObject({ ok: true, value: 5 });
            expect(notesOf({ type: 'string', const: 5 })).toEqual(['`type` at `$` not satisfied; edit the value']);
        });

        it('says no value can match an empty enum', () => {
            expect(sample({ enum: [] })).toEqual({ ok: false, message: 'No value can match this schema.' });
        });
    });

    describe('types', () => {
        it.each([
            [{ type: 'string' }, 'string'],
            [{ type: 'integer' }, 0],
            [{ type: 'number' }, 0],
            [{ type: 'boolean' }, true],
            [{ type: 'null' }, null],
            [{ type: 'object' }, {}],
            [{ type: 'array' }, []],
        ])('gives %j a plain value', (schema, expected) => {
            expect(valueOf(schema)).toEqual(expected);
        });

        it('takes the first type that is not null, and null only when nothing else is allowed', () => {
            expect(valueOf({ type: ['null', 'string', 'integer'] })).toBe('string');
            expect(valueOf({ type: ['null'] })).toBeNull();
            expect(valueOf({ type: ['integer', 'null'], minimum: 3 })).toBe(3);
        });

        it('moves to the next type when the first can\'t be satisfied', () => {
            expect(valueOf({ type: ['string', 'integer'], pattern: '^(?=x)y', minimum: 2 })).toBe(2);
        });

        it('infers a type from the keywords when there is no type', () => {
            expect(valueOf({ properties: { a: { type: 'integer' } } })).toEqual({ a: 0 });
            expect(valueOf({ items: { type: 'boolean' } })).toEqual([true]);
            expect(valueOf({ minLength: 2, maxLength: 3 })).toBe('str');
            expect(valueOf({ minimum: 4 })).toBe(4);
        });

        it('gives an empty object for an empty schema and for true', () => {
            expect(valueOf({})).toEqual({});
            expect(valueOf(true)).toEqual({});
            expect(valueOf({ title: 'Anything', description: 'No rules' })).toEqual({});
        });

        it('reports that nothing matches the schema false', () => {
            expect(sample(false)).toEqual({ ok: false, message: 'The schema is false, so no value can match it.' });
        });

        it('says no value can match types that exclude each other', () => {
            expect(sample({ allOf: [{ type: 'string' }, { type: 'boolean' }] })).toEqual({ ok: false, message: 'No value can match this schema.' });
            expect(valueOf({ allOf: [{ type: 'number' }, { type: ['integer', 'string'] }], minimum: 1.5 })).toBe(2);
        });
    });

    describe('numbers', () => {
        it.each([
            [{ type: 'integer', minimum: -10, maximum: 10 }, 0],
            [{ type: 'integer', minimum: 5 }, 5],
            [{ type: 'integer', exclusiveMinimum: 5 }, 6],
            [{ type: 'integer', maximum: -3 }, -3],
            [{ type: 'integer', exclusiveMaximum: 0 }, -1],
            [{ type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1 }, 0.5],
            [{ type: 'number', minimum: 0.2, maximum: 0.3 }, 0.25],
            [{ type: 'integer', multipleOf: 7, minimum: 10 }, 14],
            [{ type: 'number', multipleOf: 0.25, minimum: 0.3 }, 0.5],
            [{ type: 'number', multipleOf: 0.1, minimum: 0.25 }, 0.3],
            [{ type: 'integer', minimum: 3, maximum: 3 }, 3],
            [{ type: 'integer', allOf: [{ multipleOf: 4 }, { multipleOf: 6 }], minimum: 1 }, 12],
            [{ type: 'integer', minimum: 1e12 }, 1e12],
        ])('gives %j the valid number nearest 0', (schema, expected) => {
            expect(valueOf(schema)).toBe(expected);
        });

        it('reports bounds no number fits', () => {
            expect(notesOf({ type: 'integer', minimum: 0.2, maximum: 0.8 })).not.toEqual([]);
        });
    });

    describe('strings', () => {
        it('pads or trims "string" to the length allowed', () => {
            expect(valueOf({ type: 'string', minLength: 10 })).toBe('stringstri');
            expect(valueOf({ type: 'string', maxLength: 3 })).toBe('str');
            expect(valueOf({ type: 'string', maxLength: 0 })).toBe('');
            expect(valueOf({ type: 'string', minLength: 2, maxLength: 2 })).toBe('st');
        });

        it.each([
            ['date-time', '2024-01-01T12:00:00Z'],
            ['date', '2024-01-01'],
            ['time', '12:00:00Z'],
            ['email', 'user@example.com'],
            ['uri', 'https://example.com'],
            ['url', 'https://example.com'],
            ['uri-reference', 'https://example.com'],
            ['uuid', '123e4567-e89b-42d3-a456-426614174000'],
            ['hostname', 'example.com'],
            ['ipv4', '192.0.2.1'],
            ['ipv6', '2001:db8::1'],
            ['duration', 'P1D'],
            ['json-pointer', '/example'],
            ['regex', '^[a-z]+$'],
        ])('gives the %s format a fixed valid value', (name, expected) => {
            expect(valueOf({ type: 'string', format: name })).toBe(expected);
        });

        it('gives an unknown format a plain string', () => {
            expect(valueOf({ type: 'string', format: 'int32' })).toBe('string');
        });

        it.each([
            ['^[A-Z]{3}-\\d{4}$', 'AAA-0000'],
            ['^(foo|bar)$', 'foo'],
            ['^v\\d+\\.\\d+\\.\\d+$', 'v0.0.0'],
            ['^[a-z0-9-]+$', 'string'],
            ['^#[0-9a-fA-F]{6}$', '#aaaaaa'],
            ['^\\+?[1-9]\\d{1,14}$', '10'],
            ['^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$', 'a@a.aa'],
            ['hello', 'hello'],
            ['^ab+c?$', 'ab'],
            ['^(?<year>\\d{4})-(?:0[1-9]|1[0-2])$', '0000-01'],
            ['^\\p{L}+$', 'string'],
            ['^[\\w.-]+$', 'string'],
            ['\\.json$', '.json'],
        ])('builds a match for the pattern %s', (pattern, expected) => {
            const value = valueOf({ type: 'string', pattern });

            expect(value).toBe(expected);
        });

        it('meets minLength with a repeating pattern', () => {
            expect(valueOf({ type: 'string', pattern: '^\\d+$', minLength: 5 })).toBe('00000');
            expect(valueOf({ type: 'string', pattern: '^[a-z]+$', minLength: 3, maxLength: 4 })).toBe('aaa');
        });

        it.each([
            ['^(?=.*[A-Z])(?=.*\\d).{8,}$'],
            ['^(a)\\1$'],
            ['^(?!string).+@corp$'],
        ])('reports the pattern %s rather than passing a sample off as valid', (pattern) => {
            const schema = { type: 'object', properties: { code: { type: 'string', pattern } }, required: ['code'] };
            const result = sample(schema);

            expect(result.ok).toBe(true);
            expect(notesOf(schema)).toEqual(['`pattern` at `$.code` not satisfied; edit the value']);
            expect(checkSchema(result.ok ? result.value : null, JSON.stringify(schema)).ok).toBe(false);
        });

        it('says why a pattern that isn\'t a valid regular expression can\'t be used', () => {
            expect(sample({ type: 'string', pattern: '(' })).toMatchObject({ ok: false });
        });
    });

    describe('objects', () => {
        const PERSON = {
            type: 'object',
            properties: {
                name: { type: 'string' },
                age: { type: 'integer', minimum: 0 },
                email: { type: 'string', format: 'email' },
            },
            required: ['email', 'name'],
        };

        it('lists every property in schema order', () => {
            const value = valueOf(PERSON);

            expect(value).toEqual({ name: 'string', age: 0, email: 'user@example.com' });
            expect(Object.keys(value as object)).toEqual(['name', 'age', 'email']);
        });

        it('keeps only the required properties with Required only', () => {
            expect(Object.keys(valueOf(PERSON, { isRequiredOnly: true }) as object)).toEqual(['name', 'email']);
        });

        it('gives required keys missing from properties a value from additionalProperties, or a string', () => {
            expect(valueOf({ type: 'object', required: ['id'] })).toEqual({ id: 'string' });
            expect(valueOf({ type: 'object', required: ['id'], additionalProperties: { type: 'integer' } })).toEqual({ id: 0 });
            expect(valueOf({ type: 'object', required: ['x-id'], patternProperties: { '^x-': { type: 'boolean' } } })).toEqual({ 'x-id': true });
        });

        it('adds optional properties, then pattern keys, then extra keys to reach minProperties', () => {
            expect(valueOf({ type: 'object', properties: { a: {}, b: {} }, required: ['a'], minProperties: 2 }, { isRequiredOnly: true })).toEqual({ a: {}, b: {} });
            expect(valueOf({ type: 'object', patternProperties: { '^n\\d$': { type: 'integer' } }, minProperties: 2 })).toEqual({ n0: 0, n1: 0 });
            expect(valueOf({ type: 'object', minProperties: 2 })).toEqual({ property1: 'string', property2: 'string' });
            expect(valueOf({ type: 'object', minProperties: 1, propertyNames: { pattern: '^[a-z]+$' } })).toEqual({ string: 'string' });
        });

        it('leaves patternProperties out unless minProperties needs them', () => {
            expect(valueOf({ type: 'object', properties: { a: { type: 'null' } }, patternProperties: { '^x-': {} } })).toEqual({ a: null });
        });

        it('drops optional properties from the end to keep within maxProperties', () => {
            expect(valueOf({ type: 'object', properties: { a: {}, b: {}, c: {} }, required: ['c'], maxProperties: 2 })).toEqual({ a: {}, c: {} });
        });

        it('adds the keys dependentRequired names for a present key', () => {
            const schema = {
                type: 'object',
                properties: { card: { type: 'string' }, billing: { type: 'string' } },
                required: ['card'],
                dependentRequired: { card: ['billing'] },
            };

            expect(valueOf(schema, { isRequiredOnly: true })).toEqual({ card: 'string', billing: 'string' });
        });

        it('applies dependentSchemas for a present key', () => {
            const schema = {
                type: 'object',
                properties: { card: { type: 'string' } },
                required: ['card'],
                dependentSchemas: { card: { properties: { cvc: { type: 'string', pattern: '^\\d{3}$' } }, required: ['cvc'] } },
            };

            expect(valueOf(schema)).toEqual({ card: 'string', cvc: '000' });
        });

        it('leaves out an optional property no value can match, and reports a required one', () => {
            expect(valueOf({ type: 'object', properties: { a: false, b: { type: 'null' } } })).toEqual({ b: null });
            expect(notesOf({ type: 'object', properties: { a: false }, required: ['a'] })).toEqual(['`required` at `$` not satisfied; edit the value']);
        });

        it('keeps a key such as __proto__ an ordinary property', () => {
            const result = sampleFromSchema('{"type":"object","properties":{"__proto__":{"type":"integer"}},"required":["__proto__"]}');

            expect(result.ok && JSON.stringify(result.value)).toBe('{"__proto__":0}');
        });

        it('reports a required key that additionalProperties false forbids', () => {
            expect(notesOf({ type: 'object', required: ['id'], additionalProperties: false })).toEqual(['`required` at `$` not satisfied; edit the value']);
        });
    });

    describe('arrays', () => {
        it('has max(minItems, 1) items, capped by maxItems', () => {
            expect(valueOf({ type: 'array', items: { type: 'integer' } })).toEqual([0]);
            expect(valueOf({ type: 'array', items: { type: 'integer' }, minItems: 3 })).toEqual([0, 0, 0]);
            expect(valueOf({ type: 'array', items: { type: 'integer' }, maxItems: 0 })).toEqual([]);
            expect(valueOf({ type: 'array', minItems: 2 })).toEqual([{}, {}]);
        });

        it('takes prefixItems, then items', () => {
            expect(valueOf({ type: 'array', prefixItems: [{ type: 'string' }, { type: 'boolean' }], items: { type: 'null' }, minItems: 3 })).toEqual(['string', true, null]);
            expect(valueOf({ type: 'array', prefixItems: [{ type: 'integer' }, { type: 'integer' }], items: false })).toEqual([0, 0]);
            expect(valueOf({ type: 'array', prefixItems: [{ type: 'integer' }, { type: 'string' }], maxItems: 1 })).toEqual([0]);
        });

        it('makes items distinct for uniqueItems', () => {
            expect(valueOf({ type: 'array', items: { type: 'string' }, minItems: 3, uniqueItems: true })).toEqual(['string', 'string2', 'string3']);
            expect(valueOf({ type: 'array', items: { enum: ['a', 'b', 'c'] }, minItems: 2, uniqueItems: true })).toEqual(['a', 'b']);
            expect(valueOf({ type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 3, uniqueItems: true })).toEqual([1, 2, 3]);
            expect(valueOf({ type: 'array', items: { type: 'string', format: 'email' }, minItems: 2, uniqueItems: true }))
                .toEqual(['user@example.com', 'user2@example.com']);
            expect(valueOf({
                type: 'array',
                items: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
                minItems: 2,
                uniqueItems: true,
            })).toEqual([{ id: 0 }, { id: 1 }]);
        });

        it('reports uniqueItems that can\'t be met', () => {
            expect(notesOf({ type: 'array', items: { type: 'boolean' }, minItems: 3, uniqueItems: true })).toEqual(['`uniqueItems` at `$` not satisfied; edit the value']);
        });

        it('satisfies contains and minContains', () => {
            expect(valueOf({ type: 'array', items: { type: 'integer' }, contains: { minimum: 5 } })).toEqual([5]);
            expect(valueOf({ type: 'array', contains: { type: 'string' } })).toEqual(['string']);
            expect(valueOf({ type: 'array', items: { type: 'integer' }, minItems: 2, contains: { const: 3 }, minContains: 2 })).toEqual([3, 3]);
            expect(valueOf({ type: 'array', prefixItems: [{ type: 'string' }], items: { type: 'integer' }, contains: { type: 'integer' } })).toEqual(['string', 0]);
        });
    });

    describe('references', () => {
        it('follows $defs, definitions and JSON pointers within the schema', () => {
            expect(valueOf({ $defs: { id: { type: 'integer', minimum: 1 } }, $ref: '#/$defs/id' })).toBe(1);
            expect(valueOf({ definitions: { name: { type: 'string', maxLength: 4 } }, properties: { name: { $ref: '#/definitions/name' } } })).toEqual({ name: 'stri' });
            expect(valueOf({ properties: { a: { type: 'boolean' }, b: { $ref: '#/properties/a' } } })).toEqual({ a: true, b: true });
            expect(valueOf({ $defs: { 'a/b': { const: 1 } }, $ref: '#/$defs/a~1b' })).toBe(1);
        });

        it('applies a reference together with the keywords beside it', () => {
            expect(valueOf({ $defs: { positive: { type: 'integer', minimum: 1 } }, $ref: '#/$defs/positive', multipleOf: 5 })).toBe(5);
        });

        it('says when a reference can\'t be resolved, as Validate does', () => {
            expect(sample({ properties: { a: { $ref: '#/$defs/missing' } } })).toEqual({
                ok: false,
                message: 'Cannot resolve $ref "#/$defs/missing"; only references within this schema work.',
            });
        });

        it('stops an optional recursion at the sample depth', () => {
            const tree = { type: 'object', properties: { name: { type: 'string' }, children: { type: 'array', items: { $ref: '#' } } }, required: ['name'] };
            const value = valueOf(tree);

            expect(depthOf(value)).toBeLessThanOrEqual(SAMPLE_DEPTH + 1);
            expect((value as { children: unknown[] }).children).toHaveLength(1);
        });

        it('stops a required recursion and reports where', () => {
            const list = { $defs: { node: { type: 'object', properties: { next: { $ref: '#/$defs/node' } }, required: ['next'] } }, $ref: '#/$defs/node' };
            const notes = notesOf(list);

            expect(notes).toHaveLength(1);
            expect(notes[0]).toMatch(/^`required` at `\$(\.next)+` not satisfied; edit the value$/);
        });

        it('says what Validate says about a reference that loops back to itself', () => {
            const text = JSON.stringify({ $defs: { a: { allOf: [{ $ref: '#/$defs/b' }] }, b: { $ref: '#/$defs/a' } }, $ref: '#/$defs/a', type: 'integer' });
            const check = checkSchema(0, text);

            expect(check.ok).toBe(false);
            expect(sampleFromSchema(text)).toEqual({ ok: false, message: 'message' in check ? check.message : '' });
        });
    });

    describe('combinators', () => {
        it('merges allOf', () => {
            expect(valueOf({
                allOf: [
                    { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
                    { properties: { id: { minimum: 3 }, name: { type: 'string' } }, required: ['name'] },
                ],
            })).toEqual({ id: 3, name: 'string' });
        });

        it('takes the first anyOf branch that gives a valid value', () => {
            expect(valueOf({ anyOf: [{ type: 'string', allOf: [{ minLength: 5 }, { maxLength: 2 }] }, { type: 'integer' }] })).toBe(0);
            expect(valueOf({ anyOf: [{ type: 'string' }, { type: 'integer' }] })).toBe('string');
        });

        it('takes a oneOf branch that no other branch accepts', () => {
            expect(valueOf({ oneOf: [{ type: 'string', maxLength: 2 }, { type: 'string', minLength: 1 }] })).toBe('string');
            expect(valueOf({ oneOf: [{ const: 'a' }, { const: 'b' }] })).toBe('a');
        });

        it('reports a oneOf every branch of which accepts the same values', () => {
            expect(notesOf({ oneOf: [{ type: 'integer' }, { type: 'number' }] })).toEqual(['`oneOf` at `$` not satisfied; edit the value']);
        });

        it('applies then when the sample satisfies if, and else when it doesn\'t', () => {
            const address = {
                type: 'object',
                properties: { country: { enum: ['US', 'CA'] } },
                required: ['country'],
                if: { properties: { country: { const: 'US' } } },
                then: { properties: { zip: { type: 'string', pattern: '^\\d{5}$' } }, required: ['zip'] },
                else: { properties: { postal: { type: 'string' } }, required: ['postal'] },
            };

            expect(valueOf(address)).toEqual({ country: 'US', zip: '00000' });
            expect(valueOf({ ...address, properties: { country: { enum: ['CA', 'US'] } } })).toEqual({ country: 'CA', postal: 'string' });
        });

        it('ignores not, and reports when the sample fails it', () => {
            expect(notesOf({ type: 'integer', not: { const: 0 } })).toEqual(['`not` at `$` not satisfied; edit the value']);
        });
    });

    describe('schema text', () => {
        it('says why text isn\'t a schema, as Validate does', () => {
            expect(sampleFromSchema('{"type":')).toMatchObject({ ok: false });
            expect(sampleFromSchema('[1]')).toEqual({ ok: false, message: 'A schema must be a JSON object, true or false.' });
        });

        it('gives the same sample every time', () => {
            const schema = JSON.stringify({ type: 'array', items: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'integer' }] }, minItems: 3, uniqueItems: true });

            expect(sampleFromSchema(schema)).toEqual(sampleFromSchema(schema));
        });
    });

    // The key property: whatever the schema, the sample passes it, or each keyword it misses is reported.
    describe('corpus', () => {
        const DOCUMENTS: ReadonlyArray<unknown> = [
            { name: 'Ada', age: 36, email: 'ada@example.com', tags: ['math', 'code'], address: { city: 'London', zip: null } },
            [{ id: 1, total: 9.5, paid: true, placed: '2024-03-01T10:00:00Z' }, { id: 2, total: 3, paid: false, note: 'gift' }],
            { matrix: [[1, 2], [3, 4]], meta: { generated: '2024-01-01', id: '123e4567-e89b-42d3-a456-426614174000' }, mixed: [1, 'a', { b: [] }, null] },
            'plain',
            [],
        ];

        const CORPUS: ReadonlyArray<readonly [string, unknown]> = [
            ['nested objects', {
                type: 'object',
                properties: {
                    user: { type: 'object', properties: { id: { type: 'integer' }, profile: { type: 'object', properties: { bio: { type: 'string', maxLength: 5 } } } }, required: ['id'] },
                    active: { type: 'boolean' },
                },
                required: ['user'],
            }],
            ['arrays of objects', { type: 'array', items: { type: 'object', properties: { sku: { type: 'string', pattern: '^[A-Z]{2}\\d{3}$' }, qty: { type: 'integer', minimum: 1 } }, required: ['sku', 'qty'] }, minItems: 2 }],
            ['tuples', { type: 'array', prefixItems: [{ type: 'number' }, { type: 'number' }, { enum: ['lat', 'lon'] }], items: false }],
            ['references', {
                $defs: { money: { type: 'object', properties: { amount: { type: 'number', exclusiveMinimum: 0 }, currency: { enum: ['EUR', 'USD'] } }, required: ['amount', 'currency'] } },
                type: 'object',
                properties: { price: { $ref: '#/$defs/money' }, discount: { $ref: '#/$defs/money' } },
            }],
            ['recursion', {
                $defs: { category: { type: 'object', properties: { title: { type: 'string' }, sub: { type: 'array', items: { $ref: '#/$defs/category' } } }, required: ['title'] } },
                $ref: '#/$defs/category',
            }],
            ['combinators', {
                type: 'object',
                properties: {
                    shape: {
                        oneOf: [
                            { type: 'object', properties: { kind: { const: 'circle' }, radius: { type: 'number', minimum: 1 } }, required: ['kind', 'radius'] },
                            { type: 'object', properties: { kind: { const: 'square' }, side: { type: 'number' } }, required: ['kind', 'side'] },
                        ],
                    },
                    id: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'integer' }] },
                    flags: { allOf: [{ type: 'array', items: { type: 'string' } }, { minItems: 2, uniqueItems: true }] },
                },
                required: ['shape', 'id', 'flags'],
            }],
            ['formats', {
                type: 'object',
                properties: Object.fromEntries(['date-time', 'date', 'time', 'email', 'uri', 'uuid', 'hostname', 'ipv4', 'ipv6'].map((name) => [name, { type: 'string', format: name }])),
            }],
            ['numeric bounds', {
                type: 'object',
                properties: {
                    percent: { type: 'number', minimum: 0, maximum: 100, multipleOf: 0.5 },
                    negative: { type: 'integer', exclusiveMaximum: 0 },
                    narrow: { type: 'number', exclusiveMinimum: 1, exclusiveMaximum: 2 },
                    stepped: { type: 'integer', multipleOf: 25, minimum: 30, maximum: 99 },
                },
            }],
            ['enums and const', { type: 'object', properties: { status: { enum: ['draft', 'live'] }, version: { const: 2 }, level: { type: 'integer', enum: [3, 4] } }, required: ['status', 'version'] }],
            ['conditions', {
                type: 'object',
                properties: { kind: { enum: ['person', 'company'] } },
                required: ['kind'],
                allOf: [
                    { if: { properties: { kind: { const: 'person' } } }, then: { properties: { born: { type: 'string', format: 'date' } }, required: ['born'] } },
                    { if: { properties: { kind: { const: 'company' } } }, then: { properties: { vat: { type: 'string' } }, required: ['vat'] } },
                ],
            }],
            ['unevaluated and additional properties', {
                type: 'object',
                properties: { a: { type: 'integer' } },
                patternProperties: { '^x-': { type: 'string' } },
                additionalProperties: false,
                minProperties: 2,
            }],
            ['nullable mixes', { type: 'object', properties: { note: { type: ['string', 'null'], maxLength: 2 }, items: { type: ['array', 'null'], items: { type: 'integer' } } } }],
            ['object maps', { type: 'object', additionalProperties: { type: 'array', items: { type: 'string', format: 'email' }, uniqueItems: true, minItems: 2 }, minProperties: 1 }],
            ['contains', { type: 'array', items: { type: 'integer' }, contains: { minimum: 10, maximum: 20 }, minContains: 2, maxItems: 3 }],
        ];

        it.each(CORPUS)('gives a sample that passes the schema: %s', (_, schema) => {
            valueOf(schema);
            valueOf(schema, { isRequiredOnly: true });
        });

        it.each(DOCUMENTS.map((document, index) => [index, document] as const))('passes the schema Generate infers from document %i', (_, document) => {
            valueOf(generateSchema(document));
            valueOf(generateSchema(document), { isRequiredOnly: true });
        });
    });
});
