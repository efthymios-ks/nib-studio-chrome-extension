import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileQuery, runQueryAsync } from './linqEvaluator.js';
import { LINQ_AGGREGATES, LINQ_FUNCTIONS, LINQ_METHODS, LINQ_PROPERTIES } from './linqFunctions.js';
import { LINQ_KEYWORDS } from './linqParser.js';
import { LINQ_REFERENCE, buildExampleQueries, quoteName } from './linqReference.js';
import { createArrayTableSource } from './linqSources.js';

// Column names the reference examples use; docs/Tables.md uses the same file.
const REFERENCE_COLUMNS: ReadonlyArray<string> = [
    'order_id', 'customer', 'city', 'product', 'quantity', 'unit_price', 'total', 'status', 'ordered_at', 'note',
];

const SAMPLE_ROWS = [
    ['ORD-000001', 'Customer 1', 'Patras', 'Glue stick', '2', '5.5', '11', 'delivered', '2024-01-15', 'gift'],
    ['ORD-000002', 'Customer 2', 'Athens', 'Ruler', '1', '7', '7', 'pending', '2025-03-02', ''],
];

const entries = LINQ_REFERENCE.flatMap((section) => section.entries);
const referenceText = entries.map((entry) => `${entry.syntax} ${entry.description} ${entry.example}`).join('\n').toLowerCase();

describe('LINQ_REFERENCE', () => {
    it.each(entries.map((entry) => [entry.syntax, entry.example]))('accepts the example for %s', async (_, example) => {
        expect(() => compileQuery(example, REFERENCE_COLUMNS)).not.toThrow();
        await expect(runQueryAsync(example, createArrayTableSource(REFERENCE_COLUMNS, SAMPLE_ROWS))).resolves.toBeDefined();
    });

    it('documents every keyword', () => {
        for (const keyword of LINQ_KEYWORDS) {
            expect(referenceText, keyword).toMatch(new RegExp(`\\b${keyword}\\b`));
        }
    });

    it('documents every function, method, property and aggregate', () => {
        const names = [
            ...LINQ_FUNCTIONS.map((entry) => entry.name),
            ...LINQ_METHODS.map((entry) => entry.name),
            ...LINQ_PROPERTIES.map((entry) => entry.name),
            ...LINQ_AGGREGATES.map((entry) => entry.name),
        ];

        for (const name of names) {
            expect(referenceText, name).toContain(name.toLowerCase());
        }
    });

    it('matches the syntax listed in docs/Tables.md', () => {
        const docs = readFileSync(new URL('../../../docs/Tables.md', import.meta.url), 'utf-8');

        for (const entry of entries) {
            expect(docs, entry.syntax).toContain(entry.syntax);
        }
    });
});

describe('buildExampleQueries', () => {
    it('builds runnable queries from the real columns', async () => {
        const examples = buildExampleQueries(REFERENCE_COLUMNS, SAMPLE_ROWS);

        expect(examples.length).toBeGreaterThanOrEqual(6);

        for (const example of examples) {
            const result = await runQueryAsync(example.query, createArrayTableSource(REFERENCE_COLUMNS, SAMPLE_ROWS));
            expect(result, example.query).toBeDefined();
        }

        expect(examples.map((example) => example.query).join('\n')).toContain('order_id');
    });

    it('quotes odd column names', async () => {
        const columns = ['unit price', 'from', 'Amount'];
        const rows = [['3', 'x', '5'], ['4', 'y', '6']];
        const examples = buildExampleQueries(columns, rows);

        for (const example of examples) {
            await expect(runQueryAsync(example.query, createArrayTableSource(columns, rows))).resolves.toBeDefined();
        }

        expect(quoteName('unit price')).toBe('`unit price`');
        expect(quoteName('from')).toBe('`from`');
        expect(quoteName('total')).toBe('total');
    });
});
