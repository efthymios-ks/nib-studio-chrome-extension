// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LargeCsvSource } from './largeCsvSource.js';
import type { TableLargeQuery } from './tableView.js';

const TEXT = [
    'order_id,customer,city,total',
    '1,Anna,Athens,12.5',
    '2,Bob,"Thessaloniki, GR",7',
    '3,Carol,Athens,',
    '4,Dave,Patras,100',
].join('\n');

const EMPTY_QUERY: TableLargeQuery = { filters: [], search: '', searchColumns: [0, 1, 2, 3], sorts: [] };

async function openAsync(): Promise<LargeCsvSource> {
    const source = await LargeCsvSource.openAsync(new Blob([TEXT]), 'orders.csv');
    await source.whenIndexedAsync();

    return source;
}

function queryOptions(): { signal: AbortSignal; onProgress: () => void } {
    return { signal: new AbortController().signal, onProgress: () => undefined };
}

describe('LargeCsvSource', () => {
    it('reads the header and rows on demand', async () => {
        const source = await openAsync();

        expect(source.columns).toEqual(['order_id', 'customer', 'city', 'total']);
        expect(source.getRowCount()).toBe(4);
        expect(await source.readRowsAsync([3, 1])).toEqual([['4', 'Dave', 'Patras', '100'], ['2', 'Bob', 'Thessaloniki, GR', '7']]);
    });

    it('searches, filters and sorts by streaming over the file', async () => {
        const source = await openAsync();
        const search = await source.queryAsync({ ...EMPTY_QUERY, search: 'athens' }, queryOptions());
        const filtered = await source.queryAsync({
            ...EMPTY_QUERY,
            filters: [{ columnIndex: 3, filter: { columnId: 'col-3', operator: 'gt', value: '10' } }],
        }, queryOptions());
        const sorted = await source.queryAsync({ ...EMPTY_QUERY, sorts: [{ columnIndex: 3, direction: 'desc' }] }, queryOptions());

        expect(Array.from(search.rows ?? [])).toEqual([0, 2]);
        expect(Array.from(filtered.rows ?? [])).toEqual([0, 3]);
        expect(Array.from(sorted.rows ?? [])).toEqual([3, 0, 1, 2]);
        expect((await source.queryAsync(EMPTY_QUERY, queryOptions())).rows).toBeNull();
    });
});
