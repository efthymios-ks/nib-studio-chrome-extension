import { compareRecordsBy, compareRowSets, type RowDifference, type RowSet } from '../csv/rowCompare.js';
import {
    DIFF_DOCUMENT_FORMAT,
    DIFF_DOCUMENT_VERSION,
    summarizeChanges,
    type DiffCell,
    type DiffCellStatus,
    type DiffChange,
    type DiffDocumentSide,
    type DiffRow,
    type DiffToken,
    type RowsDiffDocument,
} from './diffDocument.js';
import { orderKeys } from './treeDiffRows.js';

export interface RowsDiffDocumentInput {
    readonly original: DiffDocumentSide;
    readonly modified: DiffDocumentSide;
    readonly left: RowSet;
    readonly right: RowSet;
    // Columns that pair a row with its counterpart; at least one.
    readonly keyColumns: ReadonlyArray<string>;
    // Orders the rows of both files by these columns, in priority order, before they pair.
    readonly sortColumns?: ReadonlyArray<string>;
    readonly ignoreColumns?: ReadonlyArray<string>;
    // Columns by name; file order unless set.
    readonly sortColumnsByName?: boolean;
}

// The row compare joins the key column values of a row with this.
const KEY_SEPARATOR = '\u001f';

interface NumberedRecord {
    readonly record: Readonly<Record<string, string>>;
    readonly line: number;
}

interface RowPair {
    readonly key: string;
    readonly left: NumberedRecord | null;
    readonly right: NumberedRecord | null;
}

export function buildRowsDiffDocument(input: RowsDiffDocumentInput): RowsDiffDocument {
    const sortColumns = input.sortColumns ?? [];
    const ignoreColumns = input.ignoreColumns ?? [];
    const sortColumnsByName = input.sortColumnsByName ?? false;
    const result = compareRowSets(input.left, input.right, { keyColumns: input.keyColumns, ignoreColumns, sortColumns });
    const columns = orderKeys(input.left.columns, input.right.columns, sortColumnsByName);
    const leftColumns = new Set(input.left.columns);
    const rightColumns = new Set(input.right.columns);
    const differences = new Map(result.differences.map((difference) => [difference.key, difference]));
    const placed = new Set<string>();
    const rows: DiffRow[] = [];
    const changes: DiffChange[] = [];

    for (const pair of pairRows(input.left, input.right, input.keyColumns, sortColumns)) {
        const difference = differences.get(pair.key) ?? null;
        // A key in several rows: the first row with it shows its changes.
        const isFirst = difference != null && !placed.has(pair.key);
        const rowChanges = isFirst ? changesOf(difference, input.keyColumns, rows.length) : [];
        const changeOfColumn = new Map(rowChanges
            .filter((change) => change.location.column != null)
            .map((change) => [change.location.column, change.id]));
        const cellOptions = { key: pair.key, columns, difference, changeOfColumn };

        placed.add(pair.key);
        changes.push(...rowChanges);
        rows.push({
            ...(rowChanges[0] == null ? {} : { change: rowChanges[0].id }),
            left: cellOf({ ...cellOptions, numbered: pair.left, present: leftColumns, side: 'original' }),
            right: cellOf({ ...cellOptions, numbered: pair.right, present: rightColumns, side: 'modified' }),
        });
    }

    return {
        format: DIFF_DOCUMENT_FORMAT,
        version: DIFF_DOCUMENT_VERSION,
        kind: 'rows',
        original: input.original,
        modified: input.modified,
        options: {
            keyColumns: [...input.keyColumns],
            sortColumns: [...sortColumns],
            ignoreColumns: [...ignoreColumns],
            sortColumnsByName,
            caseSensitive: true,
        },
        summary: { ...summarizeChanges(changes), unchanged: result.unchangedCount },
        changes,
        rows,
        columns: columns.map((name) => ({ name, original: leftColumns.has(name), modified: rightColumns.has(name) })),
    };
}

// The key values of a row, as the table's key column shows them.
export function displayKey(key: string): string {
    return key.split(KEY_SEPARATOR).join(', ');
}

// Pairs the rows of both files by key, in the original's order with rows only the modified file has after them.
function pairRows(
    left: RowSet,
    right: RowSet,
    keyColumns: ReadonlyArray<string>,
    sortColumns: ReadonlyArray<string>,
): RowPair[] {
    const numbered = (rowSet: RowSet): NumberedRecord[] => {
        const list = rowSet.rows.map((row, index) => ({ record: recordOf(rowSet.columns, row), line: index + 1 }));

        if (sortColumns.length > 0) {
            list.sort((first, second) => compareRecordsBy(first.record, second.record, sortColumns));
        }

        return list;
    };
    const rightByKey = new Map<string, NumberedRecord[]>();
    const rightOrder: string[] = [];

    for (const entry of numbered(right)) {
        const key = keyOf(entry.record, keyColumns);

        if (key == null) {
            continue;
        }

        if (!rightByKey.has(key)) {
            rightByKey.set(key, []);
            rightOrder.push(key);
        }

        rightByKey.get(key)!.push(entry);
    }

    const pairs: RowPair[] = [];

    for (const entry of numbered(left)) {
        const key = keyOf(entry.record, keyColumns);

        if (key != null) {
            pairs.push({ key, left: entry, right: rightByKey.get(key)?.shift() ?? null });
        }
    }

    for (const key of rightOrder) {
        for (const entry of rightByKey.get(key) ?? []) {
            pairs.push({ key, left: null, right: entry });
        }
    }

    return pairs;
}

// One change per changed cell, as `row id=2 · price`, and one per row only one file has, as `row id=4`; cells left to right.
function changesOf(difference: RowDifference, keyColumns: ReadonlyArray<string>, row: number): DiffChange[] {
    const parts = difference.key.split(KEY_SEPARATOR);
    const name = `row ${keyColumns.map((column, index) => `${column}=${parts[index] ?? ''}`).join(', ')}`;
    const key = displayKey(difference.key);

    if (difference.kind !== 'changed') {
        return [{
            id: name,
            kind: difference.kind,
            location: { key },
            row,
            ...(difference.kind === 'removed' ? { before: valuesOf(difference, 'left') } : { after: valuesOf(difference, 'right') }),
        }];
    }

    return difference.cells.map((cell) => ({
        id: `${name} · ${cell.column}`,
        kind: 'changed',
        location: { key, column: cell.column },
        row,
        before: textOf(cell.left),
        after: textOf(cell.right),
    }));
}

function valuesOf(difference: RowDifference, side: 'left' | 'right'): Record<string, string> {
    return Object.fromEntries(difference.cells.map((cell) => [cell.column, textOf(cell[side])]));
}

interface CellOptions {
    readonly key: string;
    readonly numbered: NumberedRecord | null;
    readonly columns: ReadonlyArray<string>;
    readonly present: ReadonlySet<string>;
    readonly difference: RowDifference | null;
    readonly changeOfColumn: ReadonlyMap<string | undefined, string>;
    readonly side: 'original' | 'modified';
}

function cellOf(options: CellOptions): DiffCell | null {
    const { numbered, difference } = options;

    if (numbered == null) {
        return null;
    }

    const changedColumns = new Set(difference?.kind === 'changed' ? difference.cells.map((cell) => cell.column) : []);
    const tokens = options.columns.map((column): DiffToken | null => {
        if (!options.present.has(column)) {
            return null;
        }

        const change = options.changeOfColumn.get(column);
        const text = numbered.record[column] ?? '';

        if (!changedColumns.has(column)) {
            return { text, type: 'text', column };
        }

        return { text, type: 'text', column, status: 'changed', ...(change == null ? {} : { change }) };
    });

    return { status: rowStatusOf(difference, options.side), line: numbered.line, label: displayKey(options.key), tokens };
}

function rowStatusOf(difference: RowDifference | null, side: 'original' | 'modified'): DiffCellStatus {
    if (difference == null) {
        return 'unchanged';
    }

    if (difference.kind === 'changed') {
        return 'changed';
    }

    return (difference.kind === 'removed') === (side === 'original') ? difference.kind : 'unchanged';
}

function recordOf(columns: ReadonlyArray<string>, row: ReadonlyArray<unknown>): Record<string, string> {
    return Object.fromEntries(columns.map((column, index) => [column, textOf(row[index])]));
}

function keyOf(record: Readonly<Record<string, string>>, keyColumns: ReadonlyArray<string>): string | null {
    const parts: string[] = [];

    for (const column of keyColumns) {
        const value = Object.hasOwn(record, column) ? record[column] : undefined;

        if (value == null || value === '') {
            return null;
        }

        parts.push(value);
    }

    return parts.join(KEY_SEPARATOR);
}

function textOf(value: unknown): string {
    return value == null ? '' : String(value);
}
