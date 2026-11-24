import type { EditorState } from '@codemirror/state';
import { isAbortError } from '../../common/csv/csvLimits.js';
import { isLinqError } from '../../common/linq/linqErrors.js';
import { compileQuery, runQueryAsync, type LinqProgress, type LinqResult } from '../../common/linq/linqEvaluator.js';
import { LINQ_REFERENCE, buildExampleQueries, type LinqExampleQuery } from '../../common/linq/linqReference.js';
import type { LinqTableSource } from '../../common/linq/linqSources.js';
import { formatValue, type LinqValue } from '../../common/linq/linqValues.js';
import { clear, h } from '../app/dom.js';
import { errorMessage } from '../../common/errorMessage.js';
import { mountQueryEditor, type QueryEditorHandle, type QueryEditorHandlers } from './queryEditor.js';
import { renderTableView, type TableColumn } from './tableView.js';

export interface QueryTableData {
    // Identifies the file, for its query history.
    readonly key: string;
    readonly columns: ReadonlyArray<string>;
    // Resolves to the rows to query once they can be read; reports waits like indexing.
    readonly loadSourceAsync: (report: (status: string) => void, signal: AbortSignal) => Promise<LinqTableSource>;
    // A few leading rows, used to type the columns for the examples.
    readonly loadSampleRowsAsync: () => Promise<ReadonlyArray<ReadonlyArray<unknown>>>;
    // Renders the full table; a returned handle is destroyed before a query result replaces it.
    readonly renderTable: (host: HTMLElement, toolbarExtras: () => ReadonlyArray<HTMLElement>) => { readonly destroy: () => void } | void;
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
    result: LinqResult | null;
    error: QueryError | null;
    elapsedMs: number;
    helpOpen: boolean;
    // Bumped whenever the result or error changes, so progress alone redraws only the status.
    version: number;
    readonly listeners: Set<() => void>;
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

// Lays out the table with the query panel to its right, and the Query toggle in the table toolbar.
// While a query result is applied, the main table shows it in place of the file's rows.
export function renderTableWorkspace(container: HTMLElement, data: QueryTableData): void {
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
    const toolbarExtras = (): ReadonlyArray<HTMLElement> => [h('button', {
        class: 'button table-query-toggle',
        text: 'Query',
        dataset: { queryToggle: 'true', active: String(workspace.dataset['queryOpen'] === 'true') },
        attrs: { type: 'button', title: 'Query the table with from, where, group by, select', 'aria-pressed': String(workspace.dataset['queryOpen'] === 'true') },
        on: { click: () => workspaceToggles.get(workspace)?.() },
    })];

    // Undefined until the first render, then the result on screen, or null for the full table.
    let shown: LinqResult | null | undefined;
    let handle: { readonly destroy: () => void } | void;
    const renderMain = (): void => {
        const result = workspace.dataset['queryOpen'] === 'true' ? session.result : null;

        if (result === shown) {
            return;
        }

        shown = result;
        handle?.destroy();
        handle = undefined;
        clear(tableHost);

        if (result == null) {
            renderIndicator(indicator, null, () => undefined);
            handle = data.renderTable(tableHost, toolbarExtras);

            return;
        }

        renderIndicator(indicator, result, () => clearResult(session));
        handle = renderQueryResult(tableHost, result, toolbarExtras);
    };

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

        // Closing the panel puts the full table back.
        if (!open && (session.result != null || session.controller != null)) {
            session.controller?.abort();
            clearResult(session);
        }

        renderMain();

        for (const button of workspace.querySelectorAll<HTMLElement>('[data-query-toggle]')) {
            button.dataset['active'] = String(open);
            button.setAttribute('aria-pressed', String(open));
        }

        if (open && !mounted) {
            mounted = true;
            mountQueryPanel(panelHost, data, () => setOpen(false));
        }

        if (open) {
            session.editor?.focus();
        }
    };

    workspaceToggles.set(workspace, () => setOpen(workspace.dataset['queryOpen'] !== 'true'));
    attachPanelResizer(resizer, workspace, () => setOpen(false));
    session.listeners.add(onSessionChange);
    setOpen(layout.open);
}

// Drops the applied result, so the main table shows the file again.
function clearResult(session: QuerySession): void {
    session.result = null;
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
function renderQueryResult(host: HTMLElement, result: LinqResult, toolbarExtras: () => ReadonlyArray<HTMLElement>): { readonly destroy: () => void } | void {
    if (result.kind === 'scalar') {
        const text = formatValue(result.value);
        host.append(h('div', {
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
                            void navigator.clipboard?.writeText(text);
                        },
                    },
                }),
            ],
        }));

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
        columns,
        getAllRows: () => rows,
        totalRowCount: rows.length,
        toolbarExtras,
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
            result: null,
            error: null,
            elapsedMs: 0,
            helpOpen: false,
            version: 0,
            listeners: new Set(),
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

function mountQueryPanel(host: HTMLElement, data: QueryTableData, close: () => void): void {
    const session = sessionFor(data.key);
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
        void runAsync(session, data);
    };
    session.handlers.onChange = (state) => {
        session.state = state;
    };
    const editor = mountQueryEditor({
        parent: editorHost,
        columns: data.columns,
        handlers: session.handlers,
        state: session.state ?? undefined,
    });
    session.editor = editor;
    session.state = editor.view.state;

    if (session.error?.span != null) {
        editor.markError(session.error.span);
    }

    runButton.addEventListener('click', () => {
        void runAsync(session, data);
    });
    cancelButton.addEventListener('click', () => session.controller?.abort());
    clearButton.addEventListener('click', () => {
        session.controller?.abort();
        editor.setText('');
        editor.markError(null);
        session.error = null;
        clearResult(session);
        editor.focus();
    });
    helpButton.addEventListener('click', () => {
        session.helpOpen = !session.helpOpen;
        renderHelpState();
    });

    let examples: LinqExampleQuery[] = buildExampleQueries(data.columns, []);
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
            renderHelp(help, examples, insert, () => {
                session.helpOpen = false;
                renderHelpState();
            });
        }
    };

    // The help's examples start from the column names alone and pick up real values once the sample rows are read.
    const fillExamplesFromSampleAsync = async (): Promise<void> => {
        try {
            examples = buildExampleQueries(data.columns, await data.loadSampleRowsAsync());

            if (session.helpOpen && help.isConnected) {
                renderHelpState();
            }
        }
        catch {
            // Without sample rows the examples keep to the column names.
        }
    };

    fillHistory();
    void fillExamplesFromSampleAsync();

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

async function runAsync(session: QuerySession, data: QueryTableData): Promise<void> {
    const editor = session.editor;

    if (editor == null) {
        return;
    }

    const text = editor.getText();
    session.controller?.abort();

    if (text.trim() === '') {
        session.error = { message: "Write a query first, like 'from * take 20'.", line: null, column: null, span: null };
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
        compileQuery(text, data.columns);
        const source = await data.loadSourceAsync((status) => {
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

        session.result = result;
        session.status = '';
    }
    catch (error: unknown) {
        if (session.controller !== controller && isAbortError(error)) {
            return;
        }

        if (isAbortError(error)) {
            session.status = 'Cancelled.';
        }
        else if (isLinqError(error)) {
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
    const result = session.result;

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

function renderHelp(host: HTMLElement, examples: ReadonlyArray<LinqExampleQuery>, insert: (text: string) => void, back: () => void): void {
    clear(host);
    host.append(h('div', {
        class: 'query-help-header',
        children: [
            h('h2', { text: 'Query syntax' }),
            h('span', { class: 'toolbar-spacer' }),
            h('button', { class: 'button', text: 'Close help', attrs: { type: 'button' }, on: { click: back } }),
        ],
    }));

    const exampleList = h('div', { class: 'query-help-examples' });

    for (const example of examples) {
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
                                    void navigator.clipboard?.writeText(example.query);
                                },
                            },
                        }),
                        h('button', {
                            class: 'button button-primary',
                            text: 'Insert',
                            attrs: { type: 'button', title: 'Put the query in the editor' },
                            on: { click: () => insert(example.query) },
                        }),
                    ],
                }),
                h('pre', { class: 'query-help-code', text: example.query }),
            ],
        }));
    }

    host.append(h('section', { class: 'query-help-section', children: [h('h3', { text: 'Examples for this table' }), exampleList] }));

    for (const section of LINQ_REFERENCE) {
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
