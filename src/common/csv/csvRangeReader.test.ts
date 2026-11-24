import { describe, expect, it } from 'vitest';
import { CsvRangeReader, parseCsvRecords, readCsvRecordsAsync } from './csvRangeReader.js';
import { buildCsvRowIndexAsync } from './csvRowIndex.js';

describe('parseCsvRecords', () => {
    it('parses quoted delimiters, doubled quotes and line breaks', () => {
        expect(parseCsvRecords('1,"gift, wrap please",x\r\n2,"say ""hi""","a\nb"\n', ',')).toEqual([
            ['1', 'gift, wrap please', 'x'],
            ['2', 'say "hi"', 'a\nb'],
        ]);
    });

    it('keeps empty fields and skips blank lines', () => {
        expect(parseCsvRecords('a,,c\n\n,\n', ',')).toEqual([['a', '', 'c'], ['', '']]);
    });

    it('splits on tabs for TSV', () => {
        expect(parseCsvRecords('a\tb\n1\t2', '\t')).toEqual([['a', 'b'], ['1', '2']]);
    });
});

describe('readCsvRecordsAsync', () => {
    it('returns exactly the requested records', async () => {
        const text = 'id,note\n1,"one, two"\n2,"multi\nline"\n3,three\n4,four\n';
        const blob = new Blob([text]);
        const index = await buildCsvRowIndexAsync(blob);
        const options = { blob, index, delimiter: ',' };

        expect(await readCsvRecordsAsync(options, 2, 4)).toEqual([['2', 'multi\nline'], ['3', 'three']]);
        expect(await readCsvRecordsAsync(options, 4, 99)).toEqual([['4', 'four']]);
        expect(await readCsvRecordsAsync(options, 9, 12)).toEqual([]);
    });
});

describe('CsvRangeReader', () => {
    const text = ['n', ...Array.from({ length: 100 }, (_, row) => String(row))].join('\n');

    it('reads across blocks and serves repeats from the cache', async () => {
        const blob = new Blob([text]);
        const index = await buildCsvRowIndexAsync(blob);
        const reader = new CsvRangeReader({ blob, index, delimiter: ',', blockSize: 10, maxBlocks: 3 });

        const records = await reader.readRecordsAsync(8, 23);
        expect(records.map((record) => record[0])).toEqual(Array.from({ length: 15 }, (_, offset) => String(offset + 7)));
        expect(reader.reads).toBe(3);

        await reader.readRecordsAsync(10, 20);
        expect(reader.reads).toBe(3);
        expect(reader.getCachedRecord(15)).toEqual(['14']);
    });

    it('evicts the least recently used block', async () => {
        const blob = new Blob([text]);
        const index = await buildCsvRowIndexAsync(blob);
        const reader = new CsvRangeReader({ blob, index, delimiter: ',', blockSize: 10, maxBlocks: 2 });

        await reader.readBlockAsync(0);
        await reader.readBlockAsync(1);
        await reader.readBlockAsync(2);

        expect(reader.cachedBlockCount).toBe(2);
        expect(reader.getCachedRecord(1)).toBeUndefined();
        expect(reader.getCachedRecord(25)).toEqual(['24']);
    });
});
