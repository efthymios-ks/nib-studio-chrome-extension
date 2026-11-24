import type { JsonDifference } from '../json/jsonComparer.js';
import { JsonPathBuilder, type JsonPathSegment } from '../paths/jsonPathBuilder.js';
import { countLabel } from '../paths/valueFormat.js';
import type { DiffCell, DiffCellStatus, DiffChange, DiffNodeRole, DiffRow, DiffToken, DiffValue } from './diffDocument.js';

// Two values laid out as one grid: each key or item sits on the same row on both sides,
// and a side without it holds a placeholder so everything below stays aligned.

export interface TreeRowsInput {
    // A side that is not chosen yet is undefined; its column is all placeholders.
    readonly left: unknown;
    readonly right: unknown;
    readonly differences: ReadonlyArray<JsonDifference>;
    // The id of each difference, in the same order, such as its readable path.
    readonly ids: ReadonlyArray<string>;
    // Alphabetical, natural, case-insensitive key order; file order when false.
    readonly sortKeys: boolean;
    // Fields that pair the items of the array at these segments, as an array rule's matchBy.
    readonly matchByFor: (segments: ReadonlyArray<JsonPathSegment>) => ReadonlyArray<string> | null;
    // The path a rule for the items of the array at these segments uses.
    readonly rulePathFor: (segments: ReadonlyArray<JsonPathSegment>) => string;
    // Shows labels another way, such as element names as <name>.
    readonly labelFor?: (label: string) => string;
}

export interface TreeRows {
    readonly rows: DiffRow[];
    readonly changes: DiffChange[];
}

type ContainerKind = 'object' | 'array';

interface WalkNode {
    readonly label: string | null;
    readonly left: unknown;
    readonly right: unknown;
    readonly leftSegments: JsonPathSegment[] | null;
    readonly rightSegments: JsonPathSegment[] | null;
    readonly depth: number;
}

interface DraftCell {
    status: DiffCellStatus;
    readonly depth: number;
    readonly label: string | null;
    readonly path: string;
    readonly node: DiffNodeRole;
    collapsed: boolean;
    readonly rulePath: string | null;
    readonly tokens: DiffToken[];
}

interface DraftRow {
    change: string | null;
    readonly node: DiffNodeRole;
    readonly depth: number;
    readonly left: DraftCell | null;
    readonly right: DraftCell | null;
}

interface WalkContext {
    readonly input: TreeRowsInput;
    readonly rows: DraftRow[];
}

export function naturalCompare(left: string, right: string): number {
    const order = left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });

    if (order !== 0) {
        return order;
    }

    return left < right ? -1 : left > right ? 1 : 0;
}

// Keys of both objects: sorted, or the left order followed by the keys only the right has.
export function orderKeys(left: ReadonlyArray<string>, right: ReadonlyArray<string>, sortKeys: boolean): string[] {
    const keys = [...new Set([...left, ...right])];

    return sortKeys ? keys.sort(naturalCompare) : keys;
}

// Whether path lies at or under ancestor, both JSONPath strings.
export function isPathWithin(path: string, ancestor: string): boolean {
    return path === ancestor || path.startsWith(`${ancestor}.`) || path.startsWith(`${ancestor}[`);
}

export function alignTreeRows(input: TreeRowsInput): TreeRows {
    const context: WalkContext = { input, rows: [] };
    walk({
        label: null,
        left: input.left,
        right: input.right,
        leftSegments: input.left === undefined ? null : [],
        rightSegments: input.right === undefined ? null : [],
        depth: 0,
    }, context);

    markCollapsed(context.rows, input.differences);
    const changes = attachChanges(context.rows, input);

    return { rows: context.rows.map(finishRow), changes };
}

function walk(node: WalkNode, context: WalkContext): void {
    const containerKind = containerKindOf(kindOf(node.left), kindOf(node.right));
    const leftPath = node.leftSegments == null ? null : JsonPathBuilder.of(node.leftSegments);
    const rightPath = node.rightSegments == null ? null : JsonPathBuilder.of(node.rightSegments);
    const draftCell = (value: unknown, path: string | null, role: DiffNodeRole, segments: JsonPathSegment[] | null): DraftCell | null => {
        if (value === undefined || path == null) {
            return null;
        }

        const label = role === 'close' ? null : node.label;

        return {
            status: 'unchanged',
            depth: node.depth,
            label: label == null ? null : context.input.labelFor?.(label) ?? label,
            path,
            node: role,
            collapsed: false,
            rulePath: role === 'open' && Array.isArray(value) && segments != null ? context.input.rulePathFor(segments) : null,
            tokens: role === 'close' ? [{ text: containerKind === 'array' ? ']' : '}', type: containerKind ?? 'object' }] : tokensOf(value),
        };
    };

    if (containerKind == null) {
        context.rows.push({
            change: null,
            node: 'leaf',
            depth: node.depth,
            left: draftCell(node.left, leftPath, 'leaf', node.leftSegments),
            right: draftCell(node.right, rightPath, 'leaf', node.rightSegments),
        });

        return;
    }

    context.rows.push({
        change: null,
        node: 'open',
        depth: node.depth,
        left: draftCell(node.left, leftPath, 'open', node.leftSegments),
        right: draftCell(node.right, rightPath, 'open', node.rightSegments),
    });

    const children = containerKind === 'object' ? objectChildren(node, context.input) : arrayChildren(node, context.input);

    for (const child of children) {
        walk(child, context);
    }

    context.rows.push({
        change: null,
        node: 'close',
        depth: node.depth,
        left: draftCell(node.left, leftPath, 'close', null),
        right: draftCell(node.right, rightPath, 'close', null),
    });
}

function objectChildren(node: WalkNode, input: TreeRowsInput): WalkNode[] {
    const left = asObject(node.left);
    const right = asObject(node.right);
    const keys = orderKeys(Object.keys(left ?? {}), Object.keys(right ?? {}), input.sortKeys);

    return keys.map((key) => {
        const inLeft = left != null && Object.hasOwn(left, key);
        const inRight = right != null && Object.hasOwn(right, key);

        return {
            label: key,
            left: inLeft ? left[key] : undefined,
            right: inRight ? right[key] : undefined,
            leftSegments: inLeft && node.leftSegments != null ? [...node.leftSegments, key] : null,
            rightSegments: inRight && node.rightSegments != null ? [...node.rightSegments, key] : null,
            depth: node.depth + 1,
        };
    });
}

interface ChildPosition {
    readonly leftIndex: number | null;
    readonly rightIndex: number | null;
    readonly label: string;
}

function arrayChildren(node: WalkNode, input: TreeRowsInput): WalkNode[] {
    const left = Array.isArray(node.left) ? node.left as unknown[] : [];
    const right = Array.isArray(node.right) ? node.right as unknown[] : [];
    const matchBy = input.matchByFor(node.leftSegments ?? node.rightSegments ?? []);
    const child = ({ leftIndex, rightIndex, label }: ChildPosition): WalkNode => ({
        label,
        left: leftIndex == null ? undefined : left[leftIndex],
        right: rightIndex == null ? undefined : right[rightIndex],
        leftSegments: leftIndex == null || node.leftSegments == null ? null : [...node.leftSegments, leftIndex],
        rightSegments: rightIndex == null || node.rightSegments == null ? null : [...node.rightSegments, rightIndex],
        depth: node.depth + 1,
    });

    if (matchBy == null || matchBy.length === 0) {
        const length = Math.max(left.length, right.length);

        return Array.from({ length }, (_, index) => child({
            leftIndex: index < left.length ? index : null,
            rightIndex: index < right.length ? index : null,
            label: `[${index}]`,
        }));
    }

    const children: WalkNode[] = [];
    const used = new Set<number>();
    const rightKeys = right.map((item) => matchKeyOf(item, matchBy));

    left.forEach((item, leftIndex) => {
        const key = matchKeyOf(item, matchBy);
        const partner = key == null ? -1 : rightKeys.findIndex((candidate, at) => candidate === key && !used.has(at));

        if (partner >= 0) {
            used.add(partner);
        }

        children.push(child({
            leftIndex,
            rightIndex: partner >= 0 ? partner : null,
            label: matchLabel(item, matchBy, leftIndex),
        }));
    });

    right.forEach((item, rightIndex) => {
        if (!used.has(rightIndex)) {
            children.push(child({ leftIndex: null, rightIndex, label: matchLabel(item, matchBy, rightIndex) }));
        }
    });

    return children;
}

function matchKeyOf(item: unknown, matchBy: ReadonlyArray<string>): string | null {
    const parts: string[] = [];

    for (const field of matchBy) {
        const value = fieldOf(item, field);

        if (value === undefined) {
            return null;
        }

        parts.push(JSON.stringify(value));
    }

    return parts.join('\u0000');
}

// Names a matched item by its match fields, as in [id=5].
function matchLabel(item: unknown, matchBy: ReadonlyArray<string>, index: number): string {
    const parts: string[] = [];

    for (const field of matchBy) {
        const value = fieldOf(item, field);

        if (value === undefined) {
            return `[${index}]`;
        }

        parts.push(`${field}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
    }

    return `[${parts.join(', ')}]`;
}

function fieldOf(item: unknown, field: string): unknown {
    let current: unknown = item;

    for (const step of field.split('.')) {
        const object = asObject(current);

        if (object == null || !Object.hasOwn(object, step)) {
            return undefined;
        }

        current = object[step];
    }

    return current;
}

type ValueKind = ContainerKind | 'scalar';

function kindOf(value: unknown): ValueKind | null {
    if (value === undefined) {
        return null;
    }

    if (Array.isArray(value)) {
        return 'array';
    }

    return value != null && typeof value === 'object' ? 'object' : 'scalar';
}

// Both present sides share a container kind; a missing side follows the present one.
function containerKindOf(left: ValueKind | null, right: ValueKind | null): ContainerKind | null {
    const kinds = [left, right].filter((kind): kind is ValueKind => kind != null);

    if (kinds.length === 0 || kinds.some((kind) => kind === 'scalar')) {
        return null;
    }

    return kinds.every((kind) => kind === kinds[0]) ? kinds[0] as ContainerKind : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
    return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function tokensOf(value: unknown): DiffToken[] {
    if (Array.isArray(value)) {
        return [{ text: '[', type: 'array' }, { text: countLabel(value.length, 'item'), type: 'count' }];
    }

    if (value != null && typeof value === 'object') {
        return [{ text: '{', type: 'object' }, { text: countLabel(Object.keys(value).length, 'key'), type: 'count' }];
    }

    if (value === null) {
        return [{ text: 'null', type: 'null' }];
    }

    const text = JSON.stringify(value) ?? String(value);

    if (typeof value === 'number') {
        return [{ text, type: 'number' }];
    }

    if (typeof value === 'boolean') {
        return [{ text, type: 'boolean' }];
    }

    return [{ text, type: 'string' }];
}

// Closes every object and array with no change under it; with no change at all, everything stays open.
function markCollapsed(rows: ReadonlyArray<DraftRow>, differences: ReadonlyArray<JsonDifference>): void {
    if (differences.length === 0) {
        return;
    }

    const leftAncestors = new Set<string>();
    const rightAncestors = new Set<string>();

    for (const difference of differences) {
        const ancestors = ancestorPathsOf(difference.segments);

        if (difference.kind !== 'added') {
            ancestors.forEach((path) => leftAncestors.add(path));
        }

        if (difference.kind !== 'removed') {
            ancestors.forEach((path) => rightAncestors.add(path));
        }
    }

    for (const row of rows) {
        if (row.node !== 'open' || row.depth === 0) {
            continue;
        }

        const isOpen = (row.left != null && leftAncestors.has(row.left.path)) || (row.right != null && rightAncestors.has(row.right.path));

        if (!isOpen) {
            for (const cell of [row.left, row.right]) {
                if (cell != null) {
                    cell.collapsed = true;
                }
            }
        }
    }
}

function ancestorPathsOf(segments: ReadonlyArray<JsonPathSegment>): string[] {
    return segments.map((_, length) => JsonPathBuilder.of(segments.slice(0, length)));
}

interface PlacedChange {
    readonly change: Omit<DiffChange, 'id'>;
    readonly id: string;
    readonly row: number | null;
    readonly order: number;
}

// Points each difference at the row that shows it and marks its cells; added and removed objects and arrays mark everything under them.
function attachChanges(rows: ReadonlyArray<DraftRow>, input: TreeRowsInput): DiffChange[] {
    const firstRow = new Map<string, number>();

    rows.forEach((row, index) => {
        if (row.node === 'close') {
            return;
        }

        for (const [side, cell] of [['left', row.left], ['right', row.right]] as const) {
            if (cell != null && !firstRow.has(`${side}:${cell.path}`)) {
                firstRow.set(`${side}:${cell.path}`, index);
            }
        }
    });

    const placed: PlacedChange[] = input.differences.map((difference, order) => {
        const pointer = JsonPathBuilder.of(difference.segments);
        const side = difference.kind === 'added' ? 'right' : 'left';
        const row = firstRow.get(`${side}:${pointer}`) ?? null;
        const id = input.ids[order] ?? pointer;

        return {
            id,
            row,
            order,
            change: {
                kind: difference.kind,
                location: { path: id, pointer },
                ...(row == null ? {} : { row }),
                ...(difference.kind === 'added' || difference.leftValue === undefined ? {} : { before: difference.leftValue as DiffValue }),
                ...(difference.kind === 'removed' || difference.rightValue === undefined ? {} : { after: difference.rightValue as DiffValue }),
            },
        };
    });

    placed.sort((first, second) => (first.row ?? Number.MAX_SAFE_INTEGER) - (second.row ?? Number.MAX_SAFE_INTEGER) || first.order - second.order);

    const taken = new Map<string, number>();

    return placed.map((entry) => {
        const seen = (taken.get(entry.id) ?? 0) + 1;
        taken.set(entry.id, seen);
        const id = seen === 1 ? entry.id : `${entry.id} (${seen})`;

        if (entry.row != null) {
            markRow(rows, entry.row, id, entry.change.kind);
        }

        return { id, ...entry.change, location: { ...entry.change.location, path: id } };
    });
}

function markRow(rows: ReadonlyArray<DraftRow>, index: number, id: string, kind: DiffChange['kind']): void {
    const row = rows[index];

    if (row == null) {
        return;
    }

    row.change ??= id;

    if (kind !== 'added' && row.left != null) {
        row.left.status = kind;
    }

    if (kind !== 'removed' && row.right != null) {
        row.right.status = kind;
    }

    if (row.node !== 'open' || (kind !== 'added' && kind !== 'removed')) {
        return;
    }

    // Everything inside an added or removed object or array, up to its closing row.
    for (let at = index + 1; at < rows.length; at += 1) {
        const inner = rows[at]!;
        const cell = kind === 'added' ? inner.right : inner.left;

        if (cell != null) {
            cell.status = kind;
        }

        if (inner.depth <= row.depth) {
            break;
        }
    }
}

function finishRow(row: DraftRow): DiffRow {
    return {
        ...(row.change == null ? {} : { change: row.change }),
        left: finishCell(row.left),
        right: finishCell(row.right),
    };
}

function finishCell(cell: DraftCell | null): DiffCell | null {
    if (cell == null) {
        return null;
    }

    return {
        status: cell.status,
        depth: cell.depth,
        ...(cell.label == null ? {} : { label: cell.label }),
        path: cell.path,
        node: cell.node,
        ...(cell.collapsed ? { collapsed: true } : {}),
        ...(cell.rulePath == null ? {} : { rulePath: cell.rulePath }),
        tokens: cell.tokens,
    };
}
