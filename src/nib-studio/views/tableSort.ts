export type TableSortDirection = 'asc' | 'desc';

export interface TableSort {
    readonly columnId: string;
    readonly direction: TableSortDirection;
}

// Cycle a sort state: none -> asc -> desc -> none. Shift+click adds secondary
// sorts; a bare click replaces the whole chain with the clicked column.
export function cycleSort(
    current: ReadonlyArray<TableSort>,
    columnId: string,
    additive: boolean,
): ReadonlyArray<TableSort> {
    const existingIndex = current.findIndex((sort) => sort.columnId === columnId);
    const existing = existingIndex >= 0 ? current[existingIndex] : null;

    if (!additive) {
        if (existing == null) {
            return [{ columnId, direction: 'asc' }];
        }

        if (existing.direction === 'asc') {
            return [{ columnId, direction: 'desc' }];
        }

        return [];
    }

    const next = current.slice();

    if (existing == null) {
        next.push({ columnId, direction: 'asc' });

        return next;
    }

    if (existing.direction === 'asc') {
        next[existingIndex] = { columnId, direction: 'desc' };

        return next;
    }

    next.splice(existingIndex, 1);

    return next;
}

export function sortRows(
    rows: ReadonlyArray<ReadonlyArray<unknown>>,
    columnIndex: ReadonlyMap<string, number>,
    sorts: ReadonlyArray<TableSort>,
): ReadonlyArray<ReadonlyArray<unknown>> {
    if (sorts.length === 0) {
        return rows;
    }

    const copy = rows.slice();
    copy.sort((left, right) => compareRows(left, right, columnIndex, sorts));

    return copy;
}

function compareRows(
    left: ReadonlyArray<unknown>,
    right: ReadonlyArray<unknown>,
    columnIndex: ReadonlyMap<string, number>,
    sorts: ReadonlyArray<TableSort>,
): number {
    for (const sort of sorts) {
        const index = columnIndex.get(sort.columnId);

        if (index == null) {
            continue;
        }

        const comparison = compareValues(left[index], right[index]);

        if (comparison !== 0) {
            return sort.direction === 'asc' ? comparison : -comparison;
        }
    }

    return 0;
}

export function compareValues(a: unknown, b: unknown): number {
    if (a === b) {
        return 0;
    }

    if (a == null) {
        return b == null ? 0 : 1;
    }

    if (b == null) {
        return -1;
    }

    const aNumber = toNumber(a);
    const bNumber = toNumber(b);

    if (aNumber != null && bNumber != null) {
        return aNumber - bNumber;
    }

    const aDate = toDate(a);
    const bDate = toDate(b);

    if (aDate != null && bDate != null) {
        return aDate - bDate;
    }

    return String(a).localeCompare(String(b));
}

function toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);

        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

function toDate(value: unknown): number | null {
    if (value instanceof Date) {
        return value.getTime();
    }

    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        const parsed = Date.parse(value);

        return Number.isNaN(parsed) ? null : parsed;
    }

    return null;
}
