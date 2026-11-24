import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTinyWorkbook } from '../../common/office/testing/encryptionFixtures.js';
import type { DiffSide } from '../app/store.js';
import { createRowDiffViewState, type DiffViewCallbacks, type RowDiffViewState } from './diffViewState.js';
import { renderRowDiffView, rowDiffDocumentForAsync } from './rowDiffView.js';
import { flushAsync } from '../testing/testHelpers.js';

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

    async function renderSample(): Promise<void> {
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
        await renderSample();

        expect(container.querySelector('.row-diff-split')?.children).toHaveLength(1);
        expect(container.querySelector('.row-diff-rail, .diff-list, .diff-count-pills, .diff-count-pill')).toBeNull();
        expect(position()).toBe('– / 3');
    });

    it('steps from the top row down: both cells of a changed value, or the whole row', async () => {
        vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
        await renderSample();
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
        await renderSample();

        container.querySelector<HTMLElement>('tr[data-diff-key="4"] td[data-side="modified"][data-column="colour"]')!.click();

        expect(state.navigation.current).toBe('row id=4');
        expect(position()).toBe('3 / 3');
        expect(container.querySelector('tr[data-active="true"]')?.getAttribute('data-diff-key')).toBe('4');
    });


    it('reads one file at a time with Before and After, stepping only through what that file has', async () => {
        await renderSample();

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
