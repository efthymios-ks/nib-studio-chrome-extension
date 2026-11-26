import { resolveFileType } from '../../common/fs/fileTypes.js';
import { renderTableView, type TableColumn, type TableFilter, type TableSort, type TableViewMemory } from './tableView.js';
import { LargeCsvSource } from './largeCsvSource.js';
import { parseCsvStreamAsync } from '../../common/csv/csvParser.js';
import { isLargeTableFile, throwIfAborted } from '../../common/csv/csvLimits.js';
import { createArrayTableSource, createCsvTableSource } from '../../common/linq/linqSources.js';
import { EXCEL_DEFAULT_PASSWORD, readWorkbookEncryption } from '../../common/office/encryption/officeEncryption.js';
import type { PasswordEncryption } from '../../common/office/encryption/officeEncryptionTypes.js';
import { rememberUnlocked, unlockedBytesOf } from '../../common/office/encryption/unlockedFiles.js';
import { cachedWorkbookOf, readWorkbook, rememberWorkbook, type Sheet, type Workbook } from '../../common/office/xlsxLoader.js';
import { clear, h } from '../app/dom.js';
import { errorMessage } from '../../common/errorMessage.js';
import { readTextBlobAsync } from '../../common/text/textEncoding.js';
import { createPasswordCancelled } from './passwordPanel.js';
import { askForPasswordAsync, waitForPaintAsync } from './passwordUnlock.js';
import { BROWSER_CLOCK } from './previewZoomController.js';
import { renderTableWorkspace, type QueryTable, type SheetMemory, type TableWorkspaceHandle } from './queryPanel.js';

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

// What each open table file keeps while its tab is open, so leaving the tab and coming back restores it:
// the sort, filters, search, columns and scroll of each sheet, the sheet on screen and the hidden sheets shown.
interface FileTableMemory {
    // By sheet name; '' for the one table of a CSV or TSV file.
    readonly tables: Map<string, TableViewMemory>;
    readonly sheets: SheetMemory;
    // The sheet on screen as the status bar names it, such as `Sheet 2 of 3 · Q2`; null for a file of one table.
    sheetLabel: string | null;
}

// The headers and rows of a sheet, as the table shows them.
interface SheetTable {
    readonly sheet: Sheet;
    readonly names: ReadonlyArray<string>;
    readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
}

// A table is drawn again each time its tab or view comes back, so the index, block cache and view settings
// of a large file are kept per File snapshot instead of being rebuilt each time.
const largeTables = new WeakMap<File, Promise<LargeTableEntry>>();

const tableMemories = new Map<string, FileTableMemory>();

// The workspace on screen for each file, so a sheet can be shown from outside, as Lookup does.
const liveWorkspaces = new Map<string, TableWorkspaceHandle>();

const sheetLabelListeners = new Set<() => void>();

// The sheets of each workbook as tables, made once per workbook read.
const sheetTables = new WeakMap<Workbook, ReadonlyArray<SheetTable>>();

// How many times each container was rendered into, so a password flow stops once the container shows something else.
const renderCounts = new WeakMap<HTMLElement, number>();

// Workbooks whose password panel was cancelled, so the pane shows the same step when it renders again.
const cancelledWorkbooks = new WeakSet<File>();

// Workbooks Excel's own password was tried on, so it is tried once per snapshot.
const defaultPasswordTried = new WeakSet<File>();

function fileMemoryFor(key: string): FileTableMemory {
    let memory = tableMemories.get(key);

    if (memory == null) {
        memory = { tables: new Map(), sheets: {}, sheetLabel: null };
        tableMemories.set(key, memory);
    }

    return memory;
}

// What the table of a file, or of one sheet of a workbook, keeps while the file's tab is open.
export function tableMemoryFor(key: string, sheet = ''): TableViewMemory {
    const tables = fileMemoryFor(key).tables;
    let memory = tables.get(sheet);

    if (memory == null) {
        memory = {};
        tables.set(sheet, memory);
    }

    return memory;
}

// The sheet a workbook's tab shows, and the hidden sheets it shows.
function sheetMemoryFor(key: string): SheetMemory {
    return fileMemoryFor(key).sheets;
}

// The sheet on screen in a workbook's tab, such as `Sheet 2 of 3 · Q2`;
// null for a file of one table, or one not drawn yet.
export function sheetLabelOf(key: string): string | null {
    return tableMemories.get(key)?.sheetLabel ?? null;
}

// The name of the sheet a workbook's tab shows; null when its tab isn't open or shows the first sheet it opened on.
export function activeSheetOf(key: string): string | null {
    return tableMemories.get(key)?.sheets.activeSheet ?? null;
}

// Calls `listener` whenever a tab moves to another sheet; returns the function that stops it.
export function onSheetLabelChange(listener: () => void): () => void {
    sheetLabelListeners.add(listener);

    return () => {
        sheetLabelListeners.delete(listener);
    };
}

// Shows a sheet in a workbook's open tab: at once when the tab is on screen, otherwise when it is drawn next.
export function revealSheet(key: string, sheet: string): void {
    sheetMemoryFor(key).activeSheet = sheet;
    const live = liveWorkspaces.get(key);

    if (live != null && live.isConnected()) {
        live.showSheet(sheet);
    }
}

// Forgets the tables whose tabs closed.
export function pruneTableMemories(openKeys: ReadonlyArray<string>): void {
    const keep = new Set(openKeys);

    for (const key of [...tableMemories.keys()]) {
        if (!keep.has(key)) {
            tableMemories.delete(key);
            liveWorkspaces.delete(key);
        }
    }
}

function announceSheet(key: string, label: string | null): void {
    const memory = fileMemoryFor(key);

    if (memory.sheetLabel === label) {
        return;
    }

    memory.sheetLabel = label;

    for (const listener of [...sheetLabelListeners]) {
        listener();
    }
}

// Lays out the tables of a file with the query panel, keeping the workspace so a sheet can be shown from outside.
function renderWorkspace(container: HTMLElement, key: string, tables: ReadonlyArray<QueryTable>): void {
    const workspace = renderTableWorkspace(container, {
        key,
        tables,
        sheetMemory: sheetMemoryFor(key),
        onSheetChange: (label) => announceSheet(key, label),
    });
    liveWorkspaces.set(key, workspace);
}

function keyOf(input: TableViewerInput): string {
    return input.path ?? input.fileName;
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

    renderWorkspace(container, keyOf(input), [{
        name: null,
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
        renderTable: (host, chrome) => renderTableView(host, {
            ...chrome,
            columns,
            largeSource: source,
            initialFilters: entry.filters,
            initialSort: entry.sorts,
            initialSearch: entry.search,
            memory: tableMemoryFor(keyOf(input)),
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
    }]);
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

interface InMemoryTableOptions {
    readonly key: string;
    // The sheet's name in a workbook; null for a CSV or TSV file.
    readonly sheet: string | null;
    readonly hidden?: boolean;
    readonly names: ReadonlyArray<string>;
    readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
}

// A table of rows held in memory: a CSV or TSV file, or one sheet of a workbook.
function inMemoryTable(options: InMemoryTableOptions): QueryTable {
    const { names, rows } = options;
    const columns: TableColumn[] = names.map((name, index) => ({ id: `col-${index}`, title: name }));

    return {
        name: options.sheet,
        hidden: options.hidden === true,
        columns: names,
        loadSourceAsync: async () => createArrayTableSource(names, rows),
        loadSampleRowsAsync: async () => rows.slice(0, QUERY_SAMPLE_ROWS),
        renderTable: (host, chrome) => renderTableView(host, {
            ...chrome,
            columns,
            getAllRows: () => rows,
            totalRowCount: rows.length,
            memory: tableMemoryFor(options.key, options.sheet ?? ''),
        }),
    };
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

    renderWorkspace(container, keyOf(input), [inMemoryTable({ key: keyOf(input), sheet: null, names, rows: result.rows })]);
}

async function renderXlsxTableAsync(container: HTMLElement, input: TableViewerInput): Promise<void> {
    if (input.file == null) {
        renderErrorCard(container, new Error('An XLSX workbook requires a File handle.'));

        return;
    }

    const file = input.file;
    // A workbook already read from this snapshot shows at once, without reading or parsing it again.
    const cached = cachedWorkbookOf(file);

    if (cached != null) {
        renderWorkbook(container, input, cached);

        return;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const encryption = readWorkbookEncryption(bytes);

    if (encryption == null) {
        renderWorkbook(container, input, rememberWorkbook(file, readWorkbook(bytes)));

        return;
    }

    if (encryption.kind === 'unsupported') {
        renderMessage(container, UNSUPPORTED_WORKBOOK_TITLE, `${encryption.reason} Open it in Excel to read it.`);

        return;
    }

    const plain = await unlockWorkbookAsync(container, input, file, encryption);

    if (plain != null) {
        clear(container);
        renderWorkbook(container, input, rememberWorkbook(file, readWorkbook(plain)));
    }
}

// Each sheet as a table: its first row names the columns, and an empty header cell is named by its place.
function sheetTablesOf(workbook: Workbook): ReadonlyArray<SheetTable> {
    let tables = sheetTables.get(workbook);

    if (tables == null) {
        tables = workbook.sheets.map((sheet) => ({
            sheet,
            names: (sheet.rows[0] ?? []).map((name, index) => (name == null || String(name).trim() === ''
                ? `Column ${index + 1}`
                : String(name))),
            rows: sheet.rows.slice(1),
        }));
        sheetTables.set(workbook, tables);
    }

    return tables;
}

function renderWorkbook(container: HTMLElement, input: TableViewerInput, workbook: Workbook): void {
    const tables = sheetTablesOf(workbook);

    if (tables.length === 0) {
        renderErrorCard(container, new Error('Workbook has no sheets.'));

        return;
    }

    const key = keyOf(input);
    renderWorkspace(container, key, tables.map((table) => inMemoryTable({
        key,
        sheet: table.sheet.name,
        hidden: table.sheet.hidden,
        names: table.names,
        rows: table.rows,
    })));
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
