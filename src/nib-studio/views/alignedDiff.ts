import type { DiffChange, DiffRow, TreeDiffDocument } from '../../common/diff/diffDocument.js';
import { isPathWithin } from '../../common/diff/treeDiffRows.js';
import { h } from '../app/dom.js';
import type { DiffSide } from '../app/store.js';
import { renderAlignedTree, treeRowId, type TreeViewRow } from './alignedTree.js';
import { navigationChangesOf } from './diffChanges.js';
import { attachDiffNavigation, type DiffNavigationState } from './diffNavigationBar.js';
import { buildDiffSideHeader } from './diffSideHeader.js';
import type { AlignedReveal } from './diffViewState.js';

export interface AlignedDiffState {
    // Rows the user opened or closed, on top of what the document opens.
    expansion: Map<string, boolean>;
    // A path whose parents open on the next render, so the bar can scroll to it.
    reveal: AlignedReveal | null;
}

export interface AlignedDiffOptions {
    readonly original: DiffSide | null;
    readonly modified: DiffSide | null;
    readonly document: TreeDiffDocument;
    readonly state: AlignedDiffState;
    // Clicking the bracket of an array, with the rule path of its items.
    readonly onArrayClick?: (rulePath: string) => void;
    // Redraws the whole view after a toggle.
    readonly rerender: () => void;
}

// The rows the grid draws: everything under a closed object or array is left out, up to its closing row.
export function visibleTreeRows(document: TreeDiffDocument, state: AlignedDiffState): TreeViewRow[] {
    const rows: TreeViewRow[] = [];
    let closedAt: number | null = null;

    for (const source of document.rows) {
        const cell = source.left ?? source.right;
        const depth = cell?.depth ?? 0;
        const node = cell?.node ?? 'leaf';

        if (closedAt != null) {
            if (depth > closedAt) {
                continue;
            }

            closedAt = null;

            if (node === 'close') {
                continue;
            }
        }

        const id = treeRowId(source);
        const expanded = node === 'open' && (depth === 0 || isExpanded({ id, source, collapsed: cell?.collapsed === true }, state));
        rows.push({ id, source, node, depth, expanded });

        if (node === 'open' && !expanded) {
            closedAt = depth;
        }
    }

    return rows;
}

interface OpenableRow {
    readonly id: string;
    readonly source: DiffRow;
    // The document closes it, as nothing under it changed.
    readonly collapsed: boolean;
}

// Open when the user opened it, when it leads to the revealed path, or when the document opens it.
function isExpanded(row: OpenableRow, state: AlignedDiffState): boolean {
    const reveal = state.reveal;

    if (reveal != null) {
        const own = (reveal.side === 'left' ? row.source.left : row.source.right)?.path;

        if (own != null && isPathWithin(reveal.path, own) && reveal.path !== own) {
            state.expansion.set(row.id, true);

            return true;
        }
    }

    return state.expansion.get(row.id) ?? !row.collapsed;
}

// The side headers and one aligned, shared-scroll grid of both values.
export function buildAlignedDiffPanel(options: AlignedDiffOptions): HTMLElement {
    const rows = visibleTreeRows(options.document, options.state);

    // The revealed path's parents are open and remembered now.
    options.state.reveal = null;

    const tree = renderAlignedTree({
        rows,
        onArrayClick: options.onArrayClick,
        onToggle: (row) => {
            options.state.expansion.set(row.id, !row.expanded);
            options.rerender();
        },
    });
    const scroller = h('div', {
        class: 'aligned-scroller',
        dataset: { scrollKey: 'tree' },
        attrs: { tabindex: '0', role: 'region', 'aria-label': 'Both sides, row for row' },
        children: [tree],
    });

    return h('div', {
        class: 'aligned-diff',
        children: [
            h('div', {
                class: 'aligned-headers',
                children: [buildDiffSideHeader('original', options.original), buildDiffSideHeader('modified', options.modified)],
            }),
            scroller,
        ],
    });
}

export interface AlignedNavigationOptions {
    // The panel buildAlignedDiffPanel made, and the document it shows.
    readonly panel: HTMLElement;
    readonly document: TreeDiffDocument;
    // Where n, p, ↑ and ↓ step.
    readonly keyScope: HTMLElement;
    readonly state: AlignedDiffState & { readonly navigation: DiffNavigationState };
    readonly rerender: () => void;
    readonly onRecompute: () => void;
}

// The node a change sits on: the modified side for an addition, the original otherwise.
function revealOf(change: DiffChange): AlignedReveal | null {
    const pointer = change.location.pointer;

    return pointer == null ? null : { side: change.kind === 'added' ? 'right' : 'left', path: pointer };
}

// The bar over a JSON or XML diff, stepping through the changes in the document's order, top to bottom.
export function attachAlignedNavigation(options: AlignedNavigationOptions): void {
    const { panel, state } = options;
    const scroller = panel.querySelector<HTMLElement>('.aligned-scroller') ?? panel;
    const byId = new Map(options.document.changes.map((change) => [change.id, change]));
    let rows: Map<string, HTMLElement> | null = null;

    // Rows by side and path, read once per render.
    const rowOf = (target: AlignedReveal): HTMLElement | null => {
        if (rows == null) {
            const found = new Map<string, HTMLElement>();

            for (const cell of panel.querySelectorAll<HTMLElement>('.aligned-cell[data-path]')) {
                const row = cell.closest<HTMLElement>('.aligned-row');
                const key = `${cell.dataset['side']}:${cell.dataset['path']}`;

                if (row != null && !found.has(key)) {
                    found.set(key, row);
                }
            }

            rows = found;
        }

        return rows.get(`${target.side === 'left' ? 'original' : 'modified'}:${target.path}`) ?? null;
    };

    const changes = navigationChangesOf(options.document.changes, {
        labelled: true,
        locate: (change) => {
            const target = revealOf(change);
            const row = target == null ? null : rowOf(target);

            return row == null ? [] : [row];
        },
    });

    attachDiffNavigation({
        host: panel,
        scroller,
        keyScope: options.keyScope,
        state: state.navigation,
        rowSelector: '.aligned-row',
        changes: () => changes,
        onReveal: (change) => {
            const source = byId.get(change.id);
            state.reveal = source == null ? null : revealOf(source);
            options.rerender();
        },
        onRecompute: options.onRecompute,
    });
}
