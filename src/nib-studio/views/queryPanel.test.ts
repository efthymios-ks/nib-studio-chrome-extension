import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createArrayTableSource, type LinqTableSource } from '../../common/linq/linqSources.js';
import { renderTableWorkspace, type QueryTable, type QueryTableData, type SheetMemory } from './queryPanel.js';
import { renderTableView, type TableColumn, type TableViewMemory } from './tableView.js';
import { blurEditor, settleAsync } from '../testing/testHelpers.js';

const COLUMNS = ['order_id', 'city', 'total', 'status'];
const ROWS = Array.from({ length: 250 }, (_, index) => [
    `ORD-${index + 1}`,
    ['Patras', 'Athens', 'Volos'][index % 3] as string,
    String(index + 1),
    index % 2 === 0 ? 'delivered' : 'pending',
]);

// A CSV-like file of one table, with its parts replaced by the overrides.
function data(overrides: Partial<QueryTable> = {}): QueryTableData {
    const columns: TableColumn[] = COLUMNS.map((title, index) => ({ id: `c${index}`, title }));

    return {
        key: `test-${Math.random()}`,
        tables: [{
            name: null,
            columns: COLUMNS,
            loadSourceAsync: async () => createArrayTableSource(COLUMNS, ROWS),
            loadSampleRowsAsync: async () => ROWS.slice(0, 20),
            renderTable: (host, chrome) => renderTableView(host, {
                ...chrome,
                columns,
                getAllRows: () => ROWS,
            }),
            ...overrides,
        }],
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

interface SheetSpec {
    readonly name: string;
    readonly hidden?: boolean;
    readonly columns: ReadonlyArray<string>;
    readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
}

const SHEETS: ReadonlyArray<SheetSpec> = [
    { name: 'Q1', columns: ['order_id', 'city', 'total'], rows: [['Q1-1', 'Patras', '120'], ['Q1-2', 'Athens', '80'], ['Q1-3', 'Volos', '45']] },
    { name: 'Q2', columns: ['order_id', 'city', 'total'], rows: [['Q2-1', 'Larissa', '300'], ['Q2-2', 'Patras', '15']] },
    { name: 'North Region', columns: ['customer', 'city', 'revenue'], rows: [['Thessaly Ironworks', 'Larissa', '5400'], ['Olympus Foods', 'Katerini', '2100']] },
    { name: 'Rates', hidden: true, columns: ['product', 'vat'], rows: [['Paper', '24']] },
];

interface WorkbookFixture {
    readonly data: QueryTableData;
    readonly memory: SheetMemory;
    readonly labels: Array<string | null>;
    readonly tableMemories: Map<string, TableViewMemory>;
}

// A workbook's sheets as the table viewer hands them over, each with a table memory of its own.
function workbook(sheets: ReadonlyArray<SheetSpec> = SHEETS, memory: SheetMemory = {}): WorkbookFixture {
    const labels: Array<string | null> = [];
    const tableMemories = new Map<string, TableViewMemory>();
    const memoryOf = (name: string): TableViewMemory => {
        const existing = tableMemories.get(name) ?? {};
        tableMemories.set(name, existing);

        return existing;
    };
    const data: QueryTableData = {
        key: `book-${Math.random()}`,
        sheetMemory: memory,
        onSheetChange: (label) => labels.push(label),
        tables: sheets.map((sheet) => ({
            name: sheet.name,
            hidden: sheet.hidden === true,
            columns: sheet.columns,
            loadSourceAsync: async () => createArrayTableSource(sheet.columns, sheet.rows),
            loadSampleRowsAsync: async () => sheet.rows,
            renderTable: (host, chrome) => renderTableView(host, {
                ...chrome,
                columns: sheet.columns.map((title, index) => ({ id: `c${index}`, title })),
                getAllRows: () => sheet.rows,
                memory: memoryOf(sheet.name),
            }),
        })),
    };

    return { data, memory, labels, tableMemories };
}

function tabLabels(container: HTMLElement): string[] {
    return [...container.querySelectorAll<HTMLElement>('.sheet-tab')].filter((tab) => !tab.hidden).map((tab) => tab.textContent ?? '');
}

function activeTab(container: HTMLElement): string | null {
    return container.querySelector('.sheet-tab[aria-selected="true"]')?.textContent ?? null;
}

function clickTab(container: HTMLElement, name: string): void {
    const tab = [...container.querySelectorAll<HTMLElement>('.sheet-tab')].find((candidate) => candidate.textContent === name);

    if (tab == null) {
        throw new Error(`No tab ${name}.`);
    }

    tab.click();
}

function firstCells(container: HTMLElement): string[] {
    return [...container.querySelectorAll('.table-workspace-main tbody tr')].map((row) => row.querySelector('.table-cell')?.textContent ?? '');
}

function pressOn(target: Element, key: string, modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {}): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }));
}

function tableBody(container: HTMLElement): HTMLElement {
    return container.querySelector<HTMLElement>('.table-workspace-main .table-body') as HTMLElement;
}

function menuItem(label: string): HTMLElement {
    const item = [...document.querySelectorAll<HTMLElement>('.context-menu[data-open="true"] .context-menu-item')]
        .find((candidate) => candidate.textContent === label);

    if (item == null) {
        throw new Error(`No menu item ${label}.`);
    }

    return item;
}

describe('renderTableWorkspace with the sheets of a workbook', () => {
    let container: HTMLElement;

    beforeEach(() => {
        localStorage.clear();
        container = document.createElement('div');
        document.body.append(container);
    });

    afterEach(() => {
        container.remove();
    });

    it('shows a tab per visible sheet under the rows, in workbook order, with the first one active', () => {
        const book = workbook();
        renderTableWorkspace(container, book.data);
        const view = container.querySelector('.table-view') as HTMLElement;

        expect(tabLabels(container)).toEqual(['Q1', 'Q2', 'North Region']);
        expect(activeTab(container)).toBe('Q1');
        expect(container.querySelector('.sheet-tabs-list')?.getAttribute('role')).toBe('tablist');
        expect([...view.children].map((child) => child.className)).toEqual(['table-toolbar', 'table-body', 'sheet-tabs', 'table-status']);
        expect(mainHeaders(container)).toEqual(['order_id', 'city', 'total']);
        expect(book.labels).toEqual(['Sheet 1 of 3 · Q1']);
    });

    it('says how many sheets are hidden', () => {
        renderTableWorkspace(container, workbook().data);
        const hidden = container.querySelector<HTMLButtonElement>('.sheet-tabs-hidden') as HTMLButtonElement;

        expect(hidden.hidden).toBe(false);
        expect(hidden.textContent).toBe('⋯ 1 hidden');
        expect(hidden.title).toBe('1 hidden sheet: show one');
    });

    it('shows no tabs for a file of one table, or a workbook of one sheet', () => {
        const single = workbook([SHEETS[0] as SheetSpec]);
        renderTableWorkspace(container, data());

        expect(container.querySelector('.sheet-tabs')).toBeNull();

        renderTableWorkspace(container, single.data);

        expect(container.querySelector('.sheet-tabs')).toBeNull();
        expect(single.labels).toEqual([null]);
    });

    it('switches sheets with a click, and remembers the sheet for the next render', () => {
        const book = workbook();
        renderTableWorkspace(container, book.data);

        clickTab(container, 'North Region');

        expect(activeTab(container)).toBe('North Region');
        expect(mainHeaders(container)).toEqual(['customer', 'city', 'revenue']);
        expect(book.memory.activeSheet).toBe('North Region');
        expect(book.labels.at(-1)).toBe('Sheet 3 of 3 · North Region');

        container.replaceChildren();
        renderTableWorkspace(container, book.data);

        expect(activeTab(container)).toBe('North Region');
        expect(mainHeaders(container)).toEqual(['customer', 'city', 'revenue']);
    });

    it('moves to the next and previous sheet with Ctrl+PageDown and Ctrl+PageUp while the table has the focus', () => {
        renderTableWorkspace(container, workbook().data);
        tableBody(container).focus();

        pressOn(tableBody(container), 'PageDown', { ctrlKey: true });

        expect(activeTab(container)).toBe('Q2');
        expect(document.activeElement).toBe(tableBody(container));

        pressOn(tableBody(container), 'PageDown', { ctrlKey: true, shiftKey: true });
        expect(activeTab(container)).toBe('North Region');

        pressOn(tableBody(container), 'PageDown', { ctrlKey: true });
        expect(activeTab(container)).toBe('North Region');

        pressOn(tableBody(container), 'PageUp', { ctrlKey: true });
        expect(activeTab(container)).toBe('Q2');

        pressOn(tableBody(container), 'PageDown');
        expect(activeTab(container)).toBe('Q2');
    });

    it('moves between tabs with the arrow keys, Home and End', () => {
        renderTableWorkspace(container, workbook().data);
        const list = container.querySelector('.sheet-tabs-list') as HTMLElement;

        pressOn(list, 'ArrowRight');
        expect(activeTab(container)).toBe('Q2');
        expect(document.activeElement?.textContent).toBe('Q2');

        pressOn(list, 'End');
        expect(activeTab(container)).toBe('North Region');

        pressOn(list, 'ArrowRight');
        expect(activeTab(container)).toBe('Q1');

        pressOn(list, 'ArrowLeft');
        expect(activeTab(container)).toBe('North Region');

        pressOn(list, 'Home');
        expect(activeTab(container)).toBe('Q1');
    });

    it('keeps the sort of each sheet', () => {
        const book = workbook();
        renderTableWorkspace(container, book.data);
        const totalHeader = (): HTMLElement => container.querySelector('th[data-column-id="c2"]') as HTMLElement;

        totalHeader().click();
        expect(firstCells(container)).toEqual(['Q1-3', 'Q1-2', 'Q1-1']);

        clickTab(container, 'Q2');
        expect(firstCells(container)).toEqual(['Q2-1', 'Q2-2']);

        clickTab(container, 'Q1');
        expect(firstCells(container)).toEqual(['Q1-3', 'Q1-2', 'Q1-1']);
        expect(book.tableMemories.get('Q1')?.sorts).toHaveLength(1);
        expect(book.tableMemories.get('Q2')?.sorts ?? []).toHaveLength(0);
    });

    it('shows a hidden sheet from the hidden-sheets menu, and puts it away again', () => {
        const book = workbook();
        renderTableWorkspace(container, book.data);

        (container.querySelector('.sheet-tabs-hidden') as HTMLButtonElement).click();
        menuItem('Show Rates').click();

        expect(tabLabels(container)).toEqual(['Q1', 'Q2', 'North Region', 'Rates']);
        expect(activeTab(container)).toBe('Rates');
        expect(mainHeaders(container)).toEqual(['product', 'vat']);
        expect(book.memory.shownSheets).toEqual(['Rates']);
        expect(book.labels.at(-1)).toBe('Sheet 4 of 4 · Rates');
        expect(container.querySelector<HTMLElement>('.sheet-tab[data-hidden-sheet="true"]')?.title).toBe('Rates, a hidden sheet');

        (container.querySelector('.sheet-tabs-hidden') as HTMLButtonElement).click();
        menuItem('Hide Rates again').click();

        expect(tabLabels(container)).toEqual(['Q1', 'Q2', 'North Region']);
        expect(activeTab(container)).toBe('Q1');
    });

    it('rejects from * in a workbook of several sheets, naming them, and underlines the star', async () => {
        renderTableWorkspace(container, workbook().data);
        toggleQueryPanel();
        typeQuery(container, 'from * take 1');
        button(panel(container), 'Run').click();
        await settleAsync();

        expect(container.querySelector('.query-error')?.textContent)
            .toBe("Line 1, column 6: This workbook has 4 sheets; name one: Q1, Q2, 'North Region', Rates.");
        expect(container.querySelector('.query-error-mark')?.textContent).toBe('*');
        expect(indicator(container).hidden).toBe(true);
    });

    it('rejects a sheet the workbook does not have, listing the sheets', async () => {
        renderTableWorkspace(container, workbook().data);
        toggleQueryPanel();
        typeQuery(container, 'from South take 1');
        button(panel(container), 'Run').click();
        await settleAsync();

        expect(container.querySelector('.query-error')?.textContent)
            .toBe("Line 1, column 6: This workbook has no sheet named 'South'; name one: Q1, Q2, 'North Region', Rates.");
        expect(container.querySelector('.query-error-mark')?.textContent).toBe('South');
    });

    it('runs a query on the sheet it names and shows the result there, while other sheets show their rows', async () => {
        renderTableWorkspace(container, workbook().data);
        toggleQueryPanel();
        typeQuery(container, "from 'North Region' where revenue > 3000 select customer");
        button(panel(container), 'Run').click();
        await settleAsync();

        expect(activeTab(container)).toBe('North Region');
        expect(mainHeaders(container)).toEqual(['customer']);
        expect(firstCells(container)).toEqual(['Thessaly Ironworks']);
        expect(indicator(container).hidden).toBe(false);
        expect(container.querySelector('.table-view .sheet-tabs')).not.toBeNull();

        clickTab(container, 'Q1');
        expect(mainHeaders(container)).toEqual(['order_id', 'city', 'total']);
        expect(indicator(container).hidden).toBe(true);

        clickTab(container, 'North Region');
        expect(mainHeaders(container)).toEqual(['customer']);
        expect(indicator(container).hidden).toBe(false);
    });

    it('names sheets ignoring case, in brackets, and with from row in', async () => {
        renderTableWorkspace(container, workbook().data);
        toggleQueryPanel();

        typeQuery(container, 'from [north region] select city');
        button(panel(container), 'Run').click();
        await settleAsync();
        expect([activeTab(container), ...firstCells(container)]).toEqual(['North Region', 'Larissa', 'Katerini']);

        typeQuery(container, 'from row in q2 where row.total > 100 select row.order_id');
        button(panel(container), 'Run').click();
        await settleAsync();
        expect([activeTab(container), ...firstCells(container)]).toEqual(['Q2', 'Q2-1']);
    });

    it('clears only the result of the sheet on screen', async () => {
        renderTableWorkspace(container, workbook().data);
        toggleQueryPanel();
        typeQuery(container, 'from Q1 select city');
        button(panel(container), 'Run').click();
        await settleAsync();
        typeQuery(container, 'from Q2 select total');
        button(panel(container), 'Run').click();
        await settleAsync();

        (container.querySelector('.query-applied-clear') as HTMLButtonElement).click();

        expect(activeTab(container)).toBe('Q2');
        expect(mainHeaders(container)).toEqual(['order_id', 'city', 'total']);

        clickTab(container, 'Q1');
        expect(mainHeaders(container)).toEqual(['city']);
    });

    it('shows a single value over the sheet tabs', async () => {
        renderTableWorkspace(container, workbook().data);
        toggleQueryPanel();
        typeQuery(container, 'from Q2 select count()');
        button(panel(container), 'Run').click();
        await settleAsync();

        expect(container.querySelector('.query-scalar-value')?.textContent).toBe('2');
        expect([...(container.querySelector('.table-workspace-table')?.children ?? [])].map((child) => child.className))
            .toEqual(['query-scalar', 'sheet-tabs']);
    });

    it('reads a workbook of one sheet with from * or by its name', async () => {
        renderTableWorkspace(container, workbook([SHEETS[2] as SheetSpec]).data);
        toggleQueryPanel();

        typeQuery(container, 'from * select customer');
        button(panel(container), 'Run').click();
        await settleAsync();
        expect(firstCells(container)).toEqual(['Thessaly Ironworks', 'Olympus Foods']);

        typeQuery(container, "from 'NORTH REGION' select count()");
        button(panel(container), 'Run').click();
        await settleAsync();
        expect(container.querySelector('.query-scalar-value')?.textContent).toBe('2');
    });

    it('asks for a sheet in the empty-query hint and the sample query, following the sheet on screen', async () => {
        renderTableWorkspace(container, workbook().data);
        toggleQueryPanel();
        button(panel(container), 'Run').click();
        await settleAsync();

        expect(container.querySelector('.query-error')?.textContent).toBe("Write a query first, like 'from Q1 take 20'.");
        expect(container.querySelector('.query-editor .cm-placeholder')?.textContent).toBe('from row in Q1\nwhere row.total > 100\nselect row');

        clickTab(container, 'North Region');

        expect(container.querySelector('.query-editor .cm-placeholder')?.textContent).toBe("from row in 'North Region'\nwhere row.total > 100\nselect row");
    });

    it('builds the syntax help from the real sheet names, with examples for the sheet on screen', async () => {
        renderTableWorkspace(container, workbook().data);
        toggleQueryPanel();
        await settleAsync();
        (container.querySelector('button[aria-label="Query syntax help"]') as HTMLButtonElement).click();
        const help = container.querySelector<HTMLElement>('.query-help') as HTMLElement;

        expect([...help.querySelectorAll('h3')].map((heading) => heading.textContent).slice(0, 2)).toEqual(['Examples for Q1', 'Source']);
        expect(help.textContent).toContain("This workbook has 4 sheets: Q1, Q2, 'North Region', Rates.");
        expect(help.textContent).toContain("from 'North Region', from [North Region]");
        expect(help.querySelector('.query-help-code')?.textContent).toBe('from Q1\ntake 20');

        clickTab(container, 'Q2');
        await settleAsync();

        expect(help.querySelector('h3')?.textContent).toBe('Examples for Q2');
        expect(help.querySelector('.query-help-code')?.textContent).toBe('from Q2\ntake 20');
    });

    it('keeps the queries with their sheet names in the history of the file', async () => {
        const book = workbook();
        renderTableWorkspace(container, book.data);
        toggleQueryPanel();
        typeQuery(container, "from 'North Region' take 1");
        button(panel(container), 'Run').click();
        await settleAsync();

        const history = container.querySelector<HTMLSelectElement>('.query-select') as HTMLSelectElement;
        history.dispatchEvent(new Event('focus'));

        expect([...history.options].map((option) => option.textContent)).toEqual(['History…', "from 'North Region' take 1"]);
    });

    it('can show a sheet from outside, by name', () => {
        const handle = renderTableWorkspace(container, workbook().data);

        expect(handle.showSheet('north region')).toBe(true);
        expect(activeTab(container)).toBe('North Region');
        expect(handle.showSheet('Nowhere')).toBe(false);
        expect(handle.isConnected()).toBe(true);

        container.replaceChildren();
        expect(handle.isConnected()).toBe(false);
    });
});
