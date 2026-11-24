import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderTableView, type TableColumn } from './tableView.js';

describe('renderTableView', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
    });

    afterEach(() => {
        container.remove();
    });

    const columns: ReadonlyArray<TableColumn> = [
        { id: 'name', title: 'Name' },
        { id: 'age', title: 'Age' },
    ];

    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
        ['Alice', 30],
        ['Bob', 25],
        ['Carol', 40],
    ];

    it('renders a header and rows with dummy data', () => {
        renderTableView(container, {
            columns,
            getAllRows: () => rows,
        });

        const headerLabels = container.querySelectorAll('th.table-header-cell .table-header-label');
        expect(Array.from(headerLabels).map((cell) => cell.textContent?.trim())).toEqual(['Name', 'Age']);

        const dataRows = container.querySelectorAll('tbody tr');
        expect(dataRows.length).toBe(3);
    });

    it('shows a row-count badge in the status bar', () => {
        renderTableView(container, {
            columns,
            getAllRows: () => rows,
            totalRowCount: 999,
        });

        const badge = container.querySelector('.table-row-badge');
        expect(badge?.textContent).toContain('999');
    });

    it('counts the in-memory rows when no total is given', () => {
        renderTableView(container, {
            columns,
            getAllRows: () => rows,
        });

        expect(container.querySelector('.table-row-badge')?.textContent).toBe('3 of 3 rows');
    });

    it('exposes handle state for the caller to persist', () => {
        const handle = renderTableView(container, {
            columns,
            getAllRows: () => [],
        });

        expect(handle.getColumnOrder()).toEqual(['name', 'age']);
        expect(handle.getHiddenColumns()).toEqual([]);
        expect(handle.getFilters()).toEqual([]);
        expect(handle.getSort()).toEqual([]);
    });

    describe('with every row in memory', () => {
        const manyRows: ReadonlyArray<ReadonlyArray<unknown>> = Array.from({ length: 500 }, (_, index) => [`person-${index}`, index]);

        it('searches past the rendered page', () => {
            renderTableView(container, {
                columns,
                getAllRows: () => manyRows,
            });

            expect(container.querySelectorAll('tbody tr').length).toBe(200);

            const search = container.querySelector<HTMLInputElement>('.table-search');

            if (search == null) {
                throw new Error('Search input missing.');
            }

            search.value = 'person-450';
            search.dispatchEvent(new Event('input'));

            expect(container.querySelectorAll('tbody tr').length).toBe(200);

            search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

            const rendered = container.querySelectorAll('tbody tr');
            expect(rendered.length).toBe(1);
            expect(rendered[0]?.textContent).toContain('person-450');
        });
    });
});
