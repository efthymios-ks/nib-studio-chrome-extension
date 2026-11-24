import type { DirectoryEntry, FileEntry } from '../../common/fs/fileEntry.js';
import { isDirectoryEntry } from '../../common/fs/fileEntry.js';
import { resolveFileType } from '../../common/fs/fileTypes.js';
import { clear, h } from '../app/dom.js';
import { attachLongPress, prefersCoarsePointer } from '../app/longPress.js';
import { showContextMenu, type ContextMenuGroup } from './contextMenu.js';
import type { SelectionState } from './selection.js';

export type ClickKind = 'plain' | 'toggle' | 'range';

export interface ExplorerCallbacks {
    readonly onToggleFolder: (path: string) => void;
    readonly onOpen: (path: string) => void;
    readonly onSelectClick: (path: string, kind: ClickKind) => void;
    readonly onContextMenu: (event: MouseEvent, path: string | null) => void;
}

export interface ExplorerState {
    readonly tree: DirectoryEntry | null;
    readonly openPaths: ReadonlySet<string>;
    readonly dirtyPaths: ReadonlySet<string>;
    readonly selection: SelectionState;
    readonly focusedPath: string | null;
}

export interface ExplorerRender {
    // Pre-order list of every row's path, root first.
    // Used by range selection and keyboard navigation.
    readonly visiblePaths: ReadonlyArray<string>;
}

export function renderExplorer(
    container: HTMLElement,
    state: ExplorerState,
    callbacks: ExplorerCallbacks,
): ExplorerRender {
    clear(container);
    container.setAttribute('tabindex', '0');

    if (state.tree == null) {
        container.append(h('div', {
            class: 'tree-empty',
            text: 'No workspace open. Pick a folder to get started.',
        }));
        bindEmptyAreaContextMenu(container, callbacks);

        return { visiblePaths: [] };
    }

    const visible: string[] = [];
    const list = h('ul', { class: 'tree-list', attrs: { role: 'tree' } });

    for (const child of state.tree.children) {
        list.append(renderEntry(child, state, callbacks, visible));
    }

    container.append(list);
    bindEmptyAreaContextMenu(container, callbacks);

    return { visiblePaths: visible };
}

function renderEntry(
    entry: FileEntry,
    state: ExplorerState,
    callbacks: ExplorerCallbacks,
    visible: string[],
): HTMLElement {
    if (isDirectoryEntry(entry)) {
        return renderDirectory(entry, state, callbacks, visible);
    }

    return renderFile(entry, state, callbacks, visible);
}

function renderDirectory(
    entry: DirectoryEntry,
    state: ExplorerState,
    callbacks: ExplorerCallbacks,
    visible: string[],
): HTMLElement {
    visible.push(entry.path);
    const dataset: Record<string, string> = { path: entry.path, kind: 'directory' };

    if (state.selection.selectedPaths.has(entry.path)) {
        dataset['selected'] = 'true';
    }

    if (state.focusedPath === entry.path) {
        dataset['focused'] = 'true';
    }

    const row = h('div', {
        class: 'tree-row',
        attrs: { draggable: rowDraggable(), title: entry.path },
        dataset,
        aria: { expanded: entry.expanded ? 'true' : 'false' },
        children: [
            h('span', {
                class: 'tree-icon',
                dataset: { type: 'folder', open: entry.expanded ? 'true' : 'false' },
            }),
            h('span', { class: 'tree-name', text: entry.name }),
        ],
        on: {
            click: (event) => {
                const mouse = event as MouseEvent;
                event.stopPropagation();
                callbacks.onSelectClick(entry.path, clickKind(mouse));

                // Ctrl/Shift click only mutates selection.
                // A plain click on a folder additionally toggles expansion.
                if (clickKind(mouse) === 'plain') {
                    callbacks.onToggleFolder(entry.path);
                }
            },
            contextmenu: (event) => {
                event.stopPropagation();
                callbacks.onContextMenu(event as MouseEvent, entry.path);
            },
        },
    });

    attachLongPress(row);

    const node = h('li', {
        attrs: { role: 'treeitem' },
        children: [row],
    });

    if (entry.expanded && entry.children.length > 0) {
        const children = h('ul', { class: 'tree-children' });

        for (const child of entry.children) {
            children.append(renderEntry(child, state, callbacks, visible));
        }

        node.append(children);
    }

    return node;
}

function renderFile(
    entry: FileEntry,
    state: ExplorerState,
    callbacks: ExplorerCallbacks,
    visible: string[],
): HTMLElement {
    visible.push(entry.path);
    const dataset: Record<string, string> = { path: entry.path, kind: 'file' };

    if (state.selection.selectedPaths.has(entry.path)) {
        dataset['selected'] = 'true';
    }

    if (state.focusedPath === entry.path) {
        dataset['focused'] = 'true';
    }

    if (state.dirtyPaths.has(entry.path)) {
        dataset['dirty'] = 'true';
    }

    const fileType = resolveFileType(entry.name);
    const row = h('div', {
        class: 'tree-row',
        attrs: { draggable: rowDraggable(), title: entry.path },
        dataset,
        children: [
            h('span', {
                class: 'tree-icon',
                text: fileType.glyph,
                dataset: { type: fileType.id },
            }),
            h('span', { class: 'tree-name', text: entry.name }),
        ],
        on: {
            click: (event) => {
                const mouse = event as MouseEvent;
                event.stopPropagation();
                callbacks.onSelectClick(entry.path, clickKind(mouse));
            },
            dblclick: (event) => {
                event.stopPropagation();
                callbacks.onOpen(entry.path);
            },
            contextmenu: (event) => {
                event.stopPropagation();
                callbacks.onContextMenu(event as MouseEvent, entry.path);
            },
        },
    });

    attachLongPress(row);

    return h('li', {
        attrs: { role: 'treeitem' },
        children: [row],
    });
}

// On touch-first devices a long-press opens the context menu instead of starting a drag.
function rowDraggable(): 'true' | 'false' {
    return prefersCoarsePointer() ? 'false' : 'true';
}

function clickKind(event: MouseEvent): ClickKind {
    if (event.shiftKey) {
        return 'range';
    }

    if (event.ctrlKey || event.metaKey) {
        return 'toggle';
    }

    return 'plain';
}

// The container outlives each render, so the previous render's listener is swapped out rather than stacked.
const emptyAreaListeners = new WeakMap<HTMLElement, (event: MouseEvent) => void>();

function bindEmptyAreaContextMenu(container: HTMLElement, callbacks: ExplorerCallbacks): void {
    const previous = emptyAreaListeners.get(container);

    if (previous != null) {
        container.removeEventListener('contextmenu', previous);
    }

    const listener = (event: MouseEvent): void => {
        if ((event.target as HTMLElement).closest('.tree-row') != null) {
            return;
        }

        event.preventDefault();
        callbacks.onContextMenu(event, null);
    };
    emptyAreaListeners.set(container, listener);
    container.addEventListener('contextmenu', listener);
}

// Re-exported for App: the shared command registry assembles the groups and
// the explorer shows them via the shared context-menu renderer.
export function openExplorerMenu(event: MouseEvent, groups: ReadonlyArray<ContextMenuGroup>): void {
    showContextMenu(event, groups);
}
