export interface RowSet {
    readonly columns: ReadonlyArray<string>;
    readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
}

export interface RowCompareOptions {
    readonly keyColumns: ReadonlyArray<string>;
    readonly ignoreColumns?: ReadonlyArray<string>;
    readonly caseSensitive?: boolean;
    // Orders the differences by these columns, in priority order; by key when empty.
    readonly sortColumns?: ReadonlyArray<string>;
}

export type RowChangeKind = 'added' | 'removed' | 'changed';

export interface RowCellChange {
    readonly column: string;
    readonly left: unknown;
    readonly right: unknown;
}

export interface RowDifference {
    readonly kind: RowChangeKind;
    readonly key: string;
    readonly cells: ReadonlyArray<RowCellChange>;
    readonly leftIndex: number | null;
    readonly rightIndex: number | null;
}

export interface RowCompareResult {
    readonly differences: ReadonlyArray<RowDifference>;
    readonly addedCount: number;
    readonly removedCount: number;
    readonly changedCount: number;
    readonly unchangedCount: number;
    readonly sharedColumns: ReadonlyArray<string>;
    readonly onlyInOriginalColumns: ReadonlyArray<string>;
    readonly onlyInModifiedColumns: ReadonlyArray<string>;
}

interface IndexedRow {
    readonly key: string;
    readonly record: Record<string, unknown>;
    readonly rowIndex: number;
}

export function compareRowSets(original: RowSet, modified: RowSet, options: RowCompareOptions): RowCompareResult {
    const ignored = new Set((options.ignoreColumns ?? []).map((column) => column.trim()));
    const keyColumns = options.keyColumns.map((column) => column.trim()).filter((column) => column.length > 0);

    if (keyColumns.length === 0) {
        throw new Error('rowCompare: keyColumns must name at least one column.');
    }

    const sharedColumns = original.columns.filter((column) => modified.columns.includes(column) && !ignored.has(column));
    const onlyInOriginalColumns = original.columns.filter((column) => !modified.columns.includes(column) && !ignored.has(column));
    const onlyInModifiedColumns = modified.columns.filter((column) => !original.columns.includes(column) && !ignored.has(column));

    const indexedOriginal = indexRows(original, keyColumns, ignored, options.caseSensitive ?? true);
    const indexedModified = indexRows(modified, keyColumns, ignored, options.caseSensitive ?? true);

    const differences: RowDifference[] = [];
    const seenKeys = new Set<string>();

    for (const [key, leftRow] of indexedOriginal.byKey) {
        seenKeys.add(key);
        const rightRow = indexedModified.byKey.get(key);

        if (rightRow == null) {
            differences.push({
                kind: 'removed',
                key,
                cells: diffCells(leftRow.record, {}, sharedColumns),
                leftIndex: leftRow.rowIndex,
                rightIndex: null,
            });
            continue;
        }

        const cells = diffCells(leftRow.record, rightRow.record, sharedColumns);

        if (cells.length === 0 && onlyInOriginalColumns.length === 0 && onlyInModifiedColumns.length === 0) {
            continue;
        }

        if (cells.length === 0) {
            continue;
        }

        differences.push({
            kind: 'changed',
            key,
            cells,
            leftIndex: leftRow.rowIndex,
            rightIndex: rightRow.rowIndex,
        });
    }

    for (const [key, rightRow] of indexedModified.byKey) {
        if (seenKeys.has(key)) {
            continue;
        }

        differences.push({
            kind: 'added',
            key,
            cells: diffCells({}, rightRow.record, sharedColumns),
            leftIndex: null,
            rightIndex: rightRow.rowIndex,
        });
    }

    const sortColumns = (options.sortColumns ?? []).filter((column) => column.trim().length > 0);
    const recordOf = (difference: RowDifference): Record<string, unknown> =>
        indexedModified.byKey.get(difference.key)?.record ?? indexedOriginal.byKey.get(difference.key)?.record ?? {};
    differences.sort((first, second) => compareRecordsBy(recordOf(first), recordOf(second), sortColumns)
        || first.key.localeCompare(second.key, undefined, { numeric: true, sensitivity: 'base' }));

    const addedCount = differences.filter((difference) => difference.kind === 'added').length;
    const removedCount = differences.filter((difference) => difference.kind === 'removed').length;
    const changedCount = differences.filter((difference) => difference.kind === 'changed').length;
    const unchangedCount = Math.max(0, indexedOriginal.byKey.size - removedCount - changedCount);

    return {
        differences,
        addedCount,
        removedCount,
        changedCount,
        unchangedCount,
        sharedColumns,
        onlyInOriginalColumns,
        onlyInModifiedColumns,
    };
}

// Compares two records column by column in priority order, with natural ordering of digit runs.
export function compareRecordsBy(
    left: Readonly<Record<string, unknown>>,
    right: Readonly<Record<string, unknown>>,
    columns: ReadonlyArray<string>,
): number {
    for (const column of columns) {
        const leftText = left[column] == null ? '' : String(left[column]);
        const rightText = right[column] == null ? '' : String(right[column]);
        const result = leftText.localeCompare(rightText, undefined, { numeric: true, sensitivity: 'base' });

        if (result !== 0) {
            return result;
        }
    }

    return 0;
}

function indexRows(
    rowSet: RowSet,
    keyColumns: ReadonlyArray<string>,
    ignored: ReadonlySet<string>,
    caseSensitive: boolean,
): { readonly byKey: Map<string, IndexedRow> } {
    const byKey = new Map<string, IndexedRow>();

    rowSet.rows.forEach((row, rowIndex) => {
        const record = toRecord(rowSet.columns, row, ignored);
        const key = computeKey(record, keyColumns, caseSensitive);

        if (key == null) {
            return;
        }

        if (!byKey.has(key)) {
            byKey.set(key, { key, record, rowIndex });
        }
    });

    return { byKey };
}

function toRecord(
    columns: ReadonlyArray<string>,
    row: ReadonlyArray<unknown>,
    ignored: ReadonlySet<string>,
): Record<string, unknown> {
    const record: Record<string, unknown> = {};

    columns.forEach((column, index) => {
        if (ignored.has(column)) {
            return;
        }

        record[column] = row[index] ?? '';
    });

    return record;
}

function computeKey(
    record: Record<string, unknown>,
    keyColumns: ReadonlyArray<string>,
    caseSensitive: boolean,
): string | null {
    const parts: string[] = [];

    for (const column of keyColumns) {
        const value = record[column];

        if (value == null || value === '') {
            return null;
        }

        parts.push(caseSensitive ? String(value) : String(value).toLowerCase());
    }

    return parts.join('\u001f');
}

function diffCells(
    left: Record<string, unknown>,
    right: Record<string, unknown>,
    sharedColumns: ReadonlyArray<string>,
): RowCellChange[] {
    const cells: RowCellChange[] = [];

    for (const column of sharedColumns) {
        const leftValue = left[column];
        const rightValue = right[column];

        if (!valuesEqual(leftValue, rightValue)) {
            cells.push({ column, left: leftValue, right: rightValue });
        }
    }

    return cells;
}

function valuesEqual(left: unknown, right: unknown): boolean {
    if (left === right) {
        return true;
    }

    if (left == null && right == null) {
        return true;
    }

    if (left == null || right == null) {
        return false;
    }

    return String(left) === String(right);
}
