import { resolveFileType } from '../../common/fs/fileTypes.js';
import { renderTableView, type TableColumn, type TableFilter, type TableSort, type TableViewMemory } from './tableView.js';
import { LargeCsvSource } from './largeCsvSource.js';
import { parseCsvStreamAsync } from '../../common/csv/csvParser.js';
import { isLargeTableFile, throwIfAborted } from '../../common/csv/csvLimits.js';
import { createArrayTableSource, createCsvTableSource } from '../../common/linq/linqSources.js';
import { EXCEL_DEFAULT_PASSWORD, readWorkbookEncryption } from '../../common/office/encryption/officeEncryption.js';
import type { PasswordEncryption } from '../../common/office/encryption/officeEncryptionTypes.js';
import { rememberUnlocked, unlockedBytesOf } from '../../common/office/encryption/unlockedFiles.js';
import { readWorkbook, type Workbook } from '../../common/office/xlsxLoader.js';
import { clear, h } from '../app/dom.js';
import { errorMessage } from '../../common/errorMessage.js';
import { readTextBlobAsync } from '../../common/text/textEncoding.js';
import { createPasswordCancelled } from './passwordPanel.js';
import { askForPasswordAsync, waitForPaintAsync } from './passwordUnlock.js';
import { BROWSER_CLOCK } from './previewZoomController.js';
import { renderTableWorkspace } from './queryPanel.js';

const WORKBOOK_PASSWORD_TITLE = 'This workbook is protected with a password';
const UNSUPPORTED_WORKBOOK_TITLE = 'This workbook\'s encryption isn\'t supported';

// Rows read to type the columns for the example queries.
const QUERY_SAMPLE_ROWS = 200;

export interface TableViewerInput {
    readonly fileName: string;
    readonly file?: File | null;
    readonly text?: string;
    // Workspace path, which keys the query history; the file name stands in without it.
    readonly path?: string;
}

// Renders the table view of a CSV or Excel file. The caller passes a File
// (preferred, for binary formats) and/or text (for CSV already loaded from the
// File System Access layer).
export async function renderTableViewerAsync(container: HTMLElement, input: TableViewerInput): Promise<void> {
    clear(container);
    renderCounts.set(container, (renderCounts.get(container) ?? 0) + 1);
    const type = resolveFileType(input.fileName);

    try {
        if (type.id === 'csv') {
            await renderCsvTableAsync(container, input);

            return;
        }

        if (type.id === 'excel') {
            await renderXlsxTableAsync(container, input);

            return;
        }
    }
    catch (error: unknown) {
        // A failure while a workbook unlocks replaces its "Unlocking…" status.
        clear(container);
        renderErrorCard(container, error, type.id === 'excel' ? 'This workbook can\'t be shown' : 'Preview not available');
    }
}

interface LargeTableEntry {
    readonly source: LargeCsvSource;
    filters: ReadonlyArray<TableFilter>;
    sorts: ReadonlyArray<TableSort>;
    search: string;
}

// A table is drawn again each time its tab or view comes back, so the index, block cache and view settings
// of a large file are kept per File snapshot instead of being rebuilt each time.
const largeTables = new WeakMap<File, Promise<LargeTableEntry>>();

// Sort, filters, columns and scroll of each open table, so leaving its tab and coming back restores them.
const tableMemories = new Map<string, TableViewMemory>();

// How many times each container was rendered into, so a password flow stops once the container shows something else.
const renderCounts = new WeakMap<HTMLElement, number>();

// Workbooks whose password panel was cancelled, so the pane shows the same step when it renders again.
const cancelledWorkbooks = new WeakSet<File>();

// Workbooks Excel's own password was tried on, so it is tried once per snapshot.
const defaultPasswordTried = new WeakSet<File>();

export function tableMemoryFor(key: string): TableViewMemory {
    let memory = tableMemories.get(key);

    if (memory == null) {
        memory = {};
        tableMemories.set(key, memory);
    }

    return memory;
}

// Forgets the tables whose tabs closed.
export function pruneTableMemories(openKeys: ReadonlyArray<string>): void {
    const keep = new Set(openKeys);

    for (const key of [...tableMemories.keys()]) {
        if (!keep.has(key)) {
            tableMemories.delete(key);
        }
    }
}

// A table that fails to open is forgotten, so the next render tries again.
async function openLargeTableAsync(file: File, fileName: string): Promise<LargeTableEntry> {
    try {
        const source = await LargeCsvSource.openAsync(file, fileName);

        return { source, filters: [], sorts: [], search: '' };
    }
    catch (error) {
        largeTables.delete(file);

        throw error;
    }
}

async function renderLargeCsvTableAsync(container: HTMLElement, file: File, input: TableViewerInput): Promise<void> {
    let pending = largeTables.get(file);

    if (pending == null) {
        pending = openLargeTableAsync(file, input.fileName);
        largeTables.set(file, pending);
    }

    const entry = await pending;
    const source = entry.source;
    const columns: TableColumn[] = source.columns.map((name, index) => ({ id: `col-${index}`, title: name }));

    renderTableWorkspace(container, {
        key: input.path ?? input.fileName,
        columns: source.columns,
        loadSourceAsync: async (report, signal) => {
            await waitForIndexAsync(source, report);
            throwIfAborted(signal);

            return createCsvTableSource({ columns: source.columns, blob: source.file, index: source.index, delimiter: source.delimiter });
        },
        loadSampleRowsAsync: async () => {
            await source.whenIndexedAsync();

            return source.readRowsAsync(sampleRowNumbers(source.getRowCount()));
        },
        renderTable: (host, toolbarExtras) => renderTableView(host, {
            columns,
            largeSource: source,
            initialFilters: entry.filters,
            initialSort: entry.sorts,
            initialSearch: entry.search,
            toolbarExtras,
            memory: tableMemoryFor(input.path ?? input.fileName),
            onFilterChange: (filters) => {
                entry.filters = filters;
            },
            onSortChange: (sorts) => {
                entry.sorts = sorts;
            },
            onSearchChange: (search) => {
                entry.search = search;
            },
        }),
    });
}

async function waitForIndexAsync(source: LargeCsvSource, report: (status: string) => void): Promise<void> {
    if (!source.isIndexing()) {
        return;
    }

    const describe = (): void => report(`Waiting for indexing… ${Math.floor(source.getIndexProgress() * 100)}%`);
    describe();
    const unsubscribe = source.subscribe(describe);

    try {
        await source.whenIndexedAsync();
    }
    finally {
        unsubscribe();
    }

    const error = source.getError();

    if (error != null) {
        throw new Error(`The file could not be indexed: ${error}`);
    }
}

function sampleRowNumbers(rowCount: number): Uint32Array {
    const rows = new Uint32Array(Math.min(rowCount, QUERY_SAMPLE_ROWS));

    for (let row = 0; row < rows.length; row += 1) {
        rows[row] = row;
    }

    return rows;
}

// Renders rows held in memory, with the query panel beside them.
function renderInMemoryTable(
    container: HTMLElement,
    input: TableViewerInput,
    names: ReadonlyArray<string>,
    rows: ReadonlyArray<ReadonlyArray<unknown>>,
): void {
    const columns: TableColumn[] = names.map((name, index) => ({ id: `col-${index}`, title: name }));

    renderTableWorkspace(container, {
        key: input.path ?? input.fileName,
        columns: names,
        loadSourceAsync: async () => createArrayTableSource(names, rows),
        loadSampleRowsAsync: async () => rows.slice(0, QUERY_SAMPLE_ROWS),
        renderTable: (host, toolbarExtras) => renderTableView(host, {
            columns,
            getAllRows: () => rows,
            totalRowCount: rows.length,
            toolbarExtras,
            memory: tableMemoryFor(input.path ?? input.fileName),
        }),
    });
}

async function renderCsvTableAsync(container: HTMLElement, input: TableViewerInput): Promise<void> {
    if (input.file != null && isLargeTableFile(input.fileName, input.file.size)) {
        await renderLargeCsvTableAsync(container, input.file, input);

        return;
    }

    // The text is decoded as the editor decodes it, so a file in a Windows code page reads as its letters.
    const source = input.file == null ? input.text ?? '' : (await readTextBlobAsync(input.file)).text;
    const result = await parseCsvStreamAsync(source, { hasHeader: true });
    const names = (result.header ?? result.rows[0]?.map((_, index) => `Column ${index + 1}`) ?? []).map((name) => String(name));

    renderInMemoryTable(container, input, names, result.rows);
}

async function renderXlsxTableAsync(container: HTMLElement, input: TableViewerInput): Promise<void> {
    if (input.file == null) {
        renderErrorCard(container, new Error('An XLSX workbook requires a File handle.'));

        return;
    }

    const file = input.file;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const encryption = readWorkbookEncryption(bytes);

    if (encryption == null) {
        renderWorkbook(container, input, readWorkbook(bytes));

        return;
    }

    if (encryption.kind === 'unsupported') {
        renderMessage(container, UNSUPPORTED_WORKBOOK_TITLE, `${encryption.reason} Open it in Excel to read it.`);

        return;
    }

    const plain = await unlockWorkbookAsync(container, input, file, encryption);

    if (plain != null) {
        clear(container);
        renderWorkbook(container, input, readWorkbook(plain));
    }
}

function renderWorkbook(container: HTMLElement, input: TableViewerInput, workbook: Workbook): void {
    const sheet = workbook.sheets[0];

    if (sheet == null) {
        renderErrorCard(container, new Error('Workbook has no sheets.'));

        return;
    }

    const names = (sheet.rows[0] ?? []).map((name, index) => (name == null || String(name).trim() === '' ? `Column ${index + 1}` : String(name)));
    renderInMemoryTable(container, input, names, sheet.rows.slice(1));
}

// The plain workbook behind a password: from this snapshot's earlier unlocking, from Excel's own password for
// workbooks protected only against changes, or by asking. Null after Cancel, or once the container moved on.
async function unlockWorkbookAsync(
    container: HTMLElement,
    input: TableViewerInput,
    file: File,
    encryption: PasswordEncryption,
): Promise<Uint8Array | null> {
    const known = unlockedBytesOf(file);

    if (known != null) {
        return known;
    }

    const renderCount = renderCounts.get(container);
    const isCurrent = (): boolean => renderCounts.get(container) === renderCount;
    const showLocked = (panel: HTMLElement): void => {
        clear(container);
        container.append(h('div', { class: 'table-locked', children: [panel] }));
    };
    const showUnlocking = (): void => showLocked(h('p', { class: 'table-locked-status', text: 'Unlocking…' }));
    const showCancelled = (): void => showLocked(createPasswordCancelled({
        title: WORKBOOK_PASSWORD_TITLE,
        fileName: input.fileName,
        onRetry: () => {
            cancelledWorkbooks.delete(file);
            void renderTableViewerAsync(container, input);
        },
    }));

    if (cancelledWorkbooks.has(file)) {
        showCancelled();

        return null;
    }

    if (!defaultPasswordTried.has(file)) {
        defaultPasswordTried.add(file);
        showUnlocking();
        await waitForPaintAsync(BROWSER_CLOCK);
        const opened = await encryption.unlockAsync(EXCEL_DEFAULT_PASSWORD);

        if (opened != null) {
            rememberUnlocked(file, opened);

            return isCurrent() ? opened : null;
        }
    }

    const plain = await askForPasswordAsync({
        title: WORKBOOK_PASSWORD_TITLE,
        fileName: input.fileName,
        show: showLocked,
        showUnlocking,
        tryPasswordAsync: async (password) => await encryption.unlockAsync(password),
        isCurrent,
    });

    if (plain != null) {
        rememberUnlocked(file, plain);

        return isCurrent() ? plain : null;
    }

    if (isCurrent()) {
        cancelledWorkbooks.add(file);
        showCancelled();
    }

    return null;
}

function renderErrorCard(container: HTMLElement, error: unknown, title = 'Preview not available'): void {
    renderMessage(container, title, errorMessage(error));
}

function renderMessage(container: HTMLElement, title: string, message: string): void {
    container.append(h('div', {
        class: 'editor-placeholder',
        children: [
            h('h2', { text: title }),
            h('p', { text: message }),
        ],
    }));
}
