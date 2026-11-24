// Drag and drop on the Explorer tree: moves inside the tree and imports from the computer.
import { basename, joinPath, parentPath } from '../../common/fs/fileEntry.js';
import { readDroppedItemsAsync, type DroppedItem } from '../app/droppedItems.js';

export const INTERNAL_MIME = 'application/x-nib-studio-paths';
const EXPAND_HOVER_MS = 700;
const EDGE_SCROLL_ZONE_PX = 32;
const EDGE_SCROLL_STEP_PX = 12;

export interface DragDropCallbacks {
    // Fired for a drag inside the tree; the handler asks whether to move or copy.
    readonly onDrop: (sourcePaths: ReadonlyArray<string>, targetFolderPath: string) => void;
    // Fired for files and folders dropped from the computer while `canImport` holds.
    readonly onDropFromDesktop: (items: Promise<DroppedItem[]>, targetFolderPath: string) => void;
    // Without a workspace the tree leaves desktop drops to the window, which opens them.
    readonly canImport: () => boolean;
    readonly getSelectedPaths: () => ReadonlyArray<string>;
    readonly isDirectory: (path: string) => boolean;
    readonly expandFolder: (path: string) => void;
}

export interface DragDropHandle {
    // Removes the drop target highlight and stops the pending folder expand and edge scroll.
    readonly clearHighlight: () => void;
    readonly dispose: () => void;
}

// True when `target` is `source` or sits inside it; paths use forward slashes and no trailing slash.
export function isDescendant(target: string, source: string): boolean {
    if (source === '') {
        return false;
    }

    if (target === source) {
        return true;
    }

    return target.startsWith(`${source}/`);
}

// The sources a drop on `targetFolder` would move or copy: an item already in that folder stays where it is.
export function sourcesOutsideFolder(sources: ReadonlyArray<string>, targetFolder: string): ReadonlyArray<string> {
    return sources.filter((source) => parentPath(source) !== targetFolder);
}

// The folder a drop lands in: a file row gives its parent, empty tree space gives '' for the workspace root.
function resolveTargetFolder(
    event: DragEvent,
    treeElement: HTMLElement,
    isDirectory: (path: string) => boolean,
): string | null {
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('.tree-row');

    if (row == null) {
        if (treeElement.contains(event.target as Node | null)) {
            return '';
        }

        return null;
    }

    const path = row.dataset['path'];

    if (path == null) {
        return '';
    }

    if (isDirectory(path)) {
        return path;
    }

    return parentPath(path);
}

export interface Collision {
    readonly sourcePath: string;
    readonly targetPath: string;
    readonly name: string;
}

// The sources whose name already exists in the target folder.
export function detectCollisions(
    sources: ReadonlyArray<string>,
    targetFolder: string,
    existingNamesInTarget: ReadonlySet<string>,
): ReadonlyArray<Collision> {
    const result: Collision[] = [];

    for (const source of sources) {
        const name = basename(source);

        if (existingNamesInTarget.has(name)) {
            result.push({
                sourcePath: source,
                targetPath: joinPath(targetFolder, name),
                name,
            });
        }
    }

    return result;
}

interface DragDropContext {
    hoverTimer: number | null;
    hoverPath: string | null;
    scrollTimer: number | null;
}

export function registerDragDrop(
    treeElement: HTMLElement,
    callbacks: DragDropCallbacks,
): DragDropHandle {
    const context: DragDropContext = {
        hoverTimer: null,
        hoverPath: null,
        scrollTimer: null,
    };

    const onDragStart = (event: DragEvent): void => {
        const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('.tree-row');
        const path = row?.dataset['path'];

        if (row == null || path == null || event.dataTransfer == null) {
            return;
        }

        // A row inside a multi-selection drags the whole selection.
        const selected = callbacks.getSelectedPaths();
        const payload = selected.includes(path) && selected.length > 1 ? selected : [path];
        event.dataTransfer.setData(INTERNAL_MIME, JSON.stringify(payload));
        event.dataTransfer.effectAllowed = 'move';
        row.dataset['dragging'] = 'true';
    };

    const onDragEnd = (event: DragEvent): void => {
        const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('.tree-row');

        if (row != null) {
            delete row.dataset['dragging'];
        }

        clearHover(context, treeElement);
        clearScroll(context);
    };

    const onDragOver = (event: DragEvent): void => {
        if (event.dataTransfer == null) {
            return;
        }

        const fromDesktop = event.dataTransfer.types.includes('Files');
        const fromInside = event.dataTransfer.types.includes(INTERNAL_MIME);

        if ((!fromDesktop && !fromInside) || (fromDesktop && !callbacks.canImport())) {
            return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = fromDesktop ? 'copy' : 'move';

        const targetFolder = resolveTargetFolder(event, treeElement, callbacks.isDirectory);
        applyDropHighlight(treeElement, targetFolder);
        maybeExpandOnHover(context, targetFolder, callbacks);
        maybeEdgeScroll(event, treeElement, context);
    };

    const onDragLeave = (event: DragEvent): void => {
        const next = event.relatedTarget as Node | null;

        if (next != null && treeElement.contains(next)) {
            return;
        }

        // Without a related target the pointer may still be over the tree; the next dragover restores the highlight.
        if (next == null) {
            clearDropHighlight(treeElement);

            return;
        }

        clearHover(context, treeElement);
        clearScroll(context);
    };

    const onDrop = (event: DragEvent): void => {
        if (event.dataTransfer == null) {
            return;
        }

        const fromDesktop = event.dataTransfer.types.includes('Files');
        const fromInside = event.dataTransfer.types.includes(INTERNAL_MIME);

        if ((!fromDesktop && !fromInside) || (fromDesktop && !callbacks.canImport())) {
            return;
        }

        event.preventDefault();
        clearHover(context, treeElement);
        clearScroll(context);

        const targetFolder = resolveTargetFolder(event, treeElement, callbacks.isDirectory);

        if (fromDesktop) {
            // The tree takes the drop, so the window doesn't also open it.
            event.stopPropagation();
            callbacks.onDropFromDesktop(readDroppedItemsAsync(event.dataTransfer), targetFolder ?? '');

            return;
        }

        if (targetFolder == null) {
            return;
        }

        const raw = event.dataTransfer.getData(INTERNAL_MIME);

        if (raw === '') {
            return;
        }

        let sources: ReadonlyArray<string>;

        try {
            const parsed: unknown = JSON.parse(raw);

            if (!Array.isArray(parsed)) {
                return;
            }

            sources = parsed.filter((value): value is string => typeof value === 'string');
        }
        catch {
            return;
        }

        // A folder can't go into itself or its own subfolders.
        for (const source of sources) {
            if (isDescendant(targetFolder, source)) {
                return;
            }
        }

        callbacks.onDrop(sources, targetFolder);
    };

    treeElement.addEventListener('dragstart', onDragStart);
    treeElement.addEventListener('dragend', onDragEnd);
    treeElement.addEventListener('dragover', onDragOver);
    treeElement.addEventListener('dragleave', onDragLeave);
    treeElement.addEventListener('drop', onDrop);

    const clearHighlight = (): void => {
        clearHover(context, treeElement);
        clearScroll(context);
    };

    return {
        clearHighlight,
        dispose: () => {
            treeElement.removeEventListener('dragstart', onDragStart);
            treeElement.removeEventListener('dragend', onDragEnd);
            treeElement.removeEventListener('dragover', onDragOver);
            treeElement.removeEventListener('dragleave', onDragLeave);
            treeElement.removeEventListener('drop', onDrop);
            clearHighlight();
        },
    };
}

function applyDropHighlight(treeElement: HTMLElement, targetFolder: string | null): void {
    clearDropHighlight(treeElement);

    if (targetFolder == null) {
        return;
    }

    if (targetFolder === '') {
        treeElement.dataset['dropRoot'] = 'true';

        return;
    }

    const rows = treeElement.querySelectorAll<HTMLElement>('.tree-row');

    for (const row of rows) {
        if (row.dataset['path'] === targetFolder) {
            row.dataset['dropTarget'] = 'true';
        }
    }
}

function clearDropHighlight(treeElement: HTMLElement): void {
    delete treeElement.dataset['dropRoot'];
    const rows = treeElement.querySelectorAll<HTMLElement>('.tree-row[data-drop-target]');

    for (const row of rows) {
        delete row.dataset['dropTarget'];
    }
}

function maybeExpandOnHover(
    context: DragDropContext,
    folder: string | null,
    callbacks: DragDropCallbacks,
): void {
    if (folder == null || folder === '') {
        clearHoverTimer(context);
        context.hoverPath = null;

        return;
    }

    if (context.hoverPath === folder) {
        return;
    }

    clearHoverTimer(context);
    context.hoverPath = folder;
    context.hoverTimer = window.setTimeout(() => {
        context.hoverTimer = null;

        if (context.hoverPath === folder && callbacks.isDirectory(folder)) {
            callbacks.expandFolder(folder);
        }
    }, EXPAND_HOVER_MS);
}

function clearHoverTimer(context: DragDropContext): void {
    if (context.hoverTimer != null) {
        window.clearTimeout(context.hoverTimer);
        context.hoverTimer = null;
    }
}

function clearHover(context: DragDropContext, treeElement: HTMLElement): void {
    clearHoverTimer(context);
    context.hoverPath = null;
    clearDropHighlight(treeElement);
}

function maybeEdgeScroll(event: DragEvent, treeElement: HTMLElement, context: DragDropContext): void {
    const bounds = treeElement.getBoundingClientRect();
    const fromTop = event.clientY - bounds.top;
    const fromBottom = bounds.bottom - event.clientY;
    let delta = 0;

    if (fromTop < EDGE_SCROLL_ZONE_PX) {
        delta = -EDGE_SCROLL_STEP_PX;
    }
    else if (fromBottom < EDGE_SCROLL_ZONE_PX) {
        delta = EDGE_SCROLL_STEP_PX;
    }

    if (delta === 0) {
        clearScroll(context);

        return;
    }

    if (context.scrollTimer != null) {
        return;
    }

    context.scrollTimer = window.setInterval(() => {
        treeElement.scrollTop += delta;
    }, 60);
}

function clearScroll(context: DragDropContext): void {
    if (context.scrollTimer != null) {
        window.clearInterval(context.scrollTimer);
        context.scrollTimer = null;
    }
}
