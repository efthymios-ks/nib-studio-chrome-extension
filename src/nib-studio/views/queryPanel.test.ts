import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createArrayTableSource, type LinqTableSource } from '../../common/linq/linqSources.js';
import { renderTableWorkspace, type QueryTableData } from './queryPanel.js';
import { renderTableView, type TableColumn } from './tableView.js';
import { blurEditor, settleAsync } from '../testing/testHelpers.js';

const COLUMNS = ['order_id', 'city', 'total', 'status'];
const ROWS = Array.from({ length: 250 }, (_, index) => [
    `ORD-${index + 1}`,
    ['Patras', 'Athens', 'Volos'][index % 3] as string,
    String(index + 1),
    index % 2 === 0 ? 'delivered' : 'pending',
]);

function data(overrides: Partial<QueryTableData> = {}): QueryTableData {
    const columns: TableColumn[] = COLUMNS.map((title, index) => ({ id: `c${index}`, title }));

    return {
        key: `test-${Math.random()}`,
        columns: COLUMNS,
        loadSourceAsync: async () => createArrayTableSource(COLUMNS, ROWS),
        loadSampleRowsAsync: async () => ROWS.slice(0, 20),
        renderTable: (host, toolbarExtras) => renderTableView(host, {
            columns,
            getAllRows: () => ROWS,
            toolbarExtras,
        }),
        ...overrides,
    };
}

function editorView(container: HTMLElement): EditorView {
    const content = container.querySelector<HTMLElement>('.query-editor .cm-editor');

    if (content == null) {
        throw new Error('No query editor.');
    }

    const view = EditorView.findFromDOM(content);

    if (view == null) {
        throw new Error('No editor view.');
    }

    return view;
}

function typeQuery(container: HTMLElement, text: string): void {
    const view = editorView(container);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
    const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent === label);

    if (found == null) {
        throw new Error(`No button ${label}.`);
    }

    return found;
}

// Clicks the Query button of the table on screen, if there is one.
function toggleQueryPanel(): boolean {
    const toggle = document.querySelector<HTMLButtonElement>('.table-workspace [data-query-toggle]');

    toggle?.click();

    return toggle != null;
}

function panel(container: HTMLElement): HTMLElement {
    return container.querySelector<HTMLElement>('.query-panel') as HTMLElement;
}

function indicator(container: HTMLElement): HTMLElement {
    return container.querySelector<HTMLElement>('.query-applied') as HTMLElement;
}

function mainHeaders(container: HTMLElement): string[] {
    return [...container.querySelectorAll('.table-workspace-main th .table-header-label')].map((cell) => cell.textContent ?? '');
}

describe('renderTableWorkspace', () => {
    let container: HTMLElement;

    beforeEach(() => {
        localStorage.clear();
        container = document.createElement('div');
        document.body.append(container);
    });

    afterEach(() => {
        container.remove();
    });

    it('puts a Query button in the table toolbar that opens and closes the panel', () => {
        renderTableWorkspace(container, data());
        const workspace = container.querySelector<HTMLElement>('.table-workspace');
        const toggle = container.querySelector<HTMLButtonElement>('.table-toolbar [data-query-toggle]');
        const panel = container.querySelector<HTMLElement>('.query-panel');

        expect(toggle?.textContent).toBe('Query');
        expect(panel?.hidden).toBe(true);

        toggle?.click();
        expect(workspace?.dataset['queryOpen']).toBe('true');
        expect(panel?.hidden).toBe(false);
        expect(toggle?.dataset['active']).toBe('true');
        expect(container.querySelector('.query-editor .cm-editor')).not.toBeNull();

        toggle?.click();
        expect(panel?.hidden).toBe(true);
    });

    it('remembers whether the panel is open', () => {
        renderTableWorkspace(container, data());
        toggleQueryPanel();

        expect(container.querySelector<HTMLElement>('.query-panel')?.hidden).toBe(false);
        expect(JSON.parse(localStorage.getItem('nib-studio/query-panel') ?? '{}').open).toBe(true);

        container.replaceChildren();
        renderTableWorkspace(container, data());
        expect(container.querySelector<HTMLElement>('.query-panel')?.hidden).toBe(false);
        expect(toggleQueryPanel()).toBe(true);
        expect(container.querySelector<HTMLElement>('.query-panel')?.hidden).toBe(true);
    });

    it('shows the query result in the main table with an indicator', async () => {
        renderTableWorkspace(container, data());
        toggleQueryPanel();
        expect(mainHeaders(container)).toEqual(COLUMNS);
        expect(indicator(container).hidden).toBe(true);

        typeQuery(container, 'from row in table where row.total > 10 orderby row.total descending select row.order_id, row.total');
        button(panel(container), 'Run').click();
        await settleAsync();

        const status = container.querySelector('.query-status')?.textContent ?? '';
        expect(status).toMatch(/^240 rows · \d+ ms · 250 rows read$/);
        expect(indicator(container).hidden).toBe(false);
        expect(indicator(container).textContent).toBe('Query applied·240 rows·Clear');
        expect(mainHeaders(container)).toEqual(['order_id', 'total']);
        expect(container.querySelector('.table-workspace-main tbody td.table-cell')?.textContent).toBe('ORD-250');
        expect(container.querySelector('.table-workspace-main .table-toolbar [data-query-toggle]')).not.toBeNull();
        expect(container.querySelector('.query-pager')).toBeNull();
        expect(container.querySelector('.query-panel .table-view, .query-panel table')).toBeNull();
    });

    it('restores the full table from the indicator Clear and keeps the query text', async () => {
        renderTableWorkspace(container, data());
        toggleQueryPanel();
        typeQuery(container, 'from * where status like "deliv*" select order_id, status');
        button(panel(container), 'Run').click();
        await settleAsync();
        expect(indicator(container).textContent).toContain('125 rows');

        button(indicator(container), 'Clear').click();
        expect(indicator(container).hidden).toBe(true);
        expect(mainHeaders(container)).toEqual(COLUMNS);
        expect(editorView(container).state.doc.toString()).toBe('from * where status like "deliv*" select order_id, status');
    });

    it('restores the full table when the panel closes', async () => {
        renderTableWorkspace(container, data());
        toggleQueryPanel();
        typeQuery(container, 'from * take 3');
        button(panel(container), 'Run').click();
        await settleAsync();
        expect(indicator(container).textContent).toContain('3 rows');

        toggleQueryPanel();
        expect(indicator(container).hidden).toBe(true);
        expect(mainHeaders(container)).toEqual(COLUMNS);

        toggleQueryPanel();
        expect(indicator(container).hidden).toBe(true);
    });

    it('keeps the last result on screen when a later query fails', async () => {
        renderTableWorkspace(container, data());
        toggleQueryPanel();
        typeQuery(container, 'from * take 3');
        button(panel(container), 'Run').click();
        await settleAsync();
        typeQuery(container, 'from * where city.Contains("at")');
        button(panel(container), 'Run').click();
        await settleAsync();

        expect(container.querySelector('.query-error')?.textContent).toContain("Unknown function 'Contains'. Use like instead");
        expect(indicator(container).textContent).toContain('3 rows');
    });

    it('runs with Ctrl+Enter and shows a scalar result', async () => {
        renderTableWorkspace(container, data());
        toggleQueryPanel();
        typeQuery(container, 'from * select sum(total)');
        const content = container.querySelector<HTMLElement>('.query-editor .cm-content');
        content?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
        await settleAsync();

        expect(container.querySelector('.query-scalar-value')?.textContent).toBe('31375');
        expect(container.querySelector('.query-scalar-label')?.textContent).toBe('sum(total)');
        expect(container.querySelector('.table-workspace-main .query-scalar')).not.toBeNull();
        expect(indicator(container).textContent).toContain('1 value');
    });

    it('shows errors with their position and underlines the span', async () => {
        renderTableWorkspace(container, data());
        toggleQueryPanel();
        typeQuery(container, 'from * where totl > 1');
        button(container, 'Run').click();
        await settleAsync();

        const error = container.querySelector<HTMLElement>('.query-error');
        expect(error?.hidden).toBe(false);
        expect(error?.textContent).toBe("Line 1, column 14: Unknown column 'totl'. Did you mean 'total'?");
        expect(container.querySelector('.query-error-mark')?.textContent).toBe('totl');
    });

    it('cancels a running query', async () => {
        let release: () => void = () => undefined;
        const blocked = new Promise<void>((resolve) => {
            release = resolve;
        });
        const slow: LinqTableSource = {
            columns: COLUMNS,
            batches: async function* (signal) {
                yield { rows: ROWS.slice(0, 10), done: 10, total: 20 };
                await blocked;

                if (signal?.aborted === true) {
                    const error = new Error('cancelled');
                    error.name = 'AbortError';
                    throw error;
                }

                yield { rows: ROWS.slice(10, 20), done: 20, total: 20 };
            },
        };
        renderTableWorkspace(container, data({ loadSourceAsync: async () => slow }));
        toggleQueryPanel();
        typeQuery(container, 'from * select count()');
        button(container, 'Run').click();
        await settleAsync();

        const cancel = button(container, 'Cancel');
        expect(cancel.hidden).toBe(false);
        expect(button(container, 'Run').disabled).toBe(true);
        cancel.click();
        release();
        await settleAsync();

        expect(container.querySelector('.query-status')?.textContent).toBe('Cancelled.');
        expect(button(container, 'Cancel').hidden).toBe(true);
        expect(container.querySelector('.query-scalar')).toBeNull();
    });

    it('keeps a history of queries per file', async () => {
        const input = data();
        renderTableWorkspace(container, input);
        toggleQueryPanel();
        typeQuery(container, 'from * take 1');
        button(container, 'Run').click();
        await settleAsync();
        typeQuery(container, 'from * take 2');
        button(container, 'Run').click();
        await settleAsync();

        const history = container.querySelector<HTMLSelectElement>('.query-select') as HTMLSelectElement;
        history.dispatchEvent(new Event('focus'));
        expect([...history.options].map((option) => option.textContent)).toEqual(['History…', 'from * take 2', 'from * take 1']);
        blurEditor();
        history.value = '1';
        history.dispatchEvent(new Event('change'));
        expect(editorView(container).state.doc.toString()).toBe('from * take 1');
    });

    it('opens the syntax help with examples from the real columns', async () => {
        renderTableWorkspace(container, data());
        toggleQueryPanel();
        await settleAsync();
        const help = container.querySelector<HTMLButtonElement>('button[aria-label="Query syntax help"]');
        help?.click();

        const panel = container.querySelector<HTMLElement>('.query-help');
        expect(panel?.hidden).toBe(false);
        expect([...(panel?.querySelectorAll('h3') ?? [])].map((heading) => heading.textContent)).toEqual([
            'Examples for this table', 'Source', 'Clauses', 'Aggregates', 'Operators', 'Text', 'Dates', 'Functions',
        ]);
        expect(panel?.textContent).toContain('skip n take m');

        const firstExample = panel?.querySelector('.query-help-code')?.textContent ?? '';
        blurEditor();
        button(panel as HTMLElement, 'Insert').click();
        expect(editorView(container).state.doc.toString()).toBe(firstExample);
        expect(panel?.textContent).toContain('city');
    });

    it('offers examples only in the syntax help, with the History list as the one picker', async () => {
        renderTableWorkspace(container, data());
        toggleQueryPanel();
        await settleAsync();
        const pickers = [...container.querySelectorAll<HTMLSelectElement>('.query-select')];

        expect(pickers).toHaveLength(1);
        expect(pickers[0]?.title).toBe('Recent queries on this file');
        expect(container.textContent).not.toContain('Examples…');
    });

    it('keeps the query and the result across re-renders', async () => {
        const input = data();
        renderTableWorkspace(container, input);
        toggleQueryPanel();
        typeQuery(container, 'from * select count()');
        button(container, 'Run').click();
        await settleAsync();

        container.replaceChildren();
        renderTableWorkspace(container, input);
        expect(editorView(container).state.doc.toString()).toBe('from * select count()');
        expect(container.querySelector('.query-scalar-value')?.textContent).toBe('250');
    });

    it('clears the query and restores the full table', async () => {
        renderTableWorkspace(container, data());
        toggleQueryPanel();
        typeQuery(container, 'from * take 3 select city');
        button(panel(container), 'Run').click();
        await settleAsync();
        expect(mainHeaders(container)).toEqual(['city']);
        button(panel(container), 'Clear').click();

        expect(editorView(container).state.doc.toString()).toBe('');
        expect(indicator(container).hidden).toBe(true);
        expect(mainHeaders(container)).toEqual(COLUMNS);
    });
});
