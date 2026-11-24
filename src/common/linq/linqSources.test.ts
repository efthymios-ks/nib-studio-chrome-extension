import { describe, expect, it } from 'vitest';
import { buildCsvRowIndexAsync } from '../csv/csvRowIndex.js';
import { createArrayTableSource, createCsvTableSource, type LinqRowBatch, type LinqTableSource } from './linqSources.js';

async function collectAsync(source: LinqTableSource, signal?: AbortSignal): Promise<LinqRowBatch[]> {
    const batches: LinqRowBatch[] = [];

    for await (const batch of source.batches(signal)) {
        batches.push(batch);
    }

    return batches;
}

function rowsOfLength(count: number): number[][] {
    return Array.from({ length: count }, (_, index) => [index]);
}

describe('linqSources', () => {
    describe('createArrayTableSource', () => {
        it('exposes the columns', () => {
            const source = createArrayTableSource(['id', 'name'], []);

            expect(source.columns).toEqual(['id', 'name']);
        });

        it('yields nothing for an empty table', async () => {
            await expect(collectAsync(createArrayTableSource(['id'], []))).resolves.toEqual([]);
        });

        it('yields rows in batches with progress', async () => {
            const rows = rowsOfLength(5);

            const batches = await collectAsync(createArrayTableSource(['id'], rows, 2));

            expect(batches).toEqual([
                { rows: [[0], [1]], done: 2, total: 5 },
                { rows: [[2], [3]], done: 4, total: 5 },
                { rows: [[4]], done: 5, total: 5 },
            ]);
        });

        it('yields one batch when the table fits', async () => {
            const batches = await collectAsync(createArrayTableSource(['id'], rowsOfLength(3)));

            expect(batches).toHaveLength(1);
            expect(batches[0]?.done).toBe(3);
        });

        it('can be read more than once', async () => {
            const source = createArrayTableSource(['id'], rowsOfLength(3), 2);

            await collectAsync(source);

            await expect(collectAsync(source)).resolves.toHaveLength(2);
        });

        it('stops when the caller ends iteration early', async () => {
            const source = createArrayTableSource(['id'], rowsOfLength(10), 2);
            const seen: number[] = [];

            for await (const batch of source.batches()) {
                seen.push(batch.done);

                if (batch.done >= 4) {
                    break;
                }
            }

            expect(seen).toEqual([2, 4]);
        });

        it('throws an abort error when the signal is already aborted', async () => {
            const controller = new AbortController();
            controller.abort();

            await expect(collectAsync(createArrayTableSource(['id'], rowsOfLength(3)), controller.signal))
                .rejects.toMatchObject({ name: 'AbortError' });
        });

        it('throws an abort error between batches once aborted', async () => {
            const controller = new AbortController();
            const seen: number[] = [];
            const source = createArrayTableSource(['id'], rowsOfLength(6), 2);

            const readAsync = async (): Promise<void> => {
                for await (const batch of source.batches(controller.signal)) {
                    seen.push(batch.done);
                    controller.abort();
                }
            };

            await expect(readAsync()).rejects.toMatchObject({ name: 'AbortError' });
            expect(seen).toEqual([2]);
        });
    });

    describe('createCsvTableSource', () => {
        const CSV = 'id,name\n1,Ada\n2,Grace\n3,Linus\n';

        async function openAsync(text: string, batchRecords?: number): Promise<LinqTableSource> {
            const blob = new Blob([text]);
            const index = await buildCsvRowIndexAsync(blob);

            return createCsvTableSource({ columns: ['id', 'name'], blob, index, delimiter: ',', batchRecords });
        }

        it('exposes the columns', async () => {
            const source = await openAsync(CSV);

            expect(source.columns).toEqual(['id', 'name']);
        });

        it('skips the header and yields the data rows', async () => {
            const batches = await collectAsync(await openAsync(CSV));
            const rows = batches.flatMap((batch) => batch.rows);

            expect(rows).toEqual([['1', 'Ada'], ['2', 'Grace'], ['3', 'Linus']]);
            expect(batches.at(-1)?.done).toBe(batches.at(-1)?.total);
        });

        it('honours the batch size', async () => {
            const batches = await collectAsync(await openAsync(CSV, 2));

            expect(batches.map((batch) => batch.rows.length)).toEqual([2, 1]);
        });

        it('yields no rows for a header-only file', async () => {
            const batches = await collectAsync(await openAsync('id,name\n'));

            expect(batches.flatMap((batch) => batch.rows)).toEqual([]);
        });

        it('throws an abort error when the signal is already aborted', async () => {
            const controller = new AbortController();
            controller.abort();

            await expect(collectAsync(await openAsync(CSV), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
        });
    });
});
