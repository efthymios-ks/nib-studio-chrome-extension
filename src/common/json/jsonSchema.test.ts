import { describe, expect, it } from 'vitest';
import { checkSchema, type SchemaCheckResult, type SchemaErrorEntry } from './jsonSchema.js';

const PRODUCT_SCHEMA = JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
        name: { type: 'string', minLength: 1 },
        price: { type: 'number', minimum: 0 },
    },
    required: ['name', 'price'],
});

function errorsOf(result: SchemaCheckResult): ReadonlyArray<SchemaErrorEntry> {
    if (result.ok || !('errors' in result)) {
        throw new Error('expected errors');
    }

    return result.errors;
}

function messageOf(result: SchemaCheckResult): string {
    if (result.ok || !('message' in result)) {
        throw new Error('expected a message');
    }

    return result.message;
}

function check(value: unknown, schema: unknown): SchemaCheckResult {
    return checkSchema(value, JSON.stringify(schema));
}

describe('checkSchema', () => {
    it('reports ok and the keyword count for a matching value', () => {
        expect(checkSchema({ name: 'Mug', price: 8.5 }, PRODUCT_SCHEMA)).toEqual({ ok: true, keywordsChecked: 9 });
    });

    it('lists each failing keyword at its path, without the wrapping properties errors', () => {
        expect(errorsOf(checkSchema({ name: '', price: -1 }, PRODUCT_SCHEMA))).toEqual([
            { path: '$/name', message: 'String is too short (0 < 1).', keyword: 'minLength' },
            { path: '$/price', message: '-1 is less than 0.', keyword: 'minimum' },
        ]);
    });

    it('describes a type mismatch as expected and found', () => {
        expect(errorsOf(checkSchema({ name: 'Mug', price: 'cheap' }, PRODUCT_SCHEMA))).toEqual([
            { path: '$/price', message: 'Expected number, found string.', keyword: 'type' },
        ]);
        expect(errorsOf(check(5, { type: ['string', 'null'] }))[0]?.message).toBe('Expected string or null, found number.');
    });

    it('names a missing required property at the object path', () => {
        expect(errorsOf(checkSchema({ name: 'Mug' }, PRODUCT_SCHEMA))).toEqual([
            { path: '$', message: 'Missing required property "price".', keyword: 'required' },
        ]);
    });

    it('checks formats such as email', () => {
        const schema = { type: 'object', properties: { email: { type: 'string', format: 'email' } } };

        expect(check({ email: 'ada@example.com' }, schema).ok).toBe(true);
        expect(errorsOf(check({ email: 'not an address' }, schema))).toEqual([
            { path: '$/email', message: 'String does not match format "email".', keyword: 'format' },
        ]);
    });

    it('reports the full path of a value nested in arrays and objects', () => {
        const schema = {
            type: 'object',
            properties: {
                orders: {
                    type: 'array',
                    items: { type: 'object', properties: { total: { type: 'number' } } },
                },
            },
        };

        expect(errorsOf(check({ orders: [{ total: 1 }, { total: 'x' }] }, schema))).toEqual([
            { path: '$/orders/1/total', message: 'Expected number, found string.', keyword: 'type' },
        ]);
    });

    it('shows keys with spaces as written and escapes slashes as JSON Pointer does', () => {
        const schema = { properties: { 'first name': { type: 'string' }, 'a/b': { type: 'string' } } };

        expect(errorsOf(check({ 'first name': 5, 'a/b': 5 }, schema)).map((entry) => entry.path)).toEqual(['$/first name', '$/a~1b']);
    });

    it('points at a property that additionalProperties forbids', () => {
        const schema = { type: 'object', properties: { a: {} }, additionalProperties: false };

        expect(errorsOf(check({ a: 1, b: 2 }, schema))).toEqual([
            { path: '$/b', message: 'Not allowed by the schema.', keyword: 'false' },
        ]);
    });

    it('follows $ref within the schema and reports the referenced keyword', () => {
        const schema = {
            $defs: { positive: { type: 'number', minimum: 0 } },
            properties: { count: { $ref: '#/$defs/positive' } },
        };

        expect(errorsOf(check({ count: -2 }, schema))).toEqual([
            { path: '$/count', message: '-2 is less than 0.', keyword: 'minimum' },
        ]);
    });

    it('keeps the anyOf summary with the reason each branch failed', () => {
        const result = check(5, { anyOf: [{ type: 'string' }, { type: 'null' }] });

        expect(errorsOf(result).map((entry) => entry.message)).toEqual([
            'Value does not match any subschemas.',
            'Expected string, found number.',
            'Expected null, found number.',
        ]);
    });

    it('names the key that fails propertyNames, without the subschema errors', () => {
        const result = check({ toolong: 1 }, { propertyNames: { maxLength: 3 } });

        expect(errorsOf(result)).toEqual([
            { path: '$', message: 'Property name "toolong" does not match schema.', keyword: 'propertyNames' },
        ]);
    });

    it('allows unknown keywords', () => {
        expect(check({}, { type: 'object', 'x-note': 'kept' }).ok).toBe(true);
    });

    it('accepts boolean schemas', () => {
        expect(check({ any: 'thing' }, true)).toEqual({ ok: true, keywordsChecked: 0 });
        expect(errorsOf(check(1, false))).toEqual([
            { path: '$', message: 'Not allowed by the schema.', keyword: 'false' },
        ]);
    });

    it('reports a message when the schema itself is invalid JSON', () => {
        expect(messageOf(checkSchema({}, '{ not: json')).length).toBeGreaterThan(0);
    });

    it('rejects a schema that is not an object or a boolean', () => {
        expect(messageOf(checkSchema({}, '5'))).toBe('A schema must be a JSON object, true or false.');
        expect(messageOf(checkSchema({}, '[]'))).toBe('A schema must be a JSON object, true or false.');
    });

    it('reports a $ref that does not resolve within the schema', () => {
        expect(messageOf(check({ a: 1 }, { properties: { a: { $ref: '#/$defs/missing' } } })))
            .toBe('Cannot resolve $ref "#/$defs/missing"; only references within this schema work.');
    });

    it('reports an invalid pattern instead of throwing', () => {
        expect(messageOf(check('text', { pattern: '(' }))).toContain('Invalid regular expression');
    });
});
