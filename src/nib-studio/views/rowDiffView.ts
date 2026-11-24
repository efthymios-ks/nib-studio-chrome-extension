import { formatMegabytes, isLargeTableFile, LARGE_TABLE_FILE_BYTES } from '../../common/csv/csvLimits.js';
import { parseCsvStreamAsync } from '../../common/csv/csvParser.js';
import type { DiffCell, DiffChange, DiffColumn, DiffRow, RowsDiffDocument } from '../../common/diff/diffDocument.js';
import { buildRowsDiffDocument } from '../../common/diff/rowDiffDocument.js';
import { basename, extension } from '../../common/fs/fileEntry.js';
import { resolveFileType } from '../../common/fs/fileTypes.js';
import { loadWorkbookAsync } from '../../common/office/xlsxLoader.js';
import { clear, h } from '../app/dom.js';
import type { DiffSide } from '../app/store.js';
import { toast } from '../app/toast.js';
import { navigationChangesOf } from './diffChanges.js';
import { attachDiffNavigation, compareSize, scheduleDiffRender } from './diffNavigationBar.js';
import { showRuleDialogAsync, sortFieldNames } from './diffRulePicker.js';
import { rememberScroll } from './diffScroll.js';
import { buildDiffSideHeader, diffDocumentSide, diffDocumentSidesKey, diffSideName, type DiffSideName } from './diffSideHeader.js';
import { buildDiffToolbarSides } from './diffToolbar.js';
import type { DiffViewInput, LoadedRowSet, RowDiffViewState } from './diffViewState.js';
import { emptyState } from './emptyState.js';
import { buildSortKeysToggle } from './jsonDiffView.js';

export type RowDiffViewInput = DiffViewInput<RowDiffViewState>;

export type RowDiffDocumentSource = Pick<RowDiffViewInput, 'original' | 'modified' | 'state'>;

export interface RowDiffPickResult {
    readonly path: string;
    readonly file: File | null;
    readonly text: string | null;
}

const renderTokens = new WeakMap<HTMLElement, object>();

async function loadRowSetAsync(pick: RowDiffPickResult): Promise<LoadedRowSet | null> {
    const ext = extension(pick.path);

    if (ext === 'csv' || ext === 'tsv') {
        if (pick.text == null && pick.file != null && isLargeTableFile(pick.path, pick.file.size)) {
            toast(`${pick.path} is ${formatMegabytes(pick.file.size)}; row diff takes CSV and TSV files up to ${formatMegabytes(LARGE_TABLE_FILE_BYTES)}.`, 'warn');

            return null;
        }

        const text = pick.text ?? (pick.file != null ? await pick.file.text() : '');
        const parsed = await parseCsvStreamAsync(text, { hasHeader: true });
        const header = parsed.header ?? parsed.rows[0]?.map((_, index) => `column-${index + 1}`) ?? [];

        return {
            path: pick.path,
            rowSet: {
                columns: header.map((column) => String(column)),
                rows: parsed.rows,
            },
        };
    }

    if (isSpreadsheetPath(pick.path)) {
        if (pick.file == null) {
            toast('A workbook row compare needs a File handle.', 'fail');

            return null;
        }

        const workbook = await loadWorkbookAsync(pick.file);
        const sheet = workbook.sheets[0];

        if (sheet == null) {
            toast('Workbook has no sheets.', 'fail');

            return null;
        }

        const [header, ...rest] = sheet.rows;
        const columns = (header ?? []).map((cell) => String(cell ?? ''));

        return {
            path: pick.path,
            rowSet: {
                columns,
                rows: rest.map((row) => row.slice()),
            },
        };
    }

    toast(`Row compare is for CSV/TSV/XLSX files only (${pick.path}).`, 'warn');

    return null;
}

// A side too large to load whole: workspace and disk CSVs over the row diff limit.
function isTooLargeForRowDiff(side: DiffSide | null): boolean {
    return side?.file != null && side.path != null && isLargeTableFile(side.path, side.file.size);
}

export function renderRowDiffView(container: HTMLElement, input: RowDiffViewInput): void {
    clear(container);

    const body = h('div', { class: 'row-diff-body' });
    container.append(buildToolbar(container, input), body);

    const large = [input.original, input.modified].find(isTooLargeForRowDiff) ?? null;

    if (large != null) {
        body.append(emptyState({
            title: 'File is too large for row diff',
            message: `Row diff loads both files into memory, so it takes CSV and TSV files up to ${formatMegabytes(LARGE_TABLE_FILE_BYTES)}. `
                + `${large.label} is ${formatMegabytes(large.file?.size ?? 0)}; use the Table view to search, filter and sort it.`,
        }));

        return;
    }

    const token = {};
    renderTokens.set(container, token);

    void (async () => {
        await ensureLoadedAsync(input);

        // A newer render of the same container won the race.
        if (renderTokens.get(container) !== token) {
            return;
        }

        clear(container);
        container.append(buildToolbar(container, input), body);
        renderBody(body, container, input);
        rememberScroll(container, input.state.scroll);
    })();
}

// The diff document of both files once they are read, or null when they can't be compared yet:
// a side is missing, too large or unreadable, or no key column is chosen.
export async function rowDiffDocumentForAsync(input: RowDiffDocumentSource): Promise<RowsDiffDocument | null> {
    if ([input.original, input.modified].some(isTooLargeForRowDiff)) {
        return null;
    }

    await ensureLoadedAsync(input);

    return currentRowsDiffDocument(input);
}

// Draws the diff again once the matching or sorting changed, comparing large files after a pause.
function recompute(host: HTMLElement, input: RowDiffViewInput): void {
    scheduleDiffRender(host, compareSize(input.original, input.modified), () => renderRowDiffView(host, input));
}

function sourceOf(side: DiffSide): string | File {
    return side.file ?? side.text ?? '';
}

// Parses each side once per source and suggests key columns until the user picks them.
async function ensureLoadedAsync(input: RowDiffDocumentSource): Promise<void> {
    const { state } = input;

    for (const which of ['original', 'modified'] as const) {
        const side = which === 'original' ? input.original : input.modified;

        if (side == null) {
            delete state.loaded[which];
            continue;
        }

        const source = sourceOf(side);

        if (state.loaded[which]?.source === source) {
            continue;
        }

        const path = side.source === 'clipboard' || side.source === 'paste' || side.path == null
            ? `${side.label}.${(side.text ?? '').includes('\t') ? 'tsv' : 'csv'}`
            : side.path;
        const rowSet = await loadRowSetAsync({
            path,
            file: side.file ?? null,
            text: side.file != null && isSpreadsheetPath(path) ? null : side.text ?? null,
        });
        state.loaded[which] = { source, rowSet };
    }

    if (!state.keysChosen) {
        const suggested = suggestKeyColumns(loadedOf(state, 'original'), loadedOf(state, 'modified'), state.keyColumns);

        // A new array only when the suggestion changes, so the cached document stays valid.
        if (suggested.join('\n') !== state.keyColumns.join('\n')) {
            state.keyColumns = suggested;
        }
    }
}

function loadedOf(state: RowDiffViewState, which: DiffSideName): LoadedRowSet | null {
    return state.loaded[which]?.rowSet ?? null;
}

// Excel workbooks and templates, and OpenDocument spreadsheets, which are read from their File.
function isSpreadsheetPath(path: string): boolean {
    return resolveFileType(basename(path)).id === 'excel';
}

function buildToolbar(host: HTMLElement, input: RowDiffViewInput): HTMLElement {
    const { state } = input;

    return h('div', {
        class: 'editor-toolbar',
        children: [
            ...buildDiffToolbarSides(input),
            buildKeyColumnPicker(host, input),
            buildSortKeysToggle(state, () => renderRowDiffView(host, input), 'Sort columns'),
        ],
    });
}

function buildKeyColumnPicker(host: HTMLElement, input: RowDiffViewInput): HTMLElement {
    const { state } = input;
    const none = 'none';
    const summary = `Match: ${state.keyColumns.join(', ') || none} · Sort rows: ${state.sortColumns.join(', ') || none}`;

    return h('button', {
        class: 'button row-diff-rules-button',
        attrs: { type: 'button', title: summary },
        text: summary,
        on: {
            click: () => {
                void editRowRulesAsync(host, input);
            },
        },
    });
}

async function editRowRulesAsync(host: HTMLElement, input: RowDiffViewInput): Promise<void> {
    const { state } = input;
    const result = await showRuleDialogAsync({
        target: 'rows',
        path: `${diffSideName(input.original)} ↔ ${diffSideName(input.modified)}`,
        fields: allColumnsOf(loadedOf(state, 'original'), loadedOf(state, 'modified')),
        matchBy: state.keyColumns,
        sortBy: state.sortColumns,
        existing: false,
    });

    if (result == null || result.action !== 'save') {
        return;
    }

    state.keyColumns = result.matchBy;
    state.sortColumns = result.sortBy;
    state.keysChosen = true;
    recompute(host, input);
}

// Every column of either file, de-duplicated and sorted by name.
function allColumnsOf(a: LoadedRowSet | null, b: LoadedRowSet | null): string[] {
    return sortFieldNames(new Set([...(a?.rowSet.columns ?? []), ...(b?.rowSet.columns ?? [])]));
}

// Builds the diff document once per input: kept until a side, the key or sort columns or the column order change.
function currentRowsDiffDocument(input: RowDiffDocumentSource): RowsDiffDocument | null {
    const { state } = input;
    const original = loadedOf(state, 'original');
    const modified = loadedOf(state, 'modified');

    if (input.original == null || input.modified == null || original == null || modified == null || state.keyColumns.length === 0) {
        return null;
    }

    const sides = diffDocumentSidesKey(input.original, input.modified);
    const cache = state.cache;

    if (
        cache != null
        && cache.original === original
        && cache.modified === modified
        && cache.keyColumns === state.keyColumns
        && cache.sortColumns === state.sortColumns
        && cache.sortKeys === state.sortKeys
        && cache.sides === sides
    ) {
        return cache.document;
    }

    const document = buildRowsDiffDocument({
        original: diffDocumentSide(input.original),
        modified: diffDocumentSide(input.modified),
        left: original.rowSet,
        right: modified.rowSet,
        keyColumns: state.keyColumns,
        sortColumns: state.sortColumns,
        ignoreColumns: state.ignoreColumns,
        sortColumnsByName: state.sortKeys,
    });
    state.cache = {
        original,
        modified,
        keyColumns: state.keyColumns,
        sortColumns: state.sortColumns,
        sortKeys: state.sortKeys,
        sides,
        document,
    };

    return document;
}

// The aligned table and its bar, or what stands in while a side is missing or the files can't be compared.
function renderBody(container: HTMLElement, host: HTMLElement, input: RowDiffViewInput): void {
    const { state, callbacks } = input;
    clear(container);

    const empty: DiffSideName | null = input.original == null ? 'original' : input.modified == null ? 'modified' : null;

    if (empty != null) {
        container.append(h('div', {
            class: 'aligned-headers',
            children: [buildDiffSideHeader('original', input.original), buildDiffSideHeader('modified', input.modified)],
        }));
        container.append(callbacks.targetDropZone?.((target) => callbacks.onSetSide(empty, target)) ?? emptyState({
            title: 'Pick two CSV / TSV / XLSX files',
            message: 'Use the toolbar to pick an original and a modified file. The compare runs as soon as both are in.',
        }));

        return;
    }

    if (loadedOf(state, 'original') == null || loadedOf(state, 'modified') == null) {
        container.append(emptyState({
            title: 'Could not read the files as rows',
            message: 'Row compare takes CSV, TSV and XLSX files.',
        }));

        return;
    }

    if (state.keyColumns.length === 0) {
        container.append(emptyState({
            title: 'Pick a key column',
            message: 'Row compare needs one or more shared columns to pair rows between the two files. Pick them from the toolbar.',
        }));

        return;
    }

    const document = currentRowsDiffDocument(input);

    if (document == null) {
        return;
    }

    const panel = h('div', { class: 'row-diff-table-panel', children: [buildAlignedTable(input, document)] });
    container.append(h('div', { class: 'row-diff-split', children: [panel] }));

    attachRowNavigation({
        panel,
        input,
        document,
        onRecompute: () => {
            state.cache = null;
            state.loaded = {};
            renderRowDiffView(host, input);
        },
    });
}

// Key of a table row as the table names it: the key column values, joined with ", ".
function rowKeyOf(row: DiffRow): string {
    return row.left?.label ?? row.right?.label ?? '';
}

// The change of a cell, by its row's key and its column, so every row with that key shows the values it had.
function cellChangeKey(key: string, column: string): string {
    return `${key}\u0000${column}`;
}

function buildAlignedTable(input: RowDiffViewInput, document: RowsDiffDocument): HTMLElement {
    const { state } = input;
    const span = String(document.columns.length + 1);
    const cellChanges = new Map(document.changes
        .filter((change) => change.location.column != null)
        .map((change) => [cellChangeKey(change.location.key ?? '', change.location.column ?? ''), change]));
    const table = h('table', { class: 'row-diff-table aligned-table' });

    table.append(h('thead', {
        children: [
            h('tr', {
                class: 'aligned-table-sides',
                children: [
                    h('th', { attrs: { colspan: span }, dataset: { side: 'original' }, children: [buildDiffSideHeader('original', input.original)] }),
                    h('th', { attrs: { colspan: span }, dataset: { side: 'modified' }, children: [buildDiffSideHeader('modified', input.modified)] }),
                ],
            }),
            h('tr', {
                children: [
                    ...headerCells(document.columns, 'original'),
                    ...headerCells(document.columns, 'modified'),
                ],
            }),
        ],
    }));

    const tbody = h('tbody');

    for (const row of document.rows) {
        const key = rowKeyOf(row);
        const dataset: Record<string, string> = { diffKey: key };
        const marker = markerOf(row);

        if (marker != null) {
            dataset['marker'] = marker;
        }

        if (state.activeDiffKey === key) {
            dataset['active'] = 'true';
        }

        tbody.append(h('tr', {
            dataset,
            children: [
                ...rowCells({ cell: row.left, key, columns: document.columns, cellChanges, side: 'original' }),
                ...rowCells({ cell: row.right, key, columns: document.columns, cellChanges, side: 'modified' }),
            ],
        }));
    }

    table.append(tbody);

    return h('div', {
        class: 'row-diff-pane-body aligned-scroller',
        dataset: { scrollKey: 'rows' },
        attrs: { tabindex: '0', role: 'region', 'aria-label': 'Both files, row for row' },
        children: [table],
    });
}

// A row only one file has is added or removed; a row with a changed value is changed.
function markerOf(row: DiffRow): string | null {
    if (row.left?.status === 'removed') {
        return 'removed';
    }

    if (row.right?.status === 'added') {
        return 'added';
    }

    return row.left?.status === 'changed' || row.right?.status === 'changed' ? 'changed' : null;
}

function headerCells(columns: ReadonlyArray<DiffColumn>, side: DiffSideName): HTMLElement[] {
    return [
        h('th', { class: 'row-diff-key', dataset: { side }, text: '#' }),
        ...columns.map((column) => h('th', {
            dataset: column[side] ? { side } : { side, placeholder: 'true' },
            attrs: column[side] ? {} : { title: `${column.name} is not in this file` },
            text: column[side] ? column.name : '',
        })),
    ];
}

interface RowCellsOptions {
    readonly cell: DiffCell | null;
    readonly key: string;
    readonly columns: ReadonlyArray<DiffColumn>;
    readonly cellChanges: ReadonlyMap<string, DiffChange>;
    readonly side: DiffSideName;
}

// One side of a table row; its last cell is marked as the side's end, where a ring around the row closes.
function rowCells(options: RowCellsOptions): HTMLElement[] {
    const { cell, side } = options;
    const cells = cell == null
        ? [
            h('td', { class: 'row-diff-key', dataset: { side, placeholder: 'true' } }),
            ...options.columns.map(() => h('td', { dataset: { side, placeholder: 'true' } })),
        ]
        : [
            h('td', { class: 'row-diff-key', dataset: { side }, text: options.key }),
            ...cell.tokens.map((token) => {
                if (token == null) {
                    return h('td', { dataset: { side, placeholder: 'true' } });
                }

                const column = token.column ?? '';
                const change = token.status === 'changed' ? options.cellChanges.get(cellChangeKey(options.key, column)) : undefined;

                return h('td', {
                    dataset: token.status === 'changed' ? { side, column, changed: 'true' } : { side, column },
                    attrs: change == null ? {} : { title: `Original: ${shownValue(change.before)}\nModified: ${shownValue(change.after)}` },
                    text: token.text,
                });
            }),
        ];
    const last = cells[cells.length - 1];

    if (last != null) {
        last.dataset['edge'] = 'end';
    }

    return cells;
}

function shownValue(value: unknown): string {
    return value == null || value === '' ? '∅' : String(value);
}

interface RowNavigationOptions {
    readonly panel: HTMLElement;
    readonly input: RowDiffViewInput;
    readonly document: RowsDiffDocument;
    readonly onRecompute: () => void;
}

// The bar over the aligned table, stepping from the top row down: a whole row, or both cells of a changed value.
function attachRowNavigation(options: RowNavigationOptions): void {
    const { panel, input } = options;
    const { state } = input;
    const scroller = panel.querySelector<HTMLElement>('.aligned-scroller') ?? panel;
    const rows = Array.from(scroller.querySelectorAll<HTMLElement>('tbody tr'));
    const byId = new Map(options.document.changes.map((change) => [change.id, change]));
    const rowOf = (change: DiffChange | undefined): HTMLElement | null => change?.row == null ? null : rows[change.row] ?? null;

    const changes = navigationChangesOf(options.document.changes, {
        labelled: true,
        locate: (change) => {
            const row = rowOf(change);
            const column = change.location.column;

            if (row == null) {
                return [];
            }

            if (column == null) {
                return [row];
            }

            return Array
                .from(row.querySelectorAll<HTMLElement>('td[data-column]'))
                .filter((cell) => cell.dataset['column'] === column);
        },
    });

    attachDiffNavigation({
        host: panel,
        scroller,
        keyScope: panel,
        state: state.navigation,
        rowSelector: 'tbody tr',
        changes: () => changes,
        onMove: (change) => {
            const active = rowOf(byId.get(change.id));
            state.activeDiffKey = active?.dataset['diffKey'] ?? null;

            for (const row of scroller.querySelectorAll<HTMLElement>('tbody tr[data-active]')) {
                delete row.dataset['active'];
            }

            if (active != null) {
                active.dataset['active'] = 'true';
            }
        },
        onRecompute: options.onRecompute,
    });
}

function suggestKeyColumns(original: LoadedRowSet | null, modified: LoadedRowSet | null, current: ReadonlyArray<string>): string[] {
    const shared = sharedColumnsOf(original, modified);

    if (shared.length === 0) {
        return [];
    }

    const preferred = ['id', 'key', 'code', 'sku', 'uuid', 'name'];

    for (const candidate of preferred) {
        const match = shared.find((column) => column.toLowerCase() === candidate);

        if (match != null) {
            return [match];
        }
    }

    const existing = current.filter((column) => shared.includes(column));

    return existing.length > 0 ? existing : [shared[0] as string];
}

function sharedColumnsOf(a: LoadedRowSet | null, b: LoadedRowSet | null): string[] {
    if (a == null || b == null) {
        return a?.rowSet.columns.slice() ?? b?.rowSet.columns.slice() ?? [];
    }

    return a.rowSet.columns.filter((column) => b.rowSet.columns.includes(column));
}
