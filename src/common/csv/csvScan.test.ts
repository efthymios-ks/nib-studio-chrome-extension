import { describe, expect, it } from 'vitest';
import { CsvRangeReader } from './csvRangeReader.js';
import { buildCsvRowIndexAsync } from './csvRowIndex.js';
import {
    buildSortKeysAsync,
    estimateSortKeyBytes,
    findMatchingRowsAsync,
    scanCsvRecordsAsync,
    sortRowPermutation,
    typeSortKey,
} from './csvScan.js';

const ORDERS = [
    'order_id,customer,city,total,ordered_at,note',
    '1,Anna,Athens,12.5,2024-03-01,',
    '2,Bob,"Thessaloniki, GR",7,2024-01-15,"gift, wrap please"',
    '3,Carol,Athens,,2024-02-10,"two\nlines"',
    '4,Dave,Patras,100,2023-12-31,',
].join('\n');

async function openAsync(text: string): Promise<{ blob: Blob; index: Awaited<ReturnType<typeof buildCsvRowIndexAsync>> }> {
    const blob = new Blob([text]);

    return { blob, index: await buildCsvRowIndexAsync(blob) };
}

describe('findMatchingRowsAsync', () => {
    it('returns the row numbers whose record matches, skipping the header', async () => {
        const { blob, index } = await openAsync(ORDERS);
        const matches = await findMatchingRowsAsync({
            blob,
            index,
            delimiter: ',',
            firstRecord: 1,
            batchRecords: 2,
            predicate: (record) => record.some((field) => field.toLowerCase().includes('athens')),
        });

        expect(Array.from(matches)).toEqual([0, 2]);
    });

    it('reports partial matches per batch and stops when cancelled', async () => {
        const { blob, index } = await openAsync(ORDERS);
        const partial: number[] = [];
        const controller = new AbortController();

        await expect(findMatchingRowsAsync({
            blob,
            index,
            delimiter: ',',
            firstRecord: 1,
            batchRecords: 1,
            signal: controller.signal,
            predicate: () => true,
            onMatches: (matches) => {
                partial.push(matches.length);
                controller.abort();
            },
        })).rejects.toMatchObject({ name: 'AbortError' });

        expect(partial).toEqual([1]);
    });
});

describe('sort keys', () => {
    it('types numbers, dates and text', () => {
        expect(typeSortKey(['3', '', '1.5']).kind).toBe('number');
        expect(typeSortKey(['2024-01-02', '2023-05-06']).kind).toBe('number');
        expect(typeSortKey(['b', '2']).kind).toBe('text');
    });

    it('builds a permutation with empty cells last', async () => {
        const { blob, index } = await openAsync(ORDERS);
        const [total, date] = await buildSortKeysAsync({ blob, index, delimiter: ',', firstRecord: 1, columns: [3, 4] });
        const rows = Uint32Array.from([0, 1, 2, 3]);

        if (total == null || date == null) {
            throw new Error('Sort keys missing.');
        }

        expect(Array.from(sortRowPermutation(rows, [total], ['asc']))).toEqual([1, 0, 3, 2]);
        expect(Array.from(sortRowPermutation(rows, [total], ['desc']))).toEqual([3, 0, 1, 2]);
        expect(Array.from(sortRowPermutation(rows, [date], ['asc']))).toEqual([3, 1, 2, 0]);
    });

    it('sorts text and breaks ties with the next key', () => {
        const city = typeSortKey(['Athens', 'Patras', 'Athens']);
        const id = typeSortKey(['3', '1', '2']);

        expect(Array.from(sortRowPermutation(Uint32Array.from([0, 1, 2]), [city, id], ['asc', 'desc']))).toEqual([0, 2, 1]);
    });

    it('estimates memory per key', () => {
        expect(estimateSortKeyBytes({ byteLength: 1000, rowCount: 10, columnCount: 10, keyCount: 2 })).toBe(2 * (480 + 200));
    });
});

describe('a large synthetic file', () => {
    const ROW_COUNT = 50000;
    const text = ['id,name,note', ...Array.from({ length: ROW_COUNT }, (_, row) => `${row},name-${row},"note, ${row}"`)].join('\n');

    it('indexes every row without parsing any of them', async () => {
        const blob = new Blob([text]);
        const index = await buildCsvRowIndexAsync(blob);

        expect(index.count).toBe(ROW_COUNT + 1);
        expect(index.memoryBytes).toBeLessThan(1024 * 1024);
    });

    it('parses only the blocks a range needs', async () => {
        const blob = new Blob([text]);
        const index = await buildCsvRowIndexAsync(blob);
        const reader = new CsvRangeReader({ blob, index, delimiter: ',', blockSize: 2000, maxBlocks: 4 });

        const records = await reader.readRecordsAsync(30001, 30051);

        expect(records).toHaveLength(50);
        expect(records[0]).toEqual(['30000', 'name-30000', 'note, 30000']);
        expect(reader.reads).toBe(1);
        expect(reader.cachedBlockCount).toBe(1);
    });

    it('scans in batches and visits each row once', async () => {
        const blob = new Blob([text]);
        const index = await buildCsvRowIndexAsync(blob);
        let visited = 0;
        let batches = 0;

        await scanCsvRecordsAsync({
            blob,
            index,
            delimiter: ',',
            firstRecord: 1,
            batchRecords: 10000,
            onProgress: () => {
                batches += 1;
            },
        }, () => {
            visited += 1;
        });

        expect(visited).toBe(ROW_COUNT);
        expect(batches).toBe(5);
    });
});
