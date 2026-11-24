import { isAbortError } from '../../common/csv/csvLimits.js';
import { clear, h } from '../app/dom.js';
import { errorMessage } from '../../common/errorMessage.js';
import { applyFilters, type TableFilter, type TableFilterOperator } from './tableFilters.js';
import { cycleSort, sortRows, type TableSort } from './tableSort.js';
import { computeVirtualWindow, scrollTopForRow } from './virtualWindow.js';

export type { TableFilter, TableFilterOperator } from './tableFilters.js';
export type { TableSort } from './tableSort.js';

export interface TableColumn {
    readonly id: string;
    readonly title: string;
    readonly width?: number;
    readonly hidden?: boolean;
    readonly pinned?: boolean;
    readonly align?: 'left' | 'right' | 'center';
}

export interface TableLargeQuery {
    readonly filters: ReadonlyArray<{ readonly columnIndex: number; readonly filter: TableFilter }>;
    readonly search: string;
    readonly searchColumns: ReadonlyArray<number>;
    readonly sorts: ReadonlyArray<{ readonly columnIndex: number; readonly direction: 'asc' | 'desc' }>;
}

export interface TableLargeQueryProgress {
    readonly phase: 'indexing' | 'scanning' | 'sorting';
    readonly done: number;
    readonly total: number;
    // Matching rows found so far while scanning.
    readonly matches?: Uint32Array;
}

export interface TableLargeQueryOptions {
    readonly signal: AbortSignal;
    readonly onProgress: (progress: TableLargeQueryProgress) => void;
}

export interface TableLargeQueryResult {
    // Row numbers in display order, or null for every row in file order.
    readonly rows: Uint32Array | null;
    readonly warning?: string;
}

// A row source too big to hold in memory: rows are read on demand and queries stream over the file.
export interface TableLargeSource {
    readonly getRowCount: () => number;
    readonly isIndexing: () => boolean;
    readonly getIndexProgress: () => number;
    readonly subscribe: (listener: () => void) => () => void;
    readonly getCachedRow: (row: number) => ReadonlyArray<unknown> | undefined;
    readonly readRowsAsync: (rows: ArrayLike<number>) => Promise<ReadonlyArray<ReadonlyArray<unknown>>>;
    readonly queryAsync: (query: TableLargeQuery, options: TableLargeQueryOptions) => Promise<TableLargeQueryResult>;
}

export interface TableViewOptions {
    readonly columns: ReadonlyArray<TableColumn>;
    readonly onFilterChange?: (filters: ReadonlyArray<TableFilter>) => void;
    readonly onSortChange?: (sort: ReadonlyArray<TableSort>) => void;
    readonly onSearchChange?: (search: string) => void;
    readonly initialFilters?: ReadonlyArray<TableFilter>;
    readonly initialSort?: ReadonlyArray<TableSort>;
    readonly initialSearch?: string;
    readonly totalRowCount?: number;
    // The whole row set, in memory: sort, filter and search cover every row and only the rendering is paged.
    readonly getAllRows?: () => ReadonlyArray<ReadonlyArray<unknown>>;
    // When set, rows are virtualised and read on demand instead.
    readonly largeSource?: TableLargeSource;
    // Extra controls for the right end of the toolbar, such as the Query toggle.
    readonly toolbarExtras?: () => ReadonlyArray<HTMLElement>;
    // Kept by the caller per file: the view starts from it and writes back to it, so leaving the tab and returning restores it.
    readonly memory?: TableViewMemory;
}

export interface TableViewMemory {
    columnOrder?: string[];
    hiddenColumns?: string[];
    pinnedColumns?: string[];
    columnWidths?: Array<[string, number]>;
    filters?: TableFilter[];
    sorts?: TableSort[];
    search?: string;
    renderLimit?: number;
    scrollTop?: number;
    scrollLeft?: number;
}

export interface TableHandle {
    readonly refresh: () => void;
    readonly destroy: () => void;
    readonly getFilters: () => ReadonlyArray<TableFilter>;
    readonly getSort: () => ReadonlyArray<TableSort>;
    readonly getColumnOrder: () => ReadonlyArray<string>;
    readonly getHiddenColumns: () => ReadonlyArray<string>;
    readonly reset: () => void;
}

type QueryPhase = 'idle' | TableLargeQueryProgress['phase'];

interface ViewState {
    columnOrder: string[];
    hiddenColumns: Set<string>;
    pinnedColumns: Set<string>;
    columnWidths: Map<string, number>;
    filters: TableFilter[];
    sorts: TableSort[];
    search: string;
    renderLimit: number;
    resultRows: Uint32Array | null;
    queryPhase: QueryPhase;
    queryDone: number;
    queryTotal: number;
    notice: string | null;
    highlightRow: number | null;
}

const RENDER_PAGE_SIZE = 200;
const DEFAULT_COLUMN_WIDTH = 140;
const MIN_COLUMN_WIDTH = 60;
const DISTINCT_VALUE_LIMIT = 50;
const AUTO_FIT_SAMPLE_ROWS = 5000;
const ROW_HEIGHT = 28;
const OVERSCAN_ROWS = 10;
const FALLBACK_VIEWPORT_HEIGHT = 600;
const MAX_SCROLL_HEIGHT = 8_000_000;
const DISTINCT_SAMPLE_ROWS = 2000;
const COPY_ROW_LIMIT = 100_000;

export function renderTableView(container: HTMLElement, options: TableViewOptions): TableHandle {
    const state: ViewState = {
        columnOrder: options.columns.map((column) => column.id),
        hiddenColumns: new Set(options.columns.filter((column) => column.hidden === true).map((column) => column.id)),
        pinnedColumns: new Set(options.columns.filter((column) => column.pinned === true).map((column) => column.id)),
        columnWidths: new Map(options.columns.map((column) => [column.id, column.width ?? DEFAULT_COLUMN_WIDTH])),
        filters: options.initialFilters != null ? [...options.initialFilters] : [],
        sorts: options.initialSort != null ? [...options.initialSort] : [],
        search: options.initialSearch ?? '',
        renderLimit: RENDER_PAGE_SIZE,
        resultRows: null,
        queryPhase: 'idle',
        queryDone: 0,
        queryTotal: 0,
        notice: null,
        highlightRow: null,
    };
    const memory = options.memory;
    restoreTableMemory(state, memory, options.columns);

    const getAllRows = options.getAllRows;
    const largeSource = options.largeSource;
    const sourceRows = (): ReadonlyArray<ReadonlyArray<unknown>> => getAllRows?.() ?? [];
    const columnLookup = new Map(options.columns.map((column) => [column.id, column] as const));
    const columnIndexByIdList = options.columns.map((column, index) => [column.id, index] as const);
    const columnIndexById = new Map(columnIndexByIdList);

    const root = h('div', { class: 'table-view' });
    const toolbar = h('div', { class: 'table-toolbar' });
    const body = h('div', { class: 'table-body' });
    const status = h('div', { class: 'table-status' });

    if (largeSource != null) {
        root.dataset['virtual'] = 'true';
    }

    root.append(toolbar, body, status);
    clear(container);
    container.append(root);

    // Large-source rendering state: the tbody being windowed, the rows of the window by row number, and the running query.
    // The window keeps its rows itself, since a sorted window can need more blocks than the source's cache holds.
    let virtualBody: HTMLElement | null = null;
    let virtualColumns: ReadonlyArray<TableColumn> = [];
    let windowRows = new Map<number, ReadonlyArray<unknown>>();
    let fetchingRows = false;
    let framePending = false;
    let queryController: AbortController | null = null;
    let unsubscribeSource: (() => void) | null = null;

    const isNarrowed = (): boolean => state.filters.length > 0
        || state.sorts.length > 0
        || state.search.trim().length > 0;

    // Re-runs whatever depends on filters, sort or search: a streaming query for a large source, a redraw otherwise.
    const applyQuery = (): void => {
        if (largeSource != null) {
            void runLargeQueryAsync();
        }

        renderBody();
    };

    const renderToolbar = (): void => {
        clear(toolbar);

        const searchInput = h('input', {
            class: 'table-search',
            attrs: {
                type: 'search',
                placeholder: 'Search visible columns',
                title: 'Press Enter to search across visible columns',
            },
        }) as HTMLInputElement;
        searchInput.value = state.search;

        const runSearch = (): void => {
            if (searchInput.value === state.search) {
                return;
            }

            state.search = searchInput.value;
            options.onSearchChange?.(state.search);

            if (largeSource == null) {
                renderBody();

                return;
            }

            applyQuery();
        };

        searchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                runSearch();
            }
        });

        // Clearing the box, by the × button or by deleting everything, shows all rows again at once.
        searchInput.addEventListener('input', () => {
            if (searchInput.value === '') {
                runSearch();
            }
        });

        const resetButton = h('button', {
            class: 'button',
            text: 'Reset view',
            attrs: { type: 'button', title: 'Clear filters, sort, column order and widths' },
            on: {
                click: () => {
                    resetState();
                    options.onFilterChange?.(state.filters);
                    options.onSortChange?.(state.sorts);
                    options.onSearchChange?.(state.search);

                    if (largeSource != null) {
                        void runLargeQueryAsync();
                    }

                    renderAll();
                },
            },
        });

        const copyButton = h('button', {
            class: 'button',
            text: 'Copy as TSV',
            attrs: { type: 'button', title: 'Copy visible rows as TSV' },
            on: {
                click: () => {
                    void copyAsTsvAsync();
                },
            },
        });

        const columnsButton = h('button', {
            class: 'button',
            text: 'Columns',
            attrs: { type: 'button', title: 'Show, hide or pin columns' },
            on: {
                click: (event) => openColumnChooser(event as MouseEvent),
            },
        });

        const tools: HTMLElement[] = [searchInput];

        if (largeSource != null) {
            tools.push(buildGoToRowInput());
        }

        toolbar.append(
            ...tools,
            h('span', { class: 'table-toolbar-spacer' }),
            columnsButton,
            copyButton,
            resetButton,
            ...(options.toolbarExtras?.() ?? []),
        );
    };

    const buildGoToRowInput = (): HTMLElement => {
        const input = h('input', {
            class: 'table-goto',
            attrs: { type: 'number', min: '1', placeholder: 'Go to row', title: 'Jump to a row number and press Enter' },
        }) as HTMLInputElement;
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                goToRow(Number.parseInt(input.value, 10));
            }
        });

        return input;
    };

    const goToRow = (rowNumber: number): void => {
        if (largeSource == null || !Number.isFinite(rowNumber)) {
            return;
        }

        const row = rowNumber - 1;
        const position = state.resultRows == null
            ? (row >= 0 && row < largeSource.getRowCount() ? row : -1)
            : state.resultRows.indexOf(row);

        if (position < 0) {
            state.notice = row >= 0 && row < largeSource.getRowCount()
                ? `Row ${formatNumber(rowNumber)} is not in the current results.`
                : `There is no row ${formatNumber(rowNumber)}.`;
            renderStatus();

            return;
        }

        state.notice = null;
        state.highlightRow = row;
        body.scrollTop = scrollTopForRow(position, {
            viewportHeight: viewportHeight(),
            rowHeight: ROW_HEIGHT,
            rowCount: visibleCount(),
            maxScrollHeight: MAX_SCROLL_HEIGHT,
        });
        renderWindow();
        renderStatus();
    };

    const copyAsTsvAsync = async (): Promise<void> => {
        const columns = visibleColumns();
        let rows: ReadonlyArray<ReadonlyArray<unknown>>;

        if (largeSource == null) {
            rows = visibleRows();
        }
        else {
            const count = Math.min(visibleCount(), COPY_ROW_LIMIT);
            const wanted = new Uint32Array(count);

            for (let position = 0; position < count; position += 1) {
                wanted[position] = rowAt(position);
            }

            rows = await largeSource.readRowsAsync(wanted);
            state.notice = visibleCount() > COPY_ROW_LIMIT ? `Copied the first ${formatNumber(COPY_ROW_LIMIT)} rows.` : null;
            renderStatus();
        }

        const indexes = columns.map((column) => columnIndexById.get(column.id) ?? -1);
        const text = toTsv(columns, rows.map((row) => indexes.map((index) => (index >= 0 ? row[index] : ''))));

        if (navigator.clipboard != null) {
            await navigator.clipboard.writeText(text);
        }
    };

    const openColumnChooser = (anchor: MouseEvent): void => {
        closePopovers();
        const chooser = h('div', { class: 'table-popover table-column-chooser' });
        const list = h('div', { class: 'table-chooser-list' });
        positionPopover(chooser, anchor);
        fillColumnChooser(list);

        const resetColumnsButton = h('button', {
            class: 'button table-chooser-reset',
            text: 'Reset',
            attrs: { type: 'button', title: 'Show all columns, unpin all, restore the original order' },
            on: {
                click: () => {
                    resetColumns();
                    fillColumnChooser(list);
                    onColumnsChanged();
                },
            },
        });

        chooser.append(list, h('div', { class: 'table-popover-footer', children: [resetColumnsButton] }));
        document.body.append(chooser);
    };

    const fillColumnChooser = (list: HTMLElement): void => {
        clear(list);

        for (const columnId of state.columnOrder) {
            const column = columnLookup.get(columnId);

            if (column == null) {
                continue;
            }

            const visibilityCheckbox = h('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
            visibilityCheckbox.checked = !state.hiddenColumns.has(columnId);
            visibilityCheckbox.addEventListener('change', () => {
                if (visibilityCheckbox.checked) {
                    state.hiddenColumns.delete(columnId);
                }
                else {
                    state.hiddenColumns.add(columnId);
                }

                onColumnsChanged();
            });

            const pinCheckbox = h('input', { attrs: { type: 'checkbox', title: 'Pin to the left' } }) as HTMLInputElement;
            pinCheckbox.checked = state.pinnedColumns.has(columnId);
            pinCheckbox.addEventListener('change', () => {
                if (pinCheckbox.checked) {
                    state.pinnedColumns.add(columnId);
                }
                else {
                    state.pinnedColumns.delete(columnId);
                }

                renderBody();
            });

            list.append(h('label', {
                class: 'table-chooser-row',
                dataset: { columnId },
                children: [
                    visibilityCheckbox,
                    h('span', { class: 'table-chooser-name', text: column.title }),
                    h('span', { class: 'table-chooser-pin-label', text: 'pin' }),
                    pinCheckbox,
                ],
            }));
        }
    };

    // Search covers visible columns only, so showing or hiding one re-runs an active search.
    const onColumnsChanged = (): void => {
        if (largeSource != null && state.search.trim() !== '') {
            applyQuery();

            return;
        }

        renderBody();
    };

    const openFilterPopover = (column: TableColumn, anchor: MouseEvent): void => {
        closePopovers();
        const existing = state.filters.find((filter) => filter.columnId === column.id);
        const popover = h('div', { class: 'table-popover table-filter-popover' });
        positionPopover(popover, anchor);

        const operatorSelect = h('select', { class: 'input', attrs: { title: 'Operator' } }) as HTMLSelectElement;
        const operators: Array<{ value: TableFilterOperator; label: string }> = [
            { value: 'contains', label: 'contains' },
            { value: 'notContains', label: 'does not contain' },
            { value: 'equals', label: 'equals' },
            { value: 'startsWith', label: 'starts with' },
            { value: 'endsWith', label: 'ends with' },
            { value: 'eq', label: '= (number)' },
            { value: 'ne', label: '≠ (number)' },
            { value: 'lt', label: '< (number)' },
            { value: 'gt', label: '> (number)' },
            { value: 'between', label: 'between (number)' },
            { value: 'oneOf', label: 'one of (distinct values)' },
            { value: 'empty', label: 'is empty' },
            { value: 'notEmpty', label: 'is not empty' },
        ];

        for (const op of operators) {
            const option = h('option', { text: op.label, attrs: { value: op.value } }) as HTMLOptionElement;

            if (existing?.operator === op.value) {
                option.selected = true;
            }

            operatorSelect.append(option);
        }

        const valueInput = h('input', { class: 'input', attrs: { type: 'text', placeholder: 'Value' } }) as HTMLInputElement;
        valueInput.value = existing?.value == null ? '' : String(existing.value);

        const valueToInput = h('input', { class: 'input', attrs: { type: 'text', placeholder: 'Upper bound' } }) as HTMLInputElement;
        valueToInput.value = existing?.valueTo == null ? '' : String(existing.valueTo);

        const distinctList = h('div', { class: 'table-filter-distinct' });
        const applyButton = h('button', {
            class: 'button button-primary',
            text: 'Apply',
            attrs: { type: 'button' },
            on: {
                click: () => {
                    const op = operatorSelect.value as TableFilterOperator;
                    const next: TableFilter = {
                        columnId: column.id,
                        operator: op,
                        value: valueInput.value === '' ? undefined : valueInput.value,
                        valueTo: valueToInput.value === '' ? undefined : valueToInput.value,
                        values: collectCheckedDistinct(distinctList),
                    };
                    setFilter(column.id, next);
                    closePopovers();
                    applyQuery();
                },
            },
        });

        const clearButton = h('button', {
            class: 'button',
            text: 'Clear',
            attrs: { type: 'button' },
            on: {
                click: () => {
                    state.filters = state.filters.filter((filter) => filter.columnId !== column.id);
                    options.onFilterChange?.(state.filters);
                    closePopovers();
                    applyQuery();
                },
            },
        });

        operatorSelect.addEventListener('change', () => {
            updateFilterInputsVisibility(operatorSelect.value as TableFilterOperator, valueInput, valueToInput, distinctList);
        });

        popover.append(
            h('div', { class: 'table-popover-header', text: `Filter ${column.title}` }),
            operatorSelect,
            valueInput,
            valueToInput,
            distinctList,
            h('div', { class: 'table-popover-footer', children: [clearButton, applyButton] }),
        );
        document.body.append(popover);

        if (largeSource == null) {
            populateDistinctValues(distinctList, column, sourceRows(), false);
        }
        else {
            const count = Math.min(largeSource.getRowCount(), DISTINCT_SAMPLE_ROWS);
            const sample = new Uint32Array(count);

            for (let row = 0; row < count; row += 1) {
                sample[row] = row;
            }

            const fillSampledValuesAsync = async (): Promise<void> => {
                const rows = await largeSource.readRowsAsync(sample);

                if (distinctList.isConnected) {
                    populateDistinctValues(distinctList, column, rows, true);
                }
            };
            void fillSampledValuesAsync();
        }

        updateFilterInputsVisibility(operatorSelect.value as TableFilterOperator, valueInput, valueToInput, distinctList);
        valueInput.focus();
    };

    const populateDistinctValues = (
        list: HTMLElement,
        column: TableColumn,
        rows: ReadonlyArray<ReadonlyArray<unknown>>,
        sampled: boolean,
    ): void => {
        clear(list);
        const index = columnIndexById.get(column.id);

        if (index == null) {
            return;
        }

        const seen = new Set<string>();

        for (const row of rows) {
            const cell = row[index];
            const key = cell == null ? '' : String(cell);

            if (!seen.has(key)) {
                seen.add(key);
            }

            if (seen.size > DISTINCT_VALUE_LIMIT) {
                break;
            }
        }

        const existing = state.filters.find((filter) => filter.columnId === column.id);
        const checked = new Set((existing?.values ?? []).map((value) => (value == null ? '' : String(value))));

        for (const value of seen) {
            const checkbox = h('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
            checkbox.value = value;
            checkbox.checked = checked.has(value);
            list.append(h('label', {
                class: 'table-distinct-row',
                children: [checkbox, h('span', { text: value === '' ? '(empty)' : value })],
            }));
        }

        if (seen.size > DISTINCT_VALUE_LIMIT) {
            list.append(h('div', { class: 'table-distinct-note', text: `Showing first ${DISTINCT_VALUE_LIMIT} values.` }));
        }

        if (sampled) {
            list.append(h('div', { class: 'table-distinct-note', text: `Values come from the first ${formatNumber(DISTINCT_SAMPLE_ROWS)} rows.` }));
        }
    };

    const collectCheckedDistinct = (list: HTMLElement): ReadonlyArray<string> | undefined => {
        const checked: string[] = [];

        for (const input of list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
            if (input.checked) {
                checked.push(input.value);
            }
        }

        return checked.length === 0 ? undefined : checked;
    };

    const updateFilterInputsVisibility = (
        operator: TableFilterOperator,
        valueInput: HTMLInputElement,
        valueToInput: HTMLInputElement,
        distinctList: HTMLElement,
    ): void => {
        const needsValue = operator !== 'empty' && operator !== 'notEmpty' && operator !== 'oneOf';
        const needsRange = operator === 'between';
        const needsDistinct = operator === 'oneOf';
        valueInput.hidden = !needsValue;
        valueToInput.hidden = !needsRange;
        distinctList.hidden = !needsDistinct;
    };

    const setFilter = (columnId: string, next: TableFilter): void => {
        const remaining = state.filters.filter((filter) => filter.columnId !== columnId);
        state.filters = [...remaining, next];
        options.onFilterChange?.(state.filters);
    };

    const closePopovers = (): void => {
        for (const popover of document.querySelectorAll('.table-popover')) {
            popover.remove();
        }
    };

    const positionPopover = (popover: HTMLElement, anchor: MouseEvent): void => {
        watchOutsideClicks();
        popover.style.position = 'fixed';
        popover.style.visibility = 'hidden';
        popover.style.top = '0';
        popover.style.left = '0';
        requestAnimationFrame(() => clampPopoverInsideViewport(popover, anchor.clientX, anchor.clientY));
    };

    const clampPopoverInsideViewport = (popover: HTMLElement, x: number, y: number): void => {
        const margin = 8;
        const rect = popover.getBoundingClientRect();
        const maxLeft = window.innerWidth - rect.width - margin;
        const maxTop = window.innerHeight - rect.height - margin;
        const left = Math.min(Math.max(margin, x), Math.max(margin, maxLeft));
        const top = Math.min(Math.max(margin, y), Math.max(margin, maxTop));
        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
        popover.style.visibility = 'visible';
    };

    const renderStatus = (): void => {
        clear(status);

        if (largeSource != null) {
            renderLargeStatus(largeSource);

            return;
        }

        const total = options.totalRowCount ?? sourceRows().length;
        const visible = visibleRows().length;
        status.append(h('span', { class: 'table-row-badge', text: `${formatNumber(visible)} of ${formatNumber(total)} rows` }));
        appendFilterBadge();
    };

    const renderLargeStatus = (source: TableLargeSource): void => {
        const total = source.getRowCount();
        status.append(h('span', {
            class: 'table-row-badge',
            text: `${formatNumber(visibleCount())} of ${formatNumber(total)} rows`,
        }));
        appendFilterBadge();

        if (source.isIndexing()) {
            status.append(h('span', {
                class: 'table-loading',
                text: `Indexing… ${formatNumber(total)} rows so far (${formatPercent(source.getIndexProgress())})`,
            }));
        }

        const progress = formatPercent(state.queryTotal === 0 ? 0 : state.queryDone / state.queryTotal);

        if (state.queryPhase === 'scanning') {
            status.append(h('span', {
                class: 'table-loading',
                text: `${formatNumber(state.resultRows?.length ?? 0)} matches, scanning… ${progress}`,
            }));
        }
        else if (state.queryPhase === 'sorting') {
            status.append(h('span', { class: 'table-loading', text: `Sorting… ${progress}` }));
        }
        else if (state.queryPhase === 'indexing') {
            status.append(h('span', { class: 'table-loading', text: 'Waiting for indexing to finish…' }));
        }

        if (state.notice != null) {
            status.append(h('span', { class: 'table-notice', text: state.notice }));
        }
    };

    const appendFilterBadge = (): void => {
        if (state.filters.length > 0) {
            status.append(h('span', {
                class: 'table-filter-badge',
                text: state.filters.length === 1
                    ? `${state.filters.length} filter`
                    : `${state.filters.length} filters`,
            }));
        }
    };

    const visibleColumns = (): ReadonlyArray<TableColumn> => {
        const pinned: TableColumn[] = [];
        const unpinned: TableColumn[] = [];

        for (const columnId of state.columnOrder) {
            if (state.hiddenColumns.has(columnId)) {
                continue;
            }

            const column = columnLookup.get(columnId);

            if (column == null) {
                continue;
            }

            if (state.pinnedColumns.has(columnId)) {
                pinned.push(column);
            }
            else {
                unpinned.push(column);
            }
        }

        return [...pinned, ...unpinned];
    };

    const visibleRows = (): ReadonlyArray<ReadonlyArray<unknown>> => {
        let rows: ReadonlyArray<ReadonlyArray<unknown>> = applyFilters(sourceRows(), columnIndexById, state.filters);

        if (state.sorts.length > 0) {
            rows = sortRows(rows, columnIndexById, state.sorts);
        }

        if (state.search.trim().length === 0) {
            return rows;
        }

        const needle = state.search.toLowerCase();
        const indexes = visibleColumns().map((column) => columnIndexById.get(column.id) ?? -1);

        return rows.filter((row) => indexes.some((index) => {
            if (index < 0) {
                return false;
            }

            const cell = row[index];

            if (cell == null) {
                return false;
            }

            return String(cell).toLowerCase().includes(needle);
        }));
    };

    const visibleCount = (): number => state.resultRows?.length ?? largeSource?.getRowCount() ?? 0;

    const rowAt = (position: number): number => (state.resultRows == null ? position : state.resultRows[position] ?? 0);

    const viewportHeight = (): number => (body.clientHeight > 0 ? body.clientHeight : FALLBACK_VIEWPORT_HEIGHT);

    const buildLargeQuery = (): TableLargeQuery => ({
        filters: state.filters
            .map((filter) => ({ columnIndex: columnIndexById.get(filter.columnId) ?? -1, filter }))
            .filter((entry) => entry.columnIndex >= 0),
        search: state.search,
        searchColumns: visibleColumns().map((column) => columnIndexById.get(column.id) ?? -1).filter((index) => index >= 0),
        sorts: state.sorts
            .map((sort) => ({ columnIndex: columnIndexById.get(sort.columnId) ?? -1, direction: sort.direction }))
            .filter((entry) => entry.columnIndex >= 0),
    });

    // Sets the query state at once, then fills the rows as the scan reports them.
    const runLargeQueryAsync = async (): Promise<void> => {
        if (largeSource == null) {
            return;
        }

        queryController?.abort();
        const controller = new AbortController();
        queryController = controller;
        const query = buildLargeQuery();
        const narrowing = query.filters.length > 0 || query.search.trim() !== '';

        state.resultRows = narrowing ? new Uint32Array(0) : null;
        state.notice = null;
        state.highlightRow = null;
        state.queryPhase = narrowing || query.sorts.length > 0 ? 'scanning' : 'idle';
        state.queryDone = 0;
        state.queryTotal = 0;
        body.scrollTop = 0;

        try {
            const result = await largeSource.queryAsync(query, {
                signal: controller.signal,
                onProgress: (progress) => {
                    if (controller.signal.aborted) {
                        return;
                    }

                    if (!root.isConnected) {
                        controller.abort();

                        return;
                    }

                    state.queryPhase = progress.phase;
                    state.queryDone = progress.done;
                    state.queryTotal = progress.total;

                    if (progress.matches != null) {
                        state.resultRows = progress.matches;
                    }

                    scheduleFrame();
                },
            });

            if (controller.signal.aborted) {
                return;
            }

            state.resultRows = result.rows;
            state.notice = result.warning ?? null;
            state.queryPhase = 'idle';
            queryController = null;
            renderWindow();
            renderStatus();
        }
        catch (error: unknown) {
            if (controller.signal.aborted || isAbortError(error)) {
                return;
            }

            state.queryPhase = 'idle';
            state.notice = errorMessage(error);
            renderStatus();
        }
    };

    const scheduleFrame = (): void => {
        if (framePending) {
            return;
        }

        framePending = true;
        const run = (): void => {
            framePending = false;

            if (!root.isConnected) {
                return;
            }

            renderWindow();
            renderStatus();
        };

        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(run);
        }
        else {
            setTimeout(run, 16);
        }
    };

    const renderHeader = (table: HTMLTableElement, columns: ReadonlyArray<TableColumn>): void => {
        const thead = h('thead');
        const headerRow = h('tr');
        headerRow.append(h('th', { class: 'table-rownum-header', text: '#' }));

        for (const column of columns) {
            const width = state.columnWidths.get(column.id) ?? DEFAULT_COLUMN_WIDTH;
            const sortIndex = state.sorts.findIndex((sort) => sort.columnId === column.id);
            const sort = sortIndex >= 0 ? state.sorts[sortIndex] : null;
            const sortGlyph = sort == null ? '' : sort.direction === 'asc' ? ' ↑' : ' ↓';
            const hasFilter = state.filters.some((filter) => filter.columnId === column.id);
            const pinned = state.pinnedColumns.has(column.id);
            const labelSpan = h('span', { class: 'table-header-label', text: `${column.title}${sortGlyph}` });
            const filterIcon = h('button', {
                class: 'table-header-filter',
                text: '⚑',
                attrs: { type: 'button', title: `Filter ${column.title}` },
                on: {
                    click: (event) => {
                        event.stopPropagation();
                        openFilterPopover(column, event as MouseEvent);
                    },
                },
            });
            const resizer = h('span', {
                class: 'table-header-resizer',
                attrs: { title: 'Drag to resize, double-click to auto-fit' },
            });
            resizer.addEventListener('mousedown', (event) => startResize(event, column.id));
            resizer.addEventListener('dblclick', (event) => {
                event.stopPropagation();
                autoFit(column.id);
            });

            const th = h('th', {
                class: 'table-header-cell',
                attrs: {
                    style: `width: ${width}px`,
                    'data-column-id': column.id,
                    'data-pinned': pinned ? 'true' : null,
                    'data-filtered': hasFilter ? 'true' : null,
                    draggable: 'true',
                },
                children: [labelSpan, filterIcon, resizer],
            });

            th.addEventListener('click', (event) => {
                if ((event.target as HTMLElement).closest('.table-header-filter, .table-header-resizer')) {
                    return;
                }

                const isAdditive = (event as MouseEvent).shiftKey;
                state.sorts = [...cycleSort(state.sorts, column.id, isAdditive)];
                options.onSortChange?.(state.sorts);
                applyQuery();
            });

            th.addEventListener('dragstart', (event) => {
                event.dataTransfer?.setData('text/column-id', column.id);
                th.dataset['dragging'] = 'true';
            });
            th.addEventListener('dragend', () => {
                delete th.dataset['dragging'];
            });
            th.addEventListener('dragover', (event) => {
                event.preventDefault();
                th.dataset['dropTarget'] = 'true';
            });
            th.addEventListener('dragleave', () => {
                delete th.dataset['dropTarget'];
            });
            th.addEventListener('drop', (event) => {
                event.preventDefault();
                delete th.dataset['dropTarget'];
                const source = event.dataTransfer?.getData('text/column-id');

                if (source != null && source !== '' && source !== column.id) {
                    moveColumn(source, column.id);
                }
            });

            headerRow.append(th);
        }

        thead.append(headerRow);
        table.append(thead);
    };

    const startResize = (event: MouseEvent, columnId: string): void => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startWidth = state.columnWidths.get(columnId) ?? DEFAULT_COLUMN_WIDTH;

        const onMove = (move: MouseEvent): void => {
            const delta = move.clientX - startX;
            state.columnWidths.set(columnId, Math.max(MIN_COLUMN_WIDTH, startWidth + delta));
            applyWidthToDom(columnId);
        };

        const onUp = (): void => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };

    const applyWidthToDom = (columnId: string): void => {
        const width = state.columnWidths.get(columnId) ?? DEFAULT_COLUMN_WIDTH;
        const th = body.querySelector<HTMLElement>(`th[data-column-id="${columnId}"]`);

        if (th != null) {
            th.style.width = `${width}px`;
        }
    };

    const autoFitSample = (): ReadonlyArray<ReadonlyArray<unknown>> => {
        if (largeSource == null) {
            return sourceRows().slice(0, AUTO_FIT_SAMPLE_ROWS);
        }

        return [...windowRows.values()];
    };

    const autoFit = (columnId: string): void => {
        const index = columnIndexById.get(columnId);

        if (index == null) {
            return;
        }

        const column = columnLookup.get(columnId);
        const header = column?.title ?? '';
        let maxChars = header.length;

        for (const row of autoFitSample()) {
            const cell = row[index];
            const text = cell == null ? '' : String(cell);

            if (text.length > maxChars) {
                maxChars = text.length;
            }
        }

        const estimated = Math.min(600, Math.max(MIN_COLUMN_WIDTH, maxChars * 8 + 24));
        state.columnWidths.set(columnId, estimated);
        renderBody();
    };

    const moveColumn = (sourceId: string, targetId: string): void => {
        const from = state.columnOrder.indexOf(sourceId);
        const to = state.columnOrder.indexOf(targetId);

        if (from < 0 || to < 0) {
            return;
        }

        const next = state.columnOrder.slice();
        next.splice(from, 1);
        next.splice(to, 0, sourceId);
        state.columnOrder = next;
        renderBody();
    };

    const buildRow = (
        rowNumber: number,
        row: ReadonlyArray<unknown>,
        columns: ReadonlyArray<TableColumn>,
        columnIndexes: ReadonlyArray<number>,
    ): HTMLElement => {
        const tr = h('tr');
        tr.append(h('td', { class: 'table-rownum', text: String(rowNumber) }));

        for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
            const column = columns[columnIndex];
            const dataIndex = columnIndexes[columnIndex];

            if (column == null || dataIndex == null) {
                continue;
            }

            const value = dataIndex >= 0 ? row[dataIndex] : '';
            const pinned = state.pinnedColumns.has(column.id);
            tr.append(h('td', {
                class: 'table-cell',
                text: value == null ? '' : String(value),
                attrs: { 'data-align': column.align ?? 'left', 'data-pinned': pinned ? 'true' : null },
            }));
        }

        return tr;
    };

    const renderBody = (): void => {
        saveTableMemory(state, memory);

        if (largeSource != null) {
            renderVirtualBody();

            return;
        }

        clear(body);
        const table = h('table', { class: 'table-grid' }) as HTMLTableElement;
        const columns = visibleColumns();
        const rows = visibleRows().slice(0, state.renderLimit);

        renderHeader(table, columns);

        const tbody = h('tbody');
        const columnIndexes = columns.map((column) => columnIndexById.get(column.id) ?? -1);

        for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
            const row = rows[rowIndex];

            if (row == null) {
                continue;
            }

            tbody.append(buildRow(rowIndex + 1, row, columns, columnIndexes));
        }

        table.append(tbody);
        body.append(table);
        renderStatus();
    };

    const renderVirtualBody = (): void => {
        const previousScroll = body.scrollTop;
        clear(body);
        const table = h('table', { class: 'table-grid' }) as HTMLTableElement;
        virtualColumns = visibleColumns();
        renderHeader(table, virtualColumns);
        virtualBody = h('tbody');
        table.append(virtualBody);
        body.append(table);
        body.scrollTop = previousScroll;
        renderWindow();
        renderStatus();
    };

    // Draws only the rows in view plus overscan, with spacer rows standing in for the rest.
    const renderWindow = (): void => {
        if (largeSource == null || virtualBody == null) {
            return;
        }

        const count = visibleCount();
        const range = computeVirtualWindow({
            scrollTop: body.scrollTop,
            viewportHeight: viewportHeight(),
            rowHeight: ROW_HEIGHT,
            rowCount: count,
            overscan: OVERSCAN_ROWS,
            maxScrollHeight: MAX_SCROLL_HEIGHT,
        });
        const columnIndexes = virtualColumns.map((column) => columnIndexById.get(column.id) ?? -1);
        const span = virtualColumns.length + 1;
        const missing: number[] = [];
        const inWindow = new Map<number, ReadonlyArray<unknown>>();
        const fragment = document.createDocumentFragment();

        if (range.topPadding > 0) {
            fragment.append(spacerRow(range.topPadding, span));
        }

        for (let position = range.start; position < range.end; position += 1) {
            const row = rowAt(position);
            const cells = windowRows.get(row) ?? largeSource.getCachedRow(row);

            if (cells != null) {
                inWindow.set(row, cells);
            }

            if (cells == null) {
                missing.push(row);
                fragment.append(h('tr', {
                    class: 'table-pending-row',
                    children: [
                        h('td', { class: 'table-rownum', text: String(row + 1) }),
                        h('td', { class: 'table-cell', attrs: { colspan: String(Math.max(1, span - 1)) }, text: '…' }),
                    ],
                }));
                continue;
            }

            const tr = buildRow(row + 1, cells, virtualColumns, columnIndexes);

            if (row === state.highlightRow) {
                tr.dataset['highlight'] = 'true';
            }

            fragment.append(tr);
        }

        if (range.bottomPadding > 0) {
            fragment.append(spacerRow(range.bottomPadding, span));
        }

        clear(virtualBody);
        virtualBody.append(fragment);
        windowRows = inWindow;

        if (missing.length > 0 && !fetchingRows) {
            fetchingRows = true;
            const fetchMissingRowsAsync = async (): Promise<void> => {
                // Rows fetched are added to the window's own, so reading them never pushes out rows already drawn.
                try {
                    const rows = await largeSource.readRowsAsync(missing);
                    missing.forEach((row, position) => windowRows.set(row, rows[position] ?? []));
                }
                catch {
                    // Unreadable rows render empty rather than being fetched again in a loop.
                    missing.forEach((row) => windowRows.set(row, []));
                }
                finally {
                    fetchingRows = false;

                    if (root.isConnected) {
                        renderWindow();
                    }
                }
            };
            void fetchMissingRowsAsync();
        }
    };

    const renderAll = (): void => {
        renderToolbar();
        renderBody();
    };

    const resetColumns = (): void => {
        state.columnOrder = options.columns.map((column) => column.id);
        state.hiddenColumns = new Set();
        state.pinnedColumns = new Set();
        state.columnWidths = new Map(options.columns.map((column) => [column.id, column.width ?? DEFAULT_COLUMN_WIDTH]));
    };

    const resetState = (): void => {
        resetColumns();
        state.filters = [];
        state.sorts = [];
        state.search = '';
    };

    body.addEventListener('scroll', () => {
        if (memory != null && root.isConnected) {
            memory.scrollTop = body.scrollTop;
            memory.scrollLeft = body.scrollLeft;
        }

        if (largeSource != null) {
            scheduleFrame();

            return;
        }

        if (body.scrollTop + body.clientHeight >= body.scrollHeight - 60 && state.renderLimit < visibleRows().length) {
            state.renderLimit += RENDER_PAGE_SIZE;
            renderBody();
        }
    });

    const dispose = (): void => {
        queryController?.abort();
        queryController = null;
        unsubscribeSource?.();
        unsubscribeSource = null;
    };

    if (largeSource != null) {
        unsubscribeSource = largeSource.subscribe(() => {
            if (!root.isConnected) {
                dispose();

                return;
            }

            scheduleFrame();
        });
    }

    renderAll();

    // Column resizes end on a pointer release without a body redraw.
    root.addEventListener('pointerup', () => saveTableMemory(state, memory));

    if (memory?.scrollTop != null || memory?.scrollLeft != null) {
        const saved = { top: memory.scrollTop ?? 0, left: memory.scrollLeft ?? 0 };
        const restoreScroll = (): void => {
            body.scrollTop = saved.top;
            body.scrollLeft = saved.left;
        };
        restoreScroll();

        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(restoreScroll);
        }
    }

    if (largeSource != null && isNarrowed()) {
        void runLargeQueryAsync();
        renderStatus();
    }

    return {
        refresh: () => renderAll(),
        destroy: () => {
            dispose();
            clear(container);
        },
        getFilters: () => state.filters.slice(),
        getSort: () => state.sorts.slice(),
        getColumnOrder: () => state.columnOrder.slice(),
        getHiddenColumns: () => [...state.hiddenColumns],
        reset: () => {
            resetState();

            if (largeSource != null) {
                void runLargeQueryAsync();
            }

            renderAll();
        },
    };
}

// Seeds the view from what it remembered for this file, keeping only columns the file still has.
function restoreTableMemory(state: ViewState, memory: TableViewMemory | undefined, columns: ReadonlyArray<TableColumn>): void {
    if (memory == null) {
        return;
    }

    const known = new Set(columns.map((column) => column.id));

    if (memory.columnOrder != null) {
        const kept = memory.columnOrder.filter((id) => known.has(id));
        state.columnOrder = [...kept, ...state.columnOrder.filter((id) => !kept.includes(id))];
    }

    if (memory.hiddenColumns != null) {
        state.hiddenColumns = new Set(memory.hiddenColumns.filter((id) => known.has(id)));
    }

    if (memory.pinnedColumns != null) {
        state.pinnedColumns = new Set(memory.pinnedColumns.filter((id) => known.has(id)));
    }

    for (const [id, width] of memory.columnWidths ?? []) {
        if (known.has(id)) {
            state.columnWidths.set(id, width);
        }
    }

    state.filters = memory.filters != null ? [...memory.filters] : state.filters;
    state.sorts = memory.sorts != null ? [...memory.sorts] : state.sorts;
    state.search = memory.search ?? state.search;
    state.renderLimit = Math.max(state.renderLimit, memory.renderLimit ?? 0);
}

function saveTableMemory(state: ViewState, memory: TableViewMemory | undefined): void {
    if (memory == null) {
        return;
    }

    memory.columnOrder = [...state.columnOrder];
    memory.hiddenColumns = [...state.hiddenColumns];
    memory.pinnedColumns = [...state.pinnedColumns];
    memory.columnWidths = [...state.columnWidths];
    memory.filters = [...state.filters];
    memory.sorts = [...state.sorts];
    memory.search = state.search;
    memory.renderLimit = state.renderLimit;
}

function spacerRow(height: number, span: number): HTMLElement {
    return h('tr', {
        class: 'table-spacer',
        attrs: { style: `height: ${height}px`, 'aria-hidden': 'true' },
        children: [h('td', { attrs: { colspan: String(span) } })],
    });
}

function toTsv(columns: ReadonlyArray<TableColumn>, rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
    const header = columns.map((column) => column.title).join('\t');
    const data = rows.map((row) => row.map((value) => (value == null ? '' : String(value))).join('\t'));

    return [header, ...data].join('\n');
}

function formatNumber(value: number): string {
    return value.toLocaleString('en-US');
}

function formatPercent(fraction: number): string {
    return `${Math.min(100, Math.floor(fraction * 100))}%`;
}

let outsideClickWatched = false;

// One document listener serves every table: a press outside any open popover closes them all.
function watchOutsideClicks(): void {
    if (outsideClickWatched) {
        return;
    }

    outsideClickWatched = true;
    document.addEventListener('mousedown', (event) => {
        const target = event.target as Element | null;

        if (target?.closest('.table-popover') != null) {
            return;
        }

        for (const popover of document.querySelectorAll('.table-popover')) {
            popover.remove();
        }
    }, true);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            for (const popover of document.querySelectorAll('.table-popover')) {
                popover.remove();
            }
        }
    });
}
