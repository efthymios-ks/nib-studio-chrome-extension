import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderTableView, type TableColumn, type TableLargeQuery, type TableLargeSource } from './tableView.js';
import { computeVirtualWindow } from './virtualWindow.js';
import { settleAsync } from '../testing/testHelpers.js';

const ROW_COUNT = 100000;

const columns: ReadonlyArray<TableColumn> = [
    { id: 'id', title: 'Id' },
    { id: 'name', title: 'Name' },
    { id: 'city', title: 'City' },
];

function rowFor(row: number): ReadonlyArray<unknown> {
    return [String(row), `name-${row}`, row % 2 === 0 ? 'Athens' : 'Patras'];
}

interface FakeSource extends TableLargeSource {
    readonly reads: number[];
    readonly queries: TableLargeQuery[];
}

function createFakeSource(): FakeSource {
    const cache = new Map<number, ReadonlyArray<unknown>>();
    const reads: number[] = [];
    const queries: TableLargeQuery[] = [];

    return {
        reads,
        queries,
        getRowCount: () => ROW_COUNT,
        isIndexing: () => false,
        getIndexProgress: () => 1,
        subscribe: () => () => undefined,
        getCachedRow: (row) => cache.get(row),
        readRowsAsync: async (rows) => {
            reads.push(rows.length);

            return Array.from(rows, (row) => {
                const cells = rowFor(row);
                cache.set(row, cells);

                return cells;
            });
        },
        queryAsync: async (query) => {
            queries.push(query);

            if (query.search.trim() === '') {
                return { rows: null };
            }

            return { rows: Uint32Array.from([4, 8, 15]) };
        },
    };
}

// A source like the CSV one: its cache keeps the rows of the last `cacheSize` reads only, as blocks fall out of an LRU,
// and a sort puts first rows tied on the key that lie far apart in the file, each in a block of its own.
function createTiedSortSource(cacheSize: number): FakeSource {
    const cache = new Map<number, ReadonlyArray<unknown>>();
    const reads: number[] = [];
    const queries: TableLargeQuery[] = [];
    const sorted = Uint32Array.from({ length: ROW_COUNT }, (_, position) => (position * 5233) % ROW_COUNT);

    return {
        reads,
        queries,
        getRowCount: () => ROW_COUNT,
        isIndexing: () => false,
        getIndexProgress: () => 1,
        subscribe: () => () => undefined,
        getCachedRow: (row) => cache.get(row),
        readRowsAsync: async (rows) => {
            reads.push(rows.length);
            await Promise.resolve();

            return Array.from(rows, (row) => {
                const cells = rowFor(row);
                cache.set(row, cells);

                while (cache.size > cacheSize) {
                    cache.delete(cache.keys().next().value as number);
                }

                return cells;
            });
        },
        queryAsync: async (query) => {
            queries.push(query);

            return { rows: query.sorts.length > 0 ? sorted : null };
        },
    };
}

describe('computeVirtualWindow', () => {
    it('renders only the rows in view plus overscan', () => {
        const range = computeVirtualWindow({ scrollTop: 2800, viewportHeight: 280, rowHeight: 28, rowCount: 1000, overscan: 5, maxScrollHeight: 1e9 });

        expect(range).toMatchObject({ start: 95, end: 115, topPadding: 95 * 28 });
        expect(range.topPadding + (range.end - range.start) * 28 + range.bottomPadding).toBe(28000);
    });

    it('scales the scroll range for lists taller than the browser allows', () => {
        const range = computeVirtualWindow({ scrollTop: 1000 - 280, viewportHeight: 280, rowHeight: 28, rowCount: 1000, overscan: 0, maxScrollHeight: 1000 });

        expect(range.end).toBe(1000);
        expect(range.totalHeight).toBe(1000);
    });
});

describe('renderTableView with a large source', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
    });

    afterEach(() => {
        container.remove();

        for (const popover of document.querySelectorAll('.table-popover')) {
            popover.remove();
        }
    });

    it('draws a window of rows over spacers for the rest', async () => {
        const source = createFakeSource();
        renderTableView(container, { columns, largeSource: source });
        await settleAsync();

        const drawn = container.querySelectorAll('tbody tr:not(.table-spacer)');
        expect(drawn.length).toBeGreaterThan(10);
        expect(drawn.length).toBeLessThan(60);
        expect(source.reads.reduce((sum, count) => sum + count, 0)).toBe(drawn.length);
        expect(container.querySelector('tbody tr:not(.table-spacer) .table-rownum')?.textContent).toBe('1');
        expect(container.querySelector('.table-row-badge')?.textContent).toBe('100,000 of 100,000 rows');
    });

    it('fills every row of a sorted window whose tied rows lie further apart than the cache holds, and keeps them filled', async () => {
        const source = createTiedSortSource(8);
        renderTableView(container, { columns, largeSource: source });
        await settleAsync();
        const pendingRows = (): number => container.querySelectorAll('.table-pending-row').length;

        container.querySelector<HTMLElement>('th[data-column-id="city"]')!.click();
        await settleAsync();

        expect(pendingRows()).toBe(0);
        expect(container.querySelector('tbody tr:not(.table-spacer):not(.table-pending-row) .table-rownum')?.textContent).toBe('1');

        const body = container.querySelector<HTMLElement>('.table-body')!;
        body.scrollTop = 28 * 3;
        body.dispatchEvent(new Event('scroll'));
        await settleAsync();
        const readsAfterScroll = source.reads.length;
        body.dispatchEvent(new Event('scroll'));
        await settleAsync();

        expect(pendingRows()).toBe(0);
        expect(source.reads.length).toBe(readsAfterScroll);
    });

    it('renders search results through the matching row numbers', async () => {
        const source = createFakeSource();
        renderTableView(container, { columns, largeSource: source });
        const search = container.querySelector<HTMLInputElement>('.table-search');

        if (search == null) {
            throw new Error('Search input missing.');
        }

        search.value = 'needle';
        search.dispatchEvent(new Event('input'));
        await settleAsync();

        expect(source.queries.some((query) => query.search === 'needle')).toBe(false);

        search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        await settleAsync();

        const numbers = Array.from(container.querySelectorAll('tbody tr:not(.table-spacer) .table-rownum'), (cell) => cell.textContent);
        expect(numbers).toEqual(['5', '9', '16']);
        expect(source.queries.at(-1)?.searchColumns).toEqual([0, 1, 2]);
    });

    it('jumps to a row number', async () => {
        const source = createFakeSource();
        renderTableView(container, { columns, largeSource: source });
        await settleAsync();
        const goTo = container.querySelector<HTMLInputElement>('.table-goto');

        if (goTo == null) {
            throw new Error('Go to row input missing.');
        }

        goTo.value = '50000';
        goTo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        await settleAsync();

        expect(container.querySelector('tr[data-highlight] .table-rownum')?.textContent).toBe('50000');
    });
});

describe('column chooser Reset', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
    });

    afterEach(() => {
        container.remove();

        for (const popover of document.querySelectorAll('.table-popover')) {
            popover.remove();
        }
    });

    function openChooser(): HTMLElement {
        const button = Array.from(container.querySelectorAll<HTMLButtonElement>('.table-toolbar .button')).find((item) => item.textContent === 'Columns');
        button?.click();
        const chooser = document.querySelector<HTMLElement>('.table-column-chooser');

        if (chooser == null) {
            throw new Error('Column chooser missing.');
        }

        return chooser;
    }

    function headerTitles(): Array<string | undefined> {
        return Array.from(container.querySelectorAll('.table-header-label'), (label) => label.textContent?.trim());
    }

    const cases: Array<{ name: string; render: () => void }> = [
        {
            name: 'an in-memory table',
            render: () => {
                const rows = [rowFor(0), rowFor(1)];
                renderTableView(container, { columns, getAllRows: () => rows });
            },
        },
        {
            name: 'a large table',
            render: () => {
                renderTableView(container, { columns, largeSource: createFakeSource() });
            },
        },
    ];

    for (const testCase of cases) {
        it(`restores every column, unpinned, in the original order for ${testCase.name}`, () => {
            testCase.render();
            const chooser = openChooser();
            const firstRow = chooser.querySelector<HTMLElement>('.table-chooser-row[data-column-id="id"]');
            const [visibility, pin] = Array.from(firstRow?.querySelectorAll<HTMLInputElement>('input') ?? []);
            const cityPin = chooser.querySelectorAll<HTMLInputElement>('.table-chooser-row[data-column-id="city"] input')[1];

            if (visibility == null || pin == null || cityPin == null) {
                throw new Error('Chooser checkboxes missing.');
            }

            visibility.checked = false;
            visibility.dispatchEvent(new Event('change'));
            cityPin.checked = true;
            cityPin.dispatchEvent(new Event('change'));
            expect(headerTitles()).toEqual(['City', 'Name']);

            const reset = chooser.querySelector<HTMLButtonElement>('.table-chooser-reset');
            expect(reset?.title).toBe('Show all columns, unpin all, restore the original order');
            reset?.click();

            expect(chooser.isConnected).toBe(true);
            expect(headerTitles()).toEqual(['Id', 'Name', 'City']);
            const boxes = Array.from(chooser.querySelectorAll<HTMLInputElement>('.table-chooser-row input'));
            expect(boxes.map((box) => box.checked)).toEqual([true, false, true, false, true, false]);
            expect(container.querySelector('.table-header-cell[data-pinned]')).toBeNull();
        });
    }
});
