import type { DiffCell, DiffNodeRole, DiffRow } from '../../common/diff/diffDocument.js';
import { h } from '../app/dom.js';

// Draws the aligned rows of a JSON or XML diff document as one grid: each key or item on the same row on both sides,
// with a placeholder where a side lacks it.

// One row as the grid draws it: a row of the document, and whether its object or array is open.
export interface TreeViewRow {
    // Stable id for expansion: the left path, or the right path behind "r:" for rows only the right side has.
    readonly id: string;
    readonly source: DiffRow;
    readonly node: DiffNodeRole;
    readonly depth: number;
    readonly expanded: boolean;
}

export interface AlignedTreeViewOptions {
    readonly rows: ReadonlyArray<TreeViewRow>;
    readonly onToggle: (row: TreeViewRow) => void;
    // Clicking the bracket of an array, such as to edit the rule for its items at this rule path.
    readonly onArrayClick?: (rulePath: string) => void;
}

export function treeRowId(row: DiffRow): string {
    const id = row.left?.path ?? `r:${row.right?.path ?? ''}`;

    return (row.left ?? row.right)?.node === 'close' ? `${id}:close` : id;
}

export function renderAlignedTree(options: AlignedTreeViewOptions): HTMLElement {
    const grid = h('div', { class: 'aligned-tree', attrs: { role: 'grid' } });

    for (const row of options.rows) {
        const dataset: Record<string, string> = { id: row.id, role: row.node };

        // A row only one side has, which Before or After leaves out.
        if (row.source.left == null || row.source.right == null) {
            dataset['only'] = row.source.left == null ? 'modified' : 'original';
        }

        grid.append(h('div', {
            class: 'aligned-row',
            dataset,
            attrs: { role: 'row' },
            children: [
                buildCell(row, row.source.left, 'original', options),
                buildCell(row, row.source.right, 'modified', options),
            ],
        }));
    }

    return grid;
}

function buildCell(row: TreeViewRow, cell: DiffCell | null, side: 'original' | 'modified', options: AlignedTreeViewOptions): HTMLElement {
    const dataset: Record<string, string> = { side };

    if (cell == null) {
        dataset['placeholder'] = 'true';
    }
    else {
        dataset['path'] = cell.path ?? '';
    }

    // A cell shows its state on the row of a change; the rest of an added or removed branch stays plain.
    if (cell != null && row.source.change != null && cell.status !== 'unchanged' && row.node !== 'close') {
        dataset['diff'] = cell.status;
    }

    return h('div', {
        class: 'aligned-cell',
        dataset,
        attrs: { role: 'gridcell', style: `--depth: ${row.depth}` },
        children: cell == null ? [] : cellContent(row, cell, options),
    });
}

function cellContent(row: TreeViewRow, cell: DiffCell, options: AlignedTreeViewOptions): Array<HTMLElement | null> {
    const children: Array<HTMLElement | null> = [];
    const value = cell.tokens[0];
    const count = cell.tokens[1];
    const isOpen = row.node === 'open' && row.expanded;

    if (row.node === 'open') {
        children.push(h('button', {
            class: 'aligned-twist',
            attrs: { type: 'button', 'aria-expanded': String(row.expanded), 'aria-label': row.expanded ? 'Collapse' : 'Expand' },
            text: row.expanded ? '▾' : '▸',
            on: { click: () => options.onToggle(row) },
        }));
    }
    else {
        children.push(h('span', { class: 'aligned-twist', attrs: { 'aria-hidden': 'true' } }));
    }

    if (cell.label != null) {
        children.push(h('span', { class: 'aligned-key', text: cell.label }));
        children.push(h('span', { class: 'json-punct', text: ':' }));
    }

    const isContainer = value?.type === 'object' || value?.type === 'array';
    const element = h('span', {
        class: 'aligned-value',
        dataset: isContainer ? { kind: value.type } : { kind: 'scalar', type: value?.type ?? 'string' },
        text: isOpen ? value?.text ?? '' : cell.tokens.map((token) => token?.text ?? '').join(' '),
    });

    if (row.node === 'open' && value?.type === 'array' && options.onArrayClick != null && cell.rulePath != null) {
        const rulePath = cell.rulePath;
        element.dataset['clickable'] = 'true';
        element.setAttribute('title', 'Choose how these items are matched and sorted');
        element.addEventListener('click', () => options.onArrayClick?.(rulePath));
    }

    children.push(element);

    if (isOpen && count != null) {
        children.push(h('span', { class: 'json-count', text: count.text }));
    }

    return children;
}
