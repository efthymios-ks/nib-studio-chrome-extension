export type TableFilterOperator =
    | 'contains'
    | 'equals'
    | 'notContains'
    | 'startsWith'
    | 'endsWith'
    | 'empty'
    | 'notEmpty'
    | 'eq'
    | 'ne'
    | 'lt'
    | 'gt'
    | 'between'
    | 'oneOf';

export interface TableFilter {
    readonly columnId: string;
    readonly operator: TableFilterOperator;
    readonly value?: unknown;
    readonly valueTo?: unknown;
    readonly values?: ReadonlyArray<unknown>;
}

export function evaluateFilter(cell: unknown, filter: TableFilter): boolean {
    if (filter.operator === 'empty') {
        return isEmpty(cell);
    }

    if (filter.operator === 'notEmpty') {
        return !isEmpty(cell);
    }

    if (filter.operator === 'oneOf') {
        const values = filter.values ?? [];

        return values.some((value) => looseEquals(cell, value));
    }

    if (isTextOperator(filter.operator)) {
        const left = toText(cell);
        const right = toText(filter.value);

        if (filter.operator === 'contains') {
            return left.toLowerCase().includes(right.toLowerCase());
        }

        if (filter.operator === 'notContains') {
            return !left.toLowerCase().includes(right.toLowerCase());
        }

        if (filter.operator === 'equals') {
            return left.toLowerCase() === right.toLowerCase();
        }

        if (filter.operator === 'startsWith') {
            return left.toLowerCase().startsWith(right.toLowerCase());
        }

        if (filter.operator === 'endsWith') {
            return left.toLowerCase().endsWith(right.toLowerCase());
        }
    }

    if (isNumericOperator(filter.operator)) {
        const left = toNumber(cell);

        if (left == null) {
            return false;
        }

        if (filter.operator === 'between') {
            const lo = toNumber(filter.value);
            const hi = toNumber(filter.valueTo);

            if (lo == null || hi == null) {
                return false;
            }

            return left >= lo && left <= hi;
        }

        const right = toNumber(filter.value);

        if (right == null) {
            return false;
        }

        if (filter.operator === 'eq') {
            return left === right;
        }

        if (filter.operator === 'ne') {
            return left !== right;
        }

        if (filter.operator === 'lt') {
            return left < right;
        }

        if (filter.operator === 'gt') {
            return left > right;
        }
    }

    return true;
}

export function applyFilters(
    rows: ReadonlyArray<ReadonlyArray<unknown>>,
    columnIndex: ReadonlyMap<string, number>,
    filters: ReadonlyArray<TableFilter>,
): ReadonlyArray<ReadonlyArray<unknown>> {
    if (filters.length === 0) {
        return rows;
    }

    return rows.filter((row) => filters.every((filter) => {
        const index = columnIndex.get(filter.columnId);

        if (index == null) {
            return true;
        }

        return evaluateFilter(row[index], filter);
    }));
}

function isEmpty(value: unknown): boolean {
    if (value == null) {
        return true;
    }

    if (typeof value === 'string') {
        return value.trim().length === 0;
    }

    return false;
}

function isTextOperator(operator: TableFilterOperator): boolean {
    return operator === 'contains'
        || operator === 'notContains'
        || operator === 'equals'
        || operator === 'startsWith'
        || operator === 'endsWith';
}

function isNumericOperator(operator: TableFilterOperator): boolean {
    return operator === 'eq'
        || operator === 'ne'
        || operator === 'lt'
        || operator === 'gt'
        || operator === 'between';
}

function toText(value: unknown): string {
    if (value == null) {
        return '';
    }

    return String(value);
}

function toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);

        return Number.isFinite(parsed) ? parsed : null;
    }

    if (value instanceof Date) {
        return value.getTime();
    }

    return null;
}

function looseEquals(a: unknown, b: unknown): boolean {
    if (a === b) {
        return true;
    }

    if (a == null || b == null) {
        return a == null && b == null;
    }

    return String(a) === String(b);
}
