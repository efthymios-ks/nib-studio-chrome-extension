import { JsonPathBuilder, type JsonPathSegment } from '../paths/jsonPathBuilder.js';

// Structural diff of two JSON values. Array rules pair items by `matchBy` fields, falling back to position,
// or sort both sides by `sortBy` fields first so order alone is never a difference.
export type JsonDifferenceKind = 'added' | 'removed' | 'changed' | 'typeChanged';

export interface JsonArrayRule {
    readonly path: string;
    readonly matchBy?: ReadonlyArray<string>;
    readonly sortBy?: ReadonlyArray<string>;
}

export interface JsonComparerOptions {
    readonly arrayRules?: ReadonlyArray<JsonArrayRule>;
    // Leaves object keys in document order when normalising; they are sorted otherwise.
    readonly keepKeyOrder?: boolean;
}

export interface JsonDifference {
    readonly kind: JsonDifferenceKind;
    readonly path: string;
    readonly segments: JsonPathSegment[];
    readonly leftValue?: unknown;
    readonly rightValue?: unknown;
}

const MISSING = Symbol('missing');
type Missing = typeof MISSING;

function compare(left: unknown, right: unknown, options?: JsonComparerOptions): JsonDifference[] {
    const differences: JsonDifference[] = [];
    walk(left, right, [], options?.arrayRules ?? [], differences);

    return differences;
}

// Apply the same array rules used during `compare` to a single value.
// The returned structure has every array sorted by `sortBy`, so a
// side-by-side view shows paired items on matching rows.
function normalize(value: unknown, options?: JsonComparerOptions): unknown {
    return normalizeValue(value, '$', options?.arrayRules ?? [], options?.keepKeyOrder === true);
}

function walk(
    left: unknown,
    right: unknown,
    segments: JsonPathSegment[],
    rules: ReadonlyArray<JsonArrayRule>,
    out: JsonDifference[],
): void {
    const leftKind = kindOf(left);
    const rightKind = kindOf(right);

    // Null stands for a missing value: a value in place of null is added, null in place of a value is removed.
    if (leftKind !== rightKind && (left === null || right === null)) {
        out.push(left === null
            ? { kind: 'added', path: JsonPathBuilder.of(segments), segments: [...segments], rightValue: right }
            : { kind: 'removed', path: JsonPathBuilder.of(segments), segments: [...segments], leftValue: left });

        return;
    }

    if (leftKind !== rightKind) {
        out.push({
            kind: 'typeChanged',
            path: JsonPathBuilder.of(segments),
            segments: [...segments],
            leftValue: left,
            rightValue: right,
        });

        return;
    }

    if (leftKind === 'object') {
        walkObject(
            left as Record<string, unknown>,
            right as Record<string, unknown>,
            segments,
            rules,
            out,
        );

        return;
    }

    if (leftKind === 'array') {
        walkArray(left as unknown[], right as unknown[], segments, rules, out);

        return;
    }

    if (!equalScalar(left, right)) {
        out.push({
            kind: 'changed',
            path: JsonPathBuilder.of(segments),
            segments: [...segments],
            leftValue: left,
            rightValue: right,
        });
    }
}

function walkObject(
    left: Record<string, unknown>,
    right: Record<string, unknown>,
    segments: JsonPathSegment[],
    rules: ReadonlyArray<JsonArrayRule>,
    out: JsonDifference[],
): void {
    const keys = new Set<string>([...Object.keys(left), ...Object.keys(right)]);
    const sorted = [...keys].sort();

    for (const key of sorted) {
        const childSegments = [...segments, key];
        const inLeft = Object.prototype.hasOwnProperty.call(left, key);
        const inRight = Object.prototype.hasOwnProperty.call(right, key);

        if (!inLeft) {
            out.push({
                kind: 'added',
                path: JsonPathBuilder.of(childSegments),
                segments: childSegments,
                rightValue: right[key],
            });
            continue;
        }

        if (!inRight) {
            out.push({
                kind: 'removed',
                path: JsonPathBuilder.of(childSegments),
                segments: childSegments,
                leftValue: left[key],
            });
            continue;
        }

        walk(left[key], right[key], childSegments, rules, out);
    }
}

function walkArray(
    left: unknown[],
    right: unknown[],
    segments: JsonPathSegment[],
    rules: ReadonlyArray<JsonArrayRule>,
    out: JsonDifference[],
): void {
    const rule = findRule(segments, rules);
    const sortedLeft = rule?.sortBy != null ? sortItems(left, rule.sortBy) : left;
    const sortedRight = rule?.sortBy != null ? sortItems(right, rule.sortBy) : right;

    if (rule?.matchBy != null && rule.matchBy.length > 0) {
        walkMatchedArray(sortedLeft, sortedRight, segments, rule, rules, out);

        return;
    }

    walkPositionalArray(sortedLeft, sortedRight, segments, rules, out);
}

function walkPositionalArray(
    left: ReadonlyArray<unknown>,
    right: ReadonlyArray<unknown>,
    segments: JsonPathSegment[],
    rules: ReadonlyArray<JsonArrayRule>,
    out: JsonDifference[],
): void {
    const length = Math.max(left.length, right.length);

    for (let index = 0; index < length; index += 1) {
        const childSegments = [...segments, index];

        if (index >= left.length) {
            out.push({
                kind: 'added',
                path: JsonPathBuilder.of(childSegments),
                segments: childSegments,
                rightValue: right[index],
            });
            continue;
        }

        if (index >= right.length) {
            out.push({
                kind: 'removed',
                path: JsonPathBuilder.of(childSegments),
                segments: childSegments,
                leftValue: left[index],
            });
            continue;
        }

        walk(left[index], right[index], childSegments, rules, out);
    }
}

function walkMatchedArray(
    left: ReadonlyArray<unknown>,
    right: ReadonlyArray<unknown>,
    segments: JsonPathSegment[],
    rule: JsonArrayRule,
    rules: ReadonlyArray<JsonArrayRule>,
    out: JsonDifference[],
): void {
    const matchBy = rule.matchBy ?? [];
    const leftWithKeys = indexItems(left, matchBy);
    const rightWithKeys = indexItems(right, matchBy);
    const seenRight = new Set<number>();

    for (let leftIndex = 0; leftIndex < leftWithKeys.length; leftIndex += 1) {
        const leftEntry = leftWithKeys[leftIndex];
        if (leftEntry == null) {
            continue;
        }

        const partnerIndex = leftEntry.key == null
            ? -1
            : findPartner(rightWithKeys, leftEntry.key, seenRight);

        if (partnerIndex === -1) {
            const fallback = positionalFallback(leftWithKeys, rightWithKeys, leftIndex, seenRight);
            if (fallback !== -1) {
                seenRight.add(fallback);
                const childSegments = [...segments, leftIndex];
                const rightEntry = rightWithKeys[fallback];
                if (rightEntry != null) {
                    walk(leftEntry.value, rightEntry.value, childSegments, rules, out);
                }

                continue;
            }

            const childSegments = [...segments, leftIndex];
            out.push({
                kind: 'removed',
                path: JsonPathBuilder.of(childSegments),
                segments: childSegments,
                leftValue: leftEntry.value,
            });
            continue;
        }

        seenRight.add(partnerIndex);
        const childSegments = [...segments, leftIndex];
        const rightEntry = rightWithKeys[partnerIndex];
        if (rightEntry != null) {
            walk(leftEntry.value, rightEntry.value, childSegments, rules, out);
        }
    }

    for (let rightIndex = 0; rightIndex < rightWithKeys.length; rightIndex += 1) {
        if (seenRight.has(rightIndex)) {
            continue;
        }

        const rightEntry = rightWithKeys[rightIndex];
        if (rightEntry == null) {
            continue;
        }

        const childSegments = [...segments, rightIndex];
        out.push({
            kind: 'added',
            path: JsonPathBuilder.of(childSegments),
            segments: childSegments,
            rightValue: rightEntry.value,
        });
    }
}

interface KeyedItem {
    readonly value: unknown;
    readonly key: string | null;
}

function indexItems(items: ReadonlyArray<unknown>, matchBy: ReadonlyArray<string>): KeyedItem[] {
    return items.map((value) => ({
        value,
        key: composeKey(value, matchBy),
    }));
}

function composeKey(value: unknown, matchBy: ReadonlyArray<string>): string | null {
    const parts: string[] = [];

    for (const field of matchBy) {
        const fieldValue = readField(value, field);
        if (fieldValue === MISSING) {
            return null;
        }

        parts.push(stringifyKey(fieldValue));
    }

    return parts.join('\u001f');
}

function findPartner(
    right: ReadonlyArray<KeyedItem>,
    key: string,
    seen: ReadonlySet<number>,
): number {
    for (let index = 0; index < right.length; index += 1) {
        if (seen.has(index)) {
            continue;
        }

        const entry = right[index];
        if (entry == null) {
            continue;
        }

        if (entry.key === key) {
            return index;
        }
    }

    return -1;
}

function positionalFallback(
    left: ReadonlyArray<KeyedItem>,
    right: ReadonlyArray<KeyedItem>,
    leftIndex: number,
    seen: ReadonlySet<number>,
): number {
    const leftEntry = left[leftIndex];
    if (leftEntry == null || leftEntry.key != null) {
        return -1;
    }

    if (leftIndex >= right.length) {
        return -1;
    }

    if (seen.has(leftIndex)) {
        return -1;
    }

    const rightEntry = right[leftIndex];
    if (rightEntry == null || rightEntry.key != null) {
        return -1;
    }

    return leftIndex;
}

function sortItems(items: ReadonlyArray<unknown>, sortBy: ReadonlyArray<string>): unknown[] {
    const indexed = items.map((value, originalIndex) => ({ value, originalIndex }));
    indexed.sort((first, second) => compareBySortFields(first.value, second.value, sortBy) || (first.originalIndex - second.originalIndex));

    return indexed.map((entry) => entry.value);
}

function compareBySortFields(
    left: unknown,
    right: unknown,
    sortBy: ReadonlyArray<string>,
): number {
    for (const field of sortBy) {
        const leftField = readField(left, field);
        const rightField = readField(right, field);
        const result = compareSortValues(leftField, rightField);
        if (result !== 0) {
            return result;
        }
    }

    return 0;
}

function compareSortValues(left: unknown, right: unknown): number {
    if (left === MISSING && right === MISSING) {
        return 0;
    }
    // Missing values sort last so paired items keep their order.
    if (left === MISSING) {
        return 1;
    }

    if (right === MISSING) {
        return -1;
    }

    const leftRank = typeRank(left);
    const rightRank = typeRank(right);

    if (leftRank !== rightRank) {
        return leftRank - rightRank;
    }

    if (typeof left === 'number' && typeof right === 'number') {
        return left - right;
    }

    if (typeof left === 'boolean' && typeof right === 'boolean') {
        return Number(left) - Number(right);
    }

    if (typeof left === 'string' && typeof right === 'string') {
        return left < right ? -1 : left > right ? 1 : 0;
    }

    return 0;
}

function typeRank(value: unknown): number {
    if (value === null) {
        return 0;
    }

    if (typeof value === 'boolean') {
        return 1;
    }

    if (typeof value === 'number') {
        return 2;
    }

    if (typeof value === 'string') {
        return 3;
    }

    return 4;
}

function readField(value: unknown, dotPath: string): unknown | Missing {
    if (value == null || typeof value !== 'object') {
        return MISSING;
    }

    const parts = dotPath.split('.');
    let current: unknown = value;

    for (const part of parts) {
        if (current == null || typeof current !== 'object') {
            return MISSING;
        }

        const record = current as Record<string, unknown>;
        if (!Object.prototype.hasOwnProperty.call(record, part)) {
            return MISSING;
        }

        current = record[part];
    }

    return current;
}

function stringifyKey(value: unknown): string {
    if (value === null) {
        return '\u0000null';
    }

    if (typeof value === 'string') {
        return `s:${value}`;
    }

    if (typeof value === 'number') {
        return `n:${value}`;
    }

    if (typeof value === 'boolean') {
        return `b:${value}`;
    }

    return `j:${JSON.stringify(value)}`;
}

function findRule(
    segments: ReadonlyArray<JsonPathSegment>,
    rules: ReadonlyArray<JsonArrayRule>,
): JsonArrayRule | null {
    // Rule paths describe array items with a trailing `[*]`, e.g.
    // `$.items[*]`. We're standing at the array itself, so append the
    // wildcard before matching.
    const candidate = `${JsonPathBuilder.anyItemsOf(segments)}[*]`;

    for (const rule of rules) {
        if (rule.path === candidate) {
            return rule;
        }
    }

    return null;
}

function normalizeValue(
    value: unknown,
    path: string,
    rules: ReadonlyArray<JsonArrayRule>,
    keepKeyOrder = false,
): unknown {
    if (Array.isArray(value)) {
        const rule = findRuleForPath(`${path}[*]`, rules);
        const base = rule?.sortBy != null ? sortItems(value, rule.sortBy) : value;

        return base.map((item) => normalizeValue(item, `${path}[*]`, rules, keepKeyOrder));
    }

    if (value != null && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const keys = keepKeyOrder ? Object.keys(record) : Object.keys(record).sort();
        const next: Record<string, unknown> = {};
        for (const key of keys) {
            next[key] = normalizeValue(record[key], joinPath(path, key), rules, keepKeyOrder);
        }

        return next;
    }

    return value;
}

function joinPath(path: string, key: string): string {
    const trimmed = path === '$.' ? '$' : path;

    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${trimmed}.${key}` : `${trimmed}["${key}"]`;
}

function findRuleForPath(
    path: string,
    rules: ReadonlyArray<JsonArrayRule>,
): JsonArrayRule | null {
    for (const rule of rules) {
        if (rule.path === path) {
            return rule;
        }
    }

    return null;
}

function kindOf(value: unknown): string {
    if (value === null) {
        return 'null';
    }

    if (Array.isArray(value)) {
        return 'array';
    }

    return typeof value;
}

function equalScalar(left: unknown, right: unknown): boolean {
    if (left === right) {
        return true;
    }

    if (typeof left === 'number' && typeof right === 'number') {
        return Number.isNaN(left) && Number.isNaN(right);
    }

    return false;
}

export const JsonComparer = {
    compare,
    normalize,
};
