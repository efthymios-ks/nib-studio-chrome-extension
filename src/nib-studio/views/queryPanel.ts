import type { EditorState } from '@codemirror/state';
import { isAbortError } from '../../common/csv/csvLimits.js';
import { isLinqError } from '../../common/linq/linqErrors.js';
import { compileQuery, runQueryAsync, type LinqProgress, type LinqResult } from '../../common/linq/linqEvaluator.js';
import { parseQuery } from '../../common/linq/linqParser.js';
import {
    LINQ_REFERENCE,
    buildExampleQueries,
    buildSheetSourceReference,
    type LinqExampleQuery,
    type LinqReferenceSection,
} from '../../common/linq/linqReference.js';
import { querySourceFor, resolveQuerySheet, sheetNamedIn } from '../../common/linq/linqSheets.js';
import type { LinqTableSource } from '../../common/linq/linqSources.js';
import { formatValue, type LinqValue } from '../../common/linq/linqValues.js';
import { copyTextWithToastAsync } from '../app/clipboard.js';
import { clear, h } from '../app/dom.js';
import { errorMessage } from '../../common/errorMessage.js';
import {
    mountQueryEditor,
    queryPlaceholder,
    type QueryCompletions,
    type QueryEditorHandle,
    type QueryEditorHandlers,
} from './queryEditor.js';
import { createSheetTabs } from './sheetTabs.js';
import { registerShownTable } from './shownTable.js';
import { renderTableView, type TableColumn, type TableViewMemory } from './tableView.js';

// One table a query can read: the one table of a CSV or TSV file, or one sheet of a workbook.
export interface QueryTable {
    // The sheet's name; null for the table of a CSV or TSV file, which has no sheets.
    readonly name: string | null;
    readonly hidden?: boolean;
    readonly columns: ReadonlyArray<string>;
    // Resolves to the rows to query once they can be read; reports waits like indexing.
    readonly loadSourceAsync: (report: (status: string) => void, signal: AbortSignal) => Promise<LinqTableSource>;
    // A few leading rows, used to type the columns for the examples.
    readonly loadSampleRowsAsync: () => Promise<ReadonlyArray<ReadonlyArray<unknown>>>;
    // Renders the full table; a returned handle is destroyed before a query result or another sheet replaces it.
    readonly renderTable: (host: HTMLElement, chrome: TableChrome) => { readonly destroy: () => void } | void;
}

// What the workspace puts into each table it shows: the Query toggle for the toolbar, and the sheet tabs.
export interface TableChrome {
    readonly toolbarExtras: () => ReadonlyArray<HTMLElement>;
    // The sheet tabs of a workbook with more than one sheet, between the rows and the status line; null otherwise.
    readonly footer: HTMLElement | null;
}

// The sheet a workbook shows and the hidden sheets shown as tabs, which the caller keeps per tab.
export interface SheetMemory {
    activeSheet?: string;
    shownSheets?: string[];
}

export interface QueryTableData {
    // Identifies the file, for its query history.
    readonly key: string;
    // The file's one table, or a workbook's sheets in workbook order.
    readonly tables: ReadonlyArray<QueryTable>;
    readonly sheetMemory?: SheetMemory;
    // Told which sheet shows, such as `Sheet 2 of 3 · Q2`, whenever that changes; null for a file of one table.
    readonly onSheetChange?: (label: string | null) => void;
}

// A workspace on screen, for showing one of its sheets from outside, as opening a Lookup match does.
export interface TableWorkspaceHandle {
    // Shows the sheet of this name, ignoring case; false when the file has no such sheet.
    readonly showSheet: (name: string) => boolean;
    readonly isConnected: () => boolean;
}

interface QueryLayout {
    open: boolean;
    width: number;
    editorHeight: number;
}

interface QueryError {
    readonly message: string;
    readonly line: number | null;
    readonly column: number | null;
    readonly span: { start: number; end: number } | null;
}

interface QuerySession {
    state: EditorState | null;
    readonly handlers: QueryEditorHandlers;
    editor: QueryEditorHandle | null;
    controller: AbortController | null;
    status: string;
    // The result each sheet shows, by sheet name; '' stands for the table of a CSV or TSV file.
    readonly applied: Map<string, LinqResult>;
    // What each sheet's result table keeps while it shows, such as its sort; a new result starts afresh.
    readonly resultMemories: Map<string, TableViewMemory>;
    // The result of the last run and the sheet it read, for the line under Run.
    lastRun: { readonly sheet: string; readonly result: LinqResult } | null;
    error: QueryError | null;
    elapsedMs: number;
    helpOpen: boolean;
    // Bumped whenever a result or the error changes, so progress alone redraws only the status.
    version: number;
    readonly listeners: Set<() => void>;
    // Lets the panel on screen follow the sheet shown, for its examples and sample query.
    onSheetShown: (() => void) | null;
}

// What the panel needs of the workspace it sits in.
interface WorkspaceLink {
    readonly data: QueryTableData;
    // The table on screen.
    readonly activeTable: () => QueryTable;
    // Shows the table at this index, as after a query on it.
    readonly showTable: (index: number) => void;
}

const LAYOUT_KEY = 'nib-studio/query-panel';
const HISTORY_KEY_PREFIX = 'nib-studio/query-history:';
const HISTORY_LIMIT = 20;
const PANEL_MIN_WIDTH = 280;
const PANEL_DEFAULT_WIDTH = 420;
const TABLE_MIN_WIDTH = 200;
const EDITOR_MIN_HEIGHT = 80;
const EDITOR_DEFAULT_HEIGHT = 180;
// Rows looked at to decide whether a result column holds numbers.
const ALIGN_SAMPLE_ROWS = 1000;

const sessions = new Map<string, QuerySession>();
const workspaceToggles = new WeakMap<HTMLElement, () => void>();

// The keys that move to the next or previous sheet while the table has the focus: Ctrl+PageDown and Ctrl+PageUp,
// as in Excel, and the same with Shift, as in Google Sheets, since a normal Chrome window keeps Ctrl+PageDown
// and Ctrl+PageUp for its own tabs.
const SHEET_KEYS: ReadonlyArray<{ readonly key: string; readonly step: number }> = [
    { key: 'PageDown', step: 1 },
    { key: 'PageUp', step: -1 },
];

// The sheet names a query can name: none for a CSV or TSV file, every sheet in order for a workbook.
function sheetNamesOf(data: QueryTableData): string[] {
    return data.tables.flatMap((table) => (table.name == null ? [] : [table.name]));
}

function tableKeyOf(table: QueryTable): string {
    return table.name ?? '';
}

// Lays out the table with the query panel to its right, the Query toggle in the table toolbar,
// and, for a workbook of several sheets, the sheet tabs under the rows.
// While a query result is applied to a sheet, that sheet shows it in place of its rows.
export function renderTableWorkspace(container: HTMLElement, data: QueryTableData): TableWorkspaceHandle {
    const layout = readLayout();
    const workspace = h('div', { class: 'table-workspace' });
    const indicator = h('div', { class: 'query-applied', attrs: { role: 'status' } });
    indicator.hidden = true;
    const tableHost = h('div', { class: 'table-workspace-table' });
    const main = h('div', { class: 'table-workspace-main', children: [indicator, tableHost] });
    const resizer = h('div', {
        class: 'split-resizer split-resizer-vertical table-workspace-resizer',
        attrs: { role: 'separator', 'aria-orientation': 'vertical', title: 'Drag to resize, double-click to close the query panel' },
    });
    const panelHost = h('aside', { class: 'query-panel', aria: { label: 'Query' } });
    workspace.style.setProperty('--query-panel-width', `${layout.width}px`);
    workspace.append(main, resizer, panelHost);
    clear(container);
    container.append(workspace);

    const session = sessionFor(data.key);
    const memory = data.sheetMemory ?? {};
    const tables = data.tables;
    const toolbarExtras = (): ReadonlyArray<HTMLElement> => [h('button', {
        class: 'button table-query-toggle',
        text: 'Query',
        dataset: { queryToggle: 'true', active: String(workspace.dataset['queryOpen'] === 'true') },
        attrs: { type: 'button', title: 'Query the table with from, where, group by, select', 'aria-pressed': String(workspace.dataset['queryOpen'] === 'true') },
        on: { click: () => workspaceToggles.get(workspace)?.() },
    })];

    // The hidden sheets shown as tabs, and the sheet on screen, as the tab remembers them,
    // while those sheets still exist.
    const shownHidden = (): Set<number> => new Set((memory.shownSheets ?? [])
        .map((name) => tables.findIndex((table) => table.hidden === true && table.name === name))
        .filter((index) => index >= 0));
    const isOnStrip = (index: number): boolean => tables[index]?.hidden !== true || shownHidden().has(index);
    const stripIndexes = (): number[] => tables.flatMap((_, index) => (isOnStrip(index) ? [index] : []));
    const activeIndex = (): number => {
        const remembered = tables.findIndex((table) => table.name != null && table.name === memory.activeSheet);

        if (remembered >= 0 && isOnStrip(remembered)) {
            return remembered;
        }

        return Math.max(0, tables.findIndex((table) => table.hidden !== true));
    };

    const sheetLabel = (index: number): string | null => {
        const name = tables[index]?.name;

        if (tables.length < 2 || name == null) {
            return null;
        }

        const strip = stripIndexes();

        return `Sheet ${strip.indexOf(index) + 1} of ${strip.length} · ${name}`;
    };

    const tabs = tables.length > 1
        ? createSheetTabs({
            sheets: tables.map((table) => ({ name: table.name ?? '', hidden: table.hidden === true })),
            onSelect: (index) => showTable(index),
            onToggleHidden: (index) => toggleHidden(index),
        })
        : null;
    const chrome: TableChrome = { toolbarExtras, footer: tabs?.element ?? null };

    // Undefined until the first render, then what is on screen: the sheet, and its result or null for its rows.
    let shown: { readonly index: number; readonly result: LinqResult | null } | undefined;
    let handle: { readonly destroy: () => void } | void;
    let announced: string | null | undefined;
    const renderMain = (): void => {
        const index = activeIndex();
        const table = tables[index] as QueryTable;
        const key = tableKeyOf(table);
        const result = workspace.dataset['queryOpen'] === 'true' ? session.applied.get(key) ?? null : null;
        tabs?.update(index, shownHidden());
        const label = sheetLabel(index);

        if (label !== announced) {
            announced = label;
            data.onSheetChange?.(label);
        }

        if (shown != null && shown.index === index && shown.result === result) {
            return;
        }

        shown = { index, result };
        handle?.destroy();
        handle = undefined;
        clear(tableHost);

        if (result == null) {
            renderIndicator(indicator, null, () => undefined);
            handle = table.renderTable(tableHost, chrome);

            return;
        }

        renderIndicator(indicator, result, () => clearApplied(session, key));
        handle = renderQueryResult(tableHost, result, chrome, resultMemoryOf(session, key));
    };

    // Shows the sheet at this index; the focus stays in the table, or on the tabs, where it was.
    function showTable(index: number): void {
        const table = tables[index];

        if (table == null) {
            return;
        }

        const hadTableFocus = tableHost.contains(document.activeElement);
        const hadTabFocus = tabs?.element.contains(document.activeElement) === true;

        if (table.hidden === true && table.name != null && !shownHidden().has(index)) {
            memory.shownSheets = [...(memory.shownSheets ?? []), table.name];
        }

        memory.activeSheet = table.name ?? undefined;
        renderMain();

        if (hadTableFocus) {
            tableHost.querySelector<HTMLElement>('.table-body')?.focus({ preventScroll: true });
        }
        else if (hadTabFocus) {
            tabs?.focusActive();
        }

        session.onSheetShown?.();
    }

    // Shows a hidden sheet and moves to it, or puts a shown one away again.
    function toggleHidden(index: number): void {
        const name = tables[index]?.name;

        if (name == null) {
            return;
        }

        if (!shownHidden().has(index)) {
            showTable(index);

            return;
        }

        memory.shownSheets = (memory.shownSheets ?? []).filter((shownName) => shownName !== name);
        renderMain();
        session.onSheetShown?.();
    }

    main.addEventListener('keydown', (event) => {
        const move = SHEET_KEYS.find((entry) => entry.key === event.key);

        if (move == null || tabs == null || !(event.ctrlKey || event.metaKey) || event.altKey) {
            return;
        }

        event.preventDefault();
        const strip = stripIndexes();
        const target = strip[strip.indexOf(activeIndex()) + move.step];

        if (target != null) {
            showTable(target);
        }
    });

    const onSessionChange = (): void => {
        if (!workspace.isConnected) {
            session.listeners.delete(onSessionChange);

            return;
        }

        renderMain();
    };

    let mounted = false;
    const setOpen = (open: boolean): void => {
        const current = readLayout();
        current.open = open;
        writeLayout(current);
        workspace.dataset['queryOpen'] = String(open);
        resizer.hidden = !open;
        panelHost.hidden = !open;

        // Closing the panel puts every sheet's rows back.
        if (!open && (session.applied.size > 0 || session.controller != null)) {
            session.controller?.abort();
            clearAllApplied(session);
        }

        renderMain();

        for (const button of workspace.querySelectorAll<HTMLElement>('[data-query-toggle]')) {
            button.dataset['active'] = String(open);
            button.setAttribute('aria-pressed', String(open));
        }

        if (open && !mounted) {
            mounted = true;
            const link: WorkspaceLink = { data, activeTable: () => tables[activeIndex()] as QueryTable, showTable };
            mountQueryPanel(panelHost, link, () => setOpen(false));
        }

        if (open) {
            session.editor?.focus();
        }
    };

    workspaceToggles.set(workspace, () => setOpen(workspace.dataset['queryOpen'] !== 'true'));
    attachPanelResizer(resizer, workspace, () => setOpen(false));
    session.listeners.add(onSessionChange);
    setOpen(layout.open);

    return {
        showSheet: (name) => {
            const index = tables.findIndex((table) => table.name?.toLowerCase() === name.toLowerCase());

            if (index >= 0) {
                showTable(index);
            }

            return index >= 0;
        },
        isConnected: () => workspace.isConnected,
    };
}

function resultMemoryOf(session: QuerySession, key: string): TableViewMemory {
    let memory = session.resultMemories.get(key);

    if (memory == null) {
        memory = {};
        session.resultMemories.set(key, memory);
    }

    return memory;
}

// Drops the result applied to one sheet, so it shows its rows again.
function clearApplied(session: QuerySession, key: string): void {
    session.applied.delete(key);
    session.resultMemories.delete(key);

    if (session.lastRun?.sheet === key) {
        session.lastRun = null;
        session.status = '';
    }

    session.version += 1;
    notify(session);
}

// Drops every sheet's result, so the file's rows show again.
function clearAllApplied(session: QuerySession): void {
    session.applied.clear();
    session.resultMemories.clear();
    session.lastRun = null;
    session.status = '';
    session.version += 1;
    notify(session);
}

// The bar above the main table while a query result is applied, as in "Query applied · 240 rows · Clear".
function renderIndicator(bar: HTMLElement, result: LinqResult | null, onClear: () => void): void {
    clear(bar);
    bar.hidden = result == null;

    if (result == null) {
        return;
    }

    const count = result.kind === 'scalar'
        ? '1 value'
        : `${formatNumber(result.rows.length)} ${result.rows.length === 1 ? 'row' : 'rows'}`;
    bar.append(
        h('span', { class: 'query-applied-label', text: 'Query applied' }),
        h('span', { class: 'query-applied-separator', text: '·' }),
        h('span', { class: 'query-applied-count', text: count }),
        h('span', { class: 'query-applied-separator', text: '·' }),
        h('button', {
            class: 'query-applied-clear',
            text: 'Clear',
            attrs: { type: 'button', title: 'Show the full table again' },
            on: { click: onClear },
        }),
    );
}

// Shows a result in the main table area: rows in the regular table view, or one large value.
function renderQueryResult(
    host: HTMLElement,
    result: LinqResult,
    chrome: TableChrome,
    memory: TableViewMemory,
): { readonly destroy: () => void } | void {
    if (result.kind === 'scalar') {
        const text = formatValue(result.value);
        const scalar = h('div', {
            class: 'query-scalar',
            children: [
                h('div', { class: 'query-scalar-label', text: result.column }),
                h('output', { class: 'query-scalar-value', text: text === '' ? '(empty)' : text }),
                h('button', {
                    class: 'button',
                    text: 'Copy',
                    attrs: { type: 'button', title: 'Copy the value' },
                    on: {
                        click: () => {
                            void copyTextWithToastAsync(text, 'Value copied.');
                        },
                    },
                }),
            ],
        });
        // The one value copies as a table of one cell under its column's name.
        registerShownTable(scalar, {
            rowCount: () => 1,
            busyReason: () => null,
            readRowsAsync: async () => ({ columns: [result.column], rows: [[text]] }),
        });
        host.append(scalar);

        if (chrome.footer != null) {
            host.append(chrome.footer);
        }

        return;
    }

    // The result is already in memory, so the table takes the in-memory path, even for a large file.
    const rows = result.rows.map((row) => row.map(displayCell));
    const sample = rows.slice(0, ALIGN_SAMPLE_ROWS);
    const columns: TableColumn[] = result.columns.map((title, index) => {
        const numeric = sample.length > 0 && sample.every((row) => row[index] == null || row[index] === '' || typeof row[index] === 'number');

        return { id: `q${index}`, title, ...(numeric ? { align: 'right' as const } : {}) };
    });

    return renderTableView(host, {
        ...chrome,
        columns,
        getAllRows: () => rows,
        totalRowCount: rows.length,
        memory,
    });
}

function sessionFor(key: string): QuerySession {
    let session = sessions.get(key);

    if (session == null) {
        session = {
            state: null,
            handlers: {},
            editor: null,
            controller: null,
            status: '',
            applied: new Map(),
            resultMemories: new Map(),
            lastRun: null,
            error: null,
            elapsedMs: 0,
            helpOpen: false,
            version: 0,
            listeners: new Set(),
            onSheetShown: null,
        };
        sessions.set(key, session);
    }

    return session;
}

function notify(session: QuerySession): void {
    for (const listener of [...session.listeners]) {
        listener();
    }
}

// What the editor completes for the query as typed: the sheets of a workbook, and the columns of the sheet
// the query names, or of the sheet on screen until it names one.
function completionsFor(link: WorkspaceLink, text: string): QueryCompletions {
    const tables = link.data.tables;
    const named = sheetNamedIn(text)?.toLowerCase();
    const table = (named == null ? null : tables.find((candidate) => candidate.name?.toLowerCase() === named)) ?? link.activeTable();

    return {
        columns: table.columns,
        sheets: tables.flatMap((candidate) => (candidate.name == null ? [] : [{ name: candidate.name, hidden: candidate.hidden === true }])),
        allowsStar: tables.length < 2,
    };
}

function mountQueryPanel(host: HTMLElement, link: WorkspaceLink, close: () => void): void {
    const { data } = link;
    const session = sessionFor(data.key);
    const sheetNames = sheetNamesOf(data);
    clear(host);

    const historySelect = h('select', { class: 'input query-select', attrs: { title: 'Recent queries on this file' } }) as HTMLSelectElement;
    const helpButton = h('button', {
        class: 'icon-button query-help-button',
        text: '?',
        attrs: { type: 'button', title: 'Query syntax help', 'aria-label': 'Query syntax help' },
    });
    const closeButton = h('button', {
        class: 'icon-button',
        text: '×',
        attrs: { type: 'button', title: 'Close the query panel', 'aria-label': 'Close the query panel' },
        on: { click: () => close() },
    });
    const header = h('div', {
        class: 'query-header',
        children: [h('span', { class: 'query-title', text: 'Query' }), h('span', { class: 'toolbar-spacer' }), historySelect, helpButton, closeButton],
    });

    const editorHost = h('div', { class: 'editor-host query-editor' });
    const runButton = h('button', { class: 'button button-primary', text: 'Run', attrs: { type: 'button', title: 'Run the query (Ctrl+Enter)' } });
    const cancelButton = h('button', { class: 'button', text: 'Cancel', attrs: { type: 'button', title: 'Stop the running query' } });
    const clearButton = h('button', { class: 'button', text: 'Clear', attrs: { type: 'button', title: 'Clear the query and show the full table' } });
    const actions = h('div', {
        class: 'query-actions',
        children: [runButton, cancelButton, clearButton, h('span', { class: 'query-hint', text: 'Ctrl+Enter runs' })],
    });
    const statusLine = h('div', { class: 'query-status', attrs: { role: 'status', 'aria-live': 'polite' } });
    const errorBox = h('div', { class: 'query-error', attrs: { role: 'alert' } });
    const help = h('div', { class: 'query-help' });
    const panel = h('div', { class: 'query-panel-body', children: [header, editorHost, actions, statusLine, errorBox, help] });
    panel.style.setProperty('--query-editor-height', `${readLayout().editorHeight}px`);
    host.append(panel);

    session.editor?.destroy();
    session.handlers.onRun = () => {
        void runAsync(session, link);
    };
    session.handlers.onChange = (state) => {
        session.state = state;
    };
    session.handlers.completions = (text) => completionsFor(link, text);
    const editor = mountQueryEditor({
        parent: editorHost,
        columns: link.activeTable().columns,
        handlers: session.handlers,
        state: session.state ?? undefined,
    });
    session.editor = editor;
    session.state = editor.view.state;

    if (session.error?.span != null) {
        editor.markError(session.error.span);
    }

    runButton.addEventListener('click', () => {
        void runAsync(session, link);
    });
    cancelButton.addEventListener('click', () => session.controller?.abort());
    clearButton.addEventListener('click', () => {
        session.controller?.abort();
        editor.setText('');
        editor.markError(null);
        session.error = null;
        clearApplied(session, tableKeyOf(link.activeTable()));
        editor.focus();
    });
    helpButton.addEventListener('click', () => {
        session.helpOpen = !session.helpOpen;
        renderHelpState();
    });

    // A workbook's Source section names its own sheets.
    const sections: ReadonlyArray<LinqReferenceSection> = [buildSheetSourceReference(sheetNames), ...LINQ_REFERENCE.slice(1)];
    const sourceOf = (table: QueryTable): string => querySourceFor(sheetNames, table.name);
    const examplesTitle = (table: QueryTable): string => (sheetNames.length > 1 && table.name != null
        ? `Examples for ${table.name}`
        : 'Examples for this table');
    let examplesTable = link.activeTable();
    let examples: LinqExampleQuery[] = buildExampleQueries(examplesTable.columns, [], sourceOf(examplesTable));
    const insert = (text: string): void => {
        editor.setText(text);
        editor.focus();
    };

    const fillHistory = (): void => {
        clear(historySelect);
        const entries = readHistory(data.key);
        historySelect.append(h('option', { text: entries.length === 0 ? 'History (empty)' : 'History…', attrs: { value: '' } }));

        entries.forEach((entry, index) => {
            const label = entry.replace(/\s+/g, ' ');
            historySelect.append(h('option', { text: label.length > 60 ? `${label.slice(0, 59)}…` : label, attrs: { value: String(index), title: entry } }));
        });
    };

    historySelect.addEventListener('focus', fillHistory);
    historySelect.addEventListener('change', () => {
        const entry = readHistory(data.key)[Number(historySelect.value)];
        historySelect.value = '';

        if (entry != null) {
            insert(entry);
        }
    });

    const renderHelpState = (): void => {
        panel.dataset['helpOpen'] = String(session.helpOpen);
        help.hidden = !session.helpOpen;
        helpButton.dataset['active'] = String(session.helpOpen);

        if (session.helpOpen) {
            renderHelp(help, {
                examplesTitle: examplesTitle(examplesTable),
                examples,
                sections,
                insert,
                back: () => {
                    session.helpOpen = false;
                    renderHelpState();
                },
            });
        }
    };

    // The help's examples start from the column names alone and pick up real values once the sample rows are read.
    const fillExamplesFromSampleAsync = async (table: QueryTable): Promise<void> => {
        try {
            const rows = await table.loadSampleRowsAsync();

            if (examplesTable !== table) {
                return;
            }

            examples = buildExampleQueries(table.columns, rows, sourceOf(table));

            if (session.helpOpen && help.isConnected) {
                renderHelpState();
            }
        }
        catch {
            // Without sample rows the examples keep to the column names.
        }
    };

    // The examples and the grey sample query follow the sheet on screen.
    const followSheet = (): void => {
        const table = link.activeTable();
        editor.setPlaceholder(queryPlaceholder(sourceOf(table)));

        if (table === examplesTable) {
            return;
        }

        examplesTable = table;
        examples = buildExampleQueries(table.columns, [], sourceOf(table));
        renderHelpState();
        void fillExamplesFromSampleAsync(table);
    };

    session.onSheetShown = () => {
        if (host.isConnected) {
            followSheet();
        }
    };

    fillHistory();
    editor.setPlaceholder(queryPlaceholder(sourceOf(examplesTable)));
    void fillExamplesFromSampleAsync(examplesTable);

    let renderedVersion = -1;
    const update = (): void => {
        if (!host.isConnected) {
            session.listeners.delete(update);

            return;
        }

        const running = session.controller != null;
        runButton.toggleAttribute('disabled', running);
        cancelButton.hidden = !running;
        renderStatus(statusLine, session);

        if (renderedVersion !== session.version) {
            renderedVersion = session.version;
            renderError(errorBox, session.error);
        }
    };

    session.listeners.add(update);
    renderHelpState();
    update();
}

async function runAsync(session: QuerySession, link: WorkspaceLink): Promise<void> {
    const editor = session.editor;
    const { data } = link;

    if (editor == null) {
        return;
    }

    const text = editor.getText();
    const sheetNames = sheetNamesOf(data);
    session.controller?.abort();

    if (text.trim() === '') {
        const source = querySourceFor(sheetNames, link.activeTable().name);
        session.error = { message: `Write a query first, like 'from ${source} take 20'.`, line: null, column: null, span: null };
        session.version += 1;
        notify(session);

        return;
    }

    const controller = new AbortController();
    session.controller = controller;
    // The table keeps showing the last result until the new one is ready.
    session.error = null;
    session.status = 'Starting…';
    session.helpOpen = false;
    session.version += 1;
    editor.markError(null);
    rememberQuery(data.key, text);
    notify(session);
    const started = performance.now();
    let lastReport = 0;

    try {
        const index = resolveQuerySheet(parseQuery(text), sheetNames);
        const table = data.tables[index] as QueryTable;
        compileQuery(text, table.columns);
        const source = await table.loadSourceAsync((status) => {
            session.status = status;
            notify(session);
        }, controller.signal);
        const result = await runQueryAsync(text, source, {
            signal: controller.signal,
            onProgress: (progress) => {
                const now = performance.now();

                // Progress repaints at most every 100 ms.
                if (now - lastReport < 100 && progress.done < progress.total) {
                    return;
                }

                lastReport = now;
                session.status = describeProgress(progress);
                notify(session);
            },
        });

        if (session.controller !== controller) {
            return;
        }

        const key = tableKeyOf(table);
        session.applied.set(key, result);
        session.resultMemories.set(key, {});
        session.lastRun = { sheet: key, result };
        session.status = '';
        // The result shows on the sheet the query read.
        link.showTable(index);
    }
    catch (error: unknown) {
        if (session.controller !== controller && isAbortError(error)) {
            return;
        }

        if (isAbortError(error)) {
            session.status = 'Cancelled.';
        }
        else if (isLinqError(error)) {
            error.locate(text);
            session.status = '';
            session.error = { message: error.message, line: error.line, column: error.column, span: { start: error.start, end: error.end } };
            session.editor?.markError(session.error.span);
        }
        else {
            session.status = '';
            session.error = { message: errorMessage(error), line: null, column: null, span: null };
        }
    }
    finally {
        if (session.controller === controller) {
            session.controller = null;
            session.elapsedMs = performance.now() - started;
            session.version += 1;
            notify(session);
        }
    }
}

function describeProgress(progress: LinqProgress): string {
    if (progress.phase === 'sorting') {
        return progress.done === 0 ? `Sorting ${formatNumber(progress.total)} rows…` : 'Sorted.';
    }

    const percent = progress.total === 0 ? 100 : Math.floor((progress.done / progress.total) * 100);

    return `Scanning… ${percent}% (${formatNumber(progress.done)} of ${formatNumber(progress.total)} rows)`;
}

function renderStatus(line: HTMLElement, session: QuerySession): void {
    if (session.controller != null || session.status !== '') {
        line.textContent = session.status;
        line.dataset['state'] = session.controller != null ? 'running' : 'idle';

        return;
    }

    line.dataset['state'] = 'idle';
    const result = session.lastRun?.result ?? null;

    if (result == null || session.error != null) {
        line.textContent = session.error == null ? 'Write a query and press Run.' : '';

        return;
    }

    const elapsed = `${formatNumber(Math.round(session.elapsedMs))} ms`;
    const scanned = `${formatNumber(result.scannedRows)} rows read`;
    line.textContent = result.kind === 'scalar'
        ? `1 value · ${elapsed} · ${scanned}`
        : `${formatNumber(result.rows.length)} ${result.rows.length === 1 ? 'row' : 'rows'} · ${elapsed} · ${scanned}`;
}

function renderError(box: HTMLElement, error: QueryError | null): void {
    clear(box);
    box.hidden = error == null;

    if (error == null) {
        return;
    }

    if (error.line != null) {
        box.append(h('span', { class: 'query-error-position', text: `Line ${error.line}, column ${error.column ?? 1}: ` }));
    }

    box.append(h('span', { text: error.message }));
}

interface HelpContent {
    readonly examplesTitle: string;
    readonly examples: ReadonlyArray<LinqExampleQuery>;
    readonly sections: ReadonlyArray<LinqReferenceSection>;
    readonly insert: (text: string) => void;
    readonly back: () => void;
}

function renderHelp(host: HTMLElement, content: HelpContent): void {
    clear(host);
    host.append(h('div', {
        class: 'query-help-header',
        children: [
            h('h2', { text: 'Query syntax' }),
            h('span', { class: 'toolbar-spacer' }),
            h('button', { class: 'button', text: 'Close help', attrs: { type: 'button' }, on: { click: content.back } }),
        ],
    }));

    const exampleList = h('div', { class: 'query-help-examples' });

    for (const example of content.examples) {
        exampleList.append(h('div', {
            class: 'query-help-example',
            children: [
                h('div', {
                    class: 'query-help-example-header',
                    children: [
                        h('span', { class: 'query-help-example-title', text: example.title }),
                        h('span', { class: 'toolbar-spacer' }),
                        h('button', {
                            class: 'button',
                            text: 'Copy',
                            attrs: { type: 'button', title: 'Copy the query' },
                            on: {
                                click: () => {
                                    void copyTextWithToastAsync(example.query, 'Query copied.');
                                },
                            },
                        }),
                        h('button', {
                            class: 'button button-primary',
                            text: 'Insert',
                            attrs: { type: 'button', title: 'Put the query in the editor' },
                            on: { click: () => content.insert(example.query) },
                        }),
                    ],
                }),
                h('pre', { class: 'query-help-code', text: example.query }),
            ],
        }));
    }

    host.append(h('section', { class: 'query-help-section', children: [h('h3', { text: content.examplesTitle }), exampleList] }));

    for (const section of content.sections) {
        const list = h('dl', { class: 'query-help-list' });

        for (const entry of section.entries) {
            list.append(
                h('dt', { children: [h('code', { text: entry.syntax })] }),
                h('dd', { text: entry.description }),
            );
        }

        host.append(h('section', {
            class: 'query-help-section',
            children: [
                h('h3', { text: section.title }),
                section.intro == null ? null : h('p', { text: section.intro }),
                list,
            ],
        }));
    }
}

function displayCell(value: LinqValue): unknown {
    if (typeof value === 'number') {
        return Number(formatValue(value));
    }

    return formatValue(value);
}

function attachPanelResizer(handle: HTMLElement, workspace: HTMLElement, close: () => void): void {
    handle.addEventListener('dblclick', () => close());
    handle.addEventListener('mousedown', (event) => {
        if (event.button !== 0) {
            return;
        }

        event.preventDefault();
        const panel = workspace.querySelector<HTMLElement>('.query-panel');
        const startX = event.clientX;
        const startWidth = panel?.getBoundingClientRect().width ?? readLayout().width;
        let width = startWidth;
        document.body.dataset['resizing'] = 'horizontal';

        const onMove = (move: MouseEvent): void => {
            const available = workspace.getBoundingClientRect().width - TABLE_MIN_WIDTH;
            width = Math.max(PANEL_MIN_WIDTH, Math.min(Math.max(PANEL_MIN_WIDTH, available), startWidth - (move.clientX - startX)));
            workspace.style.setProperty('--query-panel-width', `${width}px`);
        };

        const onUp = (): void => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            delete document.body.dataset['resizing'];
            const layout = readLayout();
            layout.width = Math.round(width);
            writeLayout(layout);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

function readLayout(): QueryLayout {
    try {
        const stored = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null') as Partial<QueryLayout> | null;

        return {
            open: stored?.open === true,
            width: Math.max(PANEL_MIN_WIDTH, Number(stored?.width) || PANEL_DEFAULT_WIDTH),
            editorHeight: Math.max(EDITOR_MIN_HEIGHT, Number(stored?.editorHeight) || EDITOR_DEFAULT_HEIGHT),
        };
    }
    catch {
        return { open: false, width: PANEL_DEFAULT_WIDTH, editorHeight: EDITOR_DEFAULT_HEIGHT };
    }
}

function writeLayout(layout: QueryLayout): void {
    try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    }
    catch {
        // Storage can be unavailable; the layout then lasts only for this page.
    }
}

function readHistory(key: string): string[] {
    try {
        const stored = JSON.parse(localStorage.getItem(HISTORY_KEY_PREFIX + key) ?? '[]') as unknown;

        return Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === 'string') : [];
    }
    catch {
        return [];
    }
}

function rememberQuery(key: string, text: string): void {
    const entries = [text, ...readHistory(key).filter((entry) => entry !== text)].slice(0, HISTORY_LIMIT);

    try {
        localStorage.setItem(HISTORY_KEY_PREFIX + key, JSON.stringify(entries));
    }
    catch {
        // History is a convenience; without storage it is simply not kept.
    }
}

function formatNumber(value: number): string {
    return value.toLocaleString('en-US');
}
