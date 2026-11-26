import { describe, expect, it } from 'vitest';
import { buildCsvRowIndexAsync, type CsvRowIndex } from './csvRowIndex.js';

const encoder = new TextEncoder();

function starts(index: CsvRowIndex): number[] {
    return Array.from({ length: index.count }, (_, record) => index.getStart(record));
}

describe('buildCsvRowIndexAsync', () => {
    it('records the byte offset of each record start', async () => {
        const index = await buildCsvRowIndexAsync(new Blob(['a,b\n1,2\n3,4\n']));

        expect(index.complete).toBe(true);
        expect(starts(index)).toEqual([0, 4, 8]);
        expect(index.getEnd(2)).toBe(12);
    });

    it('keeps quoted commas and line breaks inside one record', async () => {
        const text = 'id,note\n1,"gift, wrap please"\n2,"two\nlines"\n3,plain\n';
        const index = await buildCsvRowIndexAsync(new Blob([text]));

        expect(index.count).toBe(4);
        expect(index.getStart(2)).toBe(text.indexOf('2,"two'));
        expect(index.getStart(3)).toBe(text.indexOf('3,plain'));
    });

    it('handles CRLF, doubled quotes and blank lines', async () => {
        const text = 'a,b\r\n\r\n"x ""q""",1\r\n2,3';
        const index = await buildCsvRowIndexAsync(new Blob([text]));

        expect(starts(index)).toEqual([0, 7, text.indexOf('2,3')]);
        expect(index.getEnd(2)).toBe(text.length);
    });

    it('measures offsets in bytes for multi-byte text and skips a BOM', async () => {
        const bytes = encoder.encode('\uFEFFname\nÄnna\nBob\n');
        const index = await buildCsvRowIndexAsync(new Blob([bytes]));

        expect(starts(index)).toEqual([3, 8, 14]);
    });

    it('splits correctly when a record spans stream chunks', async () => {
        const parts = ['a,"long', ' value\n', 'still quoted"\nb,2\n'];
        const index = await buildCsvRowIndexAsync(new Blob(parts));

        expect(index.count).toBe(2);
        expect(index.getStart(1)).toBe(parts.join('').indexOf('b,2'));
    });

    it('reports progress and can be cancelled', async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(buildCsvRowIndexAsync(new Blob(['a\n']), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });

        const seen: number[] = [];
        await buildCsvRowIndexAsync(new Blob(['a\nb\n']), { onProgress: (progress) => seen.push(progress.records) });
        expect(seen.at(-1)).toBe(2);
    });
});
