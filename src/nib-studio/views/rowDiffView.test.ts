import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderDiffDocumentHtmlAsync } from '../../common/diff/diffHtml.js';
import { buildTinyWorkbook } from '../../common/office/testing/encryptionFixtures.js';
import { SALES_SHEETS, buildSheetsWorkbook, type SheetFixture } from '../../common/office/testing/workbookFixtures.js';
import type { DiffSide } from '../app/store.js';
import { createRowDiffViewState, type DiffViewCallbacks, type RowDiffViewState } from './diffViewState.js';
import { renderRowDiffView, rowDiffDocumentForAsync } from './rowDiffView.js';
import { pruneTableMemories, revealSheet } from './tableViewer.js';
import { flushAsync, settleAsync } from '../testing/testHelpers.js';

const callbacks: DiffViewCallbacks = {
    onSetSide: () => {},
    onSwap: () => {},
};

describe('renderRowDiffView', () => {
    let container: HTMLElement;
    let state: RowDiffViewState;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        state = createRowDiffViewState();
    });

    afterEach(() => {
        container.remove();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    function side(path: string, text: string): DiffSide {
        return { label: path, path, source: 'file', text };
    }

    it('renders an aligned table with side headers, placeholders and highlighted cells', async () => {
        renderRowDiffView(container, {
            original: side('a.csv', 'id,name,price\n1,pen,2\n2,ink,3\n3,cap,1\n'),
            modified: side('b.csv', 'id,price,colour\n2,4,red\n1,2,blue\n4,9,green\n'),
            state,
            callbacks,
        });
        await flushAsync();

        expect(container.querySelector('.aligned-table-sides [data-side="original"] .diff-side-badge')?.textContent).toBe('Original');
        expect(container.querySelector('.aligned-table-sides [data-side="modified"] .diff-side-name')?.textContent).toBe('b.csv');
        const rows = Array.from(container.querySelectorAll<HTMLElement>('.aligned-table tbody tr'));
        expect(rows.map((row) => row.dataset['diffKey'])).toEqual(['1', '2', '3', '4']);
        expect(rows[2]?.querySelectorAll('td[data-side="modified"][data-placeholder="true"]').length).toBe(5);
        expect(rows[1]?.querySelector('td[data-changed="true"]')?.getAttribute('title')).toBe('Original: 3\nModified: 4');
        // Each side's last cell closes a ring around the row.
        const ends = Array.from(rows[2]!.querySelectorAll<HTMLElement>('td[data-edge="end"]'), (cell) => cell.dataset['side']);
        expect(ends).toEqual(['original', 'modified']);
        expect(state.keyColumns).toEqual(['id']);
    });

    async function renderSampleAsync(): Promise<void> {
        renderRowDiffView(container, {
            original: side('a.csv', 'id,name,price\n1,pen,2\n2,ink,3\n3,cap,1\n'),
            modified: side('b.csv', 'id,price,colour\n2,4,red\n1,2,blue\n4,9,green\n'),
            state,
            callbacks,
        });
        await flushAsync();
    }

    function position(): string {
        return container.querySelector('.row-diff-table-panel .diff-bar-position')?.textContent ?? '';
    }

    it('gives the table the full width, and counts the changes in the bar with no totals in the toolbar', async () => {
        await renderSampleAsync();

        expect(container.querySelector('.row-diff-split')?.children).toHaveLength(1);
        expect(container.querySelector('.row-diff-rail, .diff-list, .diff-count-pills, .diff-count-pill')).toBeNull();
        expect(position()).toBe('– / 3');
    });

    it('steps from the top row down: both cells of a changed value, or the whole row', async () => {
        vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
        await renderSampleAsync();
        const next = (): void => container.querySelector<HTMLButtonElement>('.diff-bar [data-step="1"]')!.click();

        next();
        expect(state.navigation.current).toBe('row id=2 · price');
        const flashed = Array.from(container.querySelectorAll<HTMLElement>('td[data-flash="true"]'));
        expect(flashed.map((cell) => `${cell.dataset['side']}:${cell.dataset['column']}:${cell.textContent}`)).toEqual(['original:price:3', 'modified:price:4']);
        expect(container.querySelector('tr[data-active="true"]')?.getAttribute('data-diff-key')).toBe('2');

        next();
        expect(position()).toBe('2 / 3');
        expect(container.querySelector('tr[data-diff-key="3"]')?.getAttribute('data-flash')).toBe('true');
        expect(container.querySelector('tr[data-active="true"]')?.getAttribute('data-diff-key')).toBe('3');
        expect(state.activeDiffKey).toBe('3');
    });

    it('makes a change clicked in the table the current one', async () => {
        await renderSampleAsync();

        container.querySelector<HTMLElement>('tr[data-diff-key="4"] td[data-side="modified"][data-column="colour"]')!.click();

        expect(state.navigation.current).toBe('row id=4');
        expect(position()).toBe('3 / 3');
        expect(container.querySelector('tr[data-active="true"]')?.getAttribute('data-diff-key')).toBe('4');
    });


    it('reads one file at a time with Before and After, stepping only through what that file has', async () => {
        await renderSampleAsync();

        container.querySelector<HTMLButtonElement>('.diff-bar [data-view="before"]')!.click();
        expect(container.querySelector('.row-diff-table-panel')?.getAttribute('data-diff-view')).toBe('before');
        expect(position()).toBe('– / 2');

        container.querySelector<HTMLButtonElement>('.diff-bar [data-view="after"]')!.click();
        expect(position()).toBe('– / 2');
        expect(state.navigation.view).toBe('after');
    });

    it('keeps the parsed sides and the result when rendered again', async () => {
        const input = {
            original: side('a.csv', 'id,v\n1,a\n'),
            modified: side('b.csv', 'id,v\n1,b\n'),
            state,
            callbacks,
        };
        renderRowDiffView(container, input);
        await flushAsync();
        const document = state.cache?.document;

        renderRowDiffView(container, input);
        await flushAsync();

        expect(document?.kind).toBe('rows');
        expect(state.cache?.document).toBe(document);
    });

    it('reads both files and builds the diff document without drawing it, for an export', async () => {
        const document = await rowDiffDocumentForAsync({
            original: side('a.csv', 'id,name,price\n1,pen,2\n2,ink,3\n3,cap,1\n'),
            modified: side('b.csv', 'id,price,colour\n2,4,red\n1,2,blue\n4,9,green\n'),
            state,
        });

        expect(document?.changes.map((change) => change.id)).toEqual(['row id=2 · price', 'row id=3', 'row id=4']);
        expect(document?.options.keyColumns).toEqual(['id']);
        expect(state.cache?.document).toBe(document);
    });

    it('reads OpenDocument and macro-enabled workbooks from their File, like any other workbook', async () => {
        const workbook = (path: string, bookType: 'ods' | 'xlsm', rows: string[][]): DiffSide => {
            const file = new File([buildTinyWorkbook(rows, bookType).slice()], path);

            return { label: path, path, source: 'file', text: 'unread', file };
        };
        const document = await rowDiffDocumentForAsync({
            original: workbook('prices.ods', 'ods', [['id', 'price'], ['1', '2'], ['2', '3']]),
            modified: workbook('prices.xlsm', 'xlsm', [['id', 'price'], ['1', '2'], ['2', '4']]),
            state,
        });

        expect(document?.changes.map((change) => change.id)).toEqual(['row id=2 · price']);
    });

    it('has no diff document while a side is missing', async () => {
        expect(await rowDiffDocumentForAsync({ original: side('a.csv', 'id\n1\n'), modified: null, state })).toBeNull();
    });

    it('keeps the large-file message for CSVs over the limit', () => {
        const big = new File(['x'], 'big.csv');
        Object.defineProperty(big, 'size', { value: 3 * 1024 * 1024 });
        renderRowDiffView(container, {
            original: { label: 'big.csv', path: 'big.csv', source: 'file', text: '', file: big },
            modified: side('b.csv', 'id\n1\n'),
            state,
            callbacks,
        });

        expect(container.textContent).toContain('too large for row diff');
    });
});

describe('renderRowDiffView of workbooks with several sheets', () => {
    // The modified workbook: Q2 has a changed total and a new order, and the hidden sheet is gone.
    const MODIFIED_SHEETS: ReadonlyArray<SheetFixture> = [
        SALES_SHEETS[0] as SheetFixture,
        {
            name: 'Q2',
            rows: [['order_id', 'city', 'total'], ['Q2-1', 'Larissa', 310], ['Q2-2', 'Patras', 15], ['Q2-3', 'Volos', 60]],
        },
        SALES_SHEETS[2] as SheetFixture,
    ];
    let container: HTMLElement;
    let state: RowDiffViewState;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        state = createRowDiffViewState();
        pruneTableMemories([]);
    });

    afterEach(() => {
        container.remove();
    });

    function workbookSide(path: string, sheets: ReadonlyArray<SheetFixture>, bookType: 'xlsx' | 'biff8' = 'xlsx'): DiffSide {
        const file = new File([buildSheetsWorkbook(sheets, bookType).slice()], path);

        return { label: path, path, source: 'file', text: 'unread', file };
    }

    function picker(which: 'original' | 'modified'): HTMLSelectElement | null {
        return container.querySelector<HTMLSelectElement>(`.row-diff-sheet-select[data-side="${which}"]`);
    }

    function pick(which: 'original' | 'modified', name: string): void {
        const select = picker(which) as HTMLSelectElement;
        select.value = name;
        select.dispatchEvent(new Event('change'));
    }

    function diffKeys(): string[] {
        return [...container.querySelectorAll<HTMLElement>('.aligned-table tbody tr')].map((row) => row.dataset['diffKey'] ?? '');
    }

    async function renderAsync(original: DiffSide, modified: DiffSide): Promise<void> {
        renderRowDiffView(container, { original, modified, state, callbacks });
        await settleAsync();
    }

    it('offers a Sheet picker for each side, starting on the first sheet and the sheet of the same name', async () => {
        await renderAsync(workbookSide('data/sales.xlsx', SALES_SHEETS), workbookSide('data/sales-draft.xls', MODIFIED_SHEETS, 'biff8'));

        expect(picker('original')?.value).toBe('Q1');
        expect(picker('modified')?.value).toBe('Q1');
        expect([...(picker('original')?.options ?? [])].map((option) => option.textContent)).toEqual(['Q1', 'Q2', 'North Region', 'Rates (hidden)']);
        expect(picker('original')?.getAttribute('aria-label')).toBe('Original sheet');
        expect(container.querySelector('.row-diff-sheets')?.textContent).toContain('Modified sheet');
        expect(diffKeys()).toEqual(['Q1-1', 'Q1-2', 'Q1-3']);
    });

    it('moves the modified side to the sheet of the same name when the original\'s sheet is picked', async () => {
        await renderAsync(workbookSide('data/sales.xlsx', SALES_SHEETS), workbookSide('data/sales-draft.xlsx', MODIFIED_SHEETS));

        pick('original', 'Q2');
        await settleAsync();

        expect(picker('original')?.value).toBe('Q2');
        expect(picker('modified')?.value).toBe('Q2');
        expect(diffKeys()).toEqual(['Q2-1', 'Q2-2', 'Q2-3']);
        expect(state.cache?.document.changes.map((change) => change.id)).toEqual(['row order_id=Q2-1 · total', 'row order_id=Q2-3']);
    });

    it('compares different sheets when the modified side is picked on its own', async () => {
        await renderAsync(workbookSide('data/sales.xlsx', SALES_SHEETS), workbookSide('data/sales-draft.xlsx', MODIFIED_SHEETS));

        pick('original', 'Q2');
        await settleAsync();
        pick('modified', 'Q1');
        await settleAsync();

        expect([picker('original')?.value, picker('modified')?.value]).toEqual(['Q2', 'Q1']);
        expect(state.cache?.document.original.sheet).toBe('Q2');
        expect(state.cache?.document.modified.sheet).toBe('Q1');
    });

    it('suggests key columns again when the sheets picked lack the ones chosen', async () => {
        await renderAsync(workbookSide('data/sales.xlsx', SALES_SHEETS), workbookSide('data/sales-draft.xlsx', MODIFIED_SHEETS));
        state.keyColumns = ['order_id'];
        state.keysChosen = true;

        pick('original', 'North Region');
        await settleAsync();

        expect(picker('modified')?.value).toBe('North Region');
        expect(state.keysChosen).toBe(false);
        expect(state.keyColumns).toEqual(['customer']);
        expect(diffKeys()).toEqual(['Thessaly Ironworks', 'Olympus Foods']);
    });

    it('starts on the sheet the table tab of a side shows', async () => {
        revealSheet('data/sales.xlsx', 'North Region');

        await renderAsync(workbookSide('data/sales.xlsx', SALES_SHEETS), workbookSide('data/sales-draft.xlsx', MODIFIED_SHEETS));

        expect([picker('original')?.value, picker('modified')?.value]).toEqual(['North Region', 'North Region']);
    });

    it('shows no picker for a workbook of one sheet or a CSV file', async () => {
        await renderAsync(workbookSide('data/one.xlsx', [SALES_SHEETS[0] as SheetFixture]), {
            label: 'q1.csv',
            path: 'q1.csv',
            source: 'file',
            text: 'order_id,city,total\nQ1-1,Patras,120\n',
        });

        expect(container.querySelector('.row-diff-sheets')).toBeNull();
        expect(state.cache?.document.original.sheet).toBe('Q1');
        expect(state.cache?.document.modified.sheet).toBeUndefined();
    });

    it('records the sheets compared in the diff document, and the HTML export shows them', async () => {
        state.sheets = { original: 'q2' };
        const document = await rowDiffDocumentForAsync({
            original: workbookSide('data/sales.xlsx', SALES_SHEETS),
            modified: workbookSide('data/sales-draft.xlsx', MODIFIED_SHEETS),
            state,
        });

        expect([document?.original.sheet, document?.modified.sheet]).toEqual(['Q2', 'Q2']);
        expect(JSON.parse(JSON.stringify(document)).original).toEqual({ name: 'sales.xlsx', source: 'file', path: 'data/sales.xlsx', sheet: 'Q2' });

        const html = await renderDiffDocumentHtmlAsync(document!);

        expect(html).toContain('data/sales.xlsx · Sheet: Q2');
        expect(html).toContain('data/sales-draft.xlsx · Sheet: Q2');
    });

    it('reads each workbook once while its sheets change', async () => {
        const original = workbookSide('data/sales.xlsx', SALES_SHEETS);
        const read = vi.spyOn(original.file as File, 'arrayBuffer');
        await renderAsync(original, workbookSide('data/sales-draft.xlsx', MODIFIED_SHEETS));

        pick('original', 'Q2');
        await settleAsync();
        pick('original', 'North Region');
        await settleAsync();

        expect(read).toHaveBeenCalledTimes(1);
    });
});
