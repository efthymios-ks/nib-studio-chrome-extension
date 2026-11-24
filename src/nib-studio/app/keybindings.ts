import { shortcutLetter } from './shortcutKey.js';

// Tree keybindings — installed as listeners on the explorer container.
// All handlers delegate through callbacks so file I/O stays in the App.
// Returns a dispose() to remove every listener.

export interface TreeKeybindingCallbacks {
    readonly getFocusedPath: () => string | null;
    readonly getVisiblePaths: () => ReadonlyArray<string>;
    readonly isDirectory: (path: string) => boolean;
    readonly isExpanded: (path: string) => boolean;
    readonly getParentOf: (path: string) => string | null;
    readonly getFirstChildOf: (path: string) => string | null;
    readonly focusPath: (path: string) => void;
    readonly onOpen: (path: string) => void;
    readonly onExpand: (path: string) => void;
    readonly onCollapse: (path: string) => void;
    readonly onRename: (path: string) => void;
    readonly onDelete: () => void;
    readonly onDuplicate: (path: string) => void;
    readonly onSelectAll: () => void;
    readonly onClearSelection: () => void;
}

export interface TreeKeybindingHandle {
    readonly dispose: () => void;
}

// Installs key listeners scoped to the tree container; listeners only fire when
// focus is inside the container, so the editor still gets its own keys.
export function registerTreeKeybindings(
    treeElement: HTMLElement,
    callbacks: TreeKeybindingCallbacks,
): TreeKeybindingHandle {
    const handleKey = (event: KeyboardEvent): void => {
        if (!treeElement.contains(event.target as Node | null) && event.target !== treeElement) {
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveFocus(callbacks, 1);

            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveFocus(callbacks, -1);

            return;
        }

        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            handleLeft(callbacks);

            return;
        }

        if (event.key === 'ArrowRight') {
            event.preventDefault();
            handleRight(callbacks);

            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            handleEnter(callbacks);

            return;
        }

        if (event.key === 'F2') {
            event.preventDefault();
            const path = callbacks.getFocusedPath();

            if (path != null) {
                callbacks.onRename(path);
            }

            return;
        }

        if (event.key === 'Delete') {
            event.preventDefault();
            callbacks.onDelete();

            return;
        }

        if ((event.ctrlKey || event.metaKey) && shortcutLetter(event) === 'd') {
            event.preventDefault();
            const path = callbacks.getFocusedPath();

            if (path != null) {
                callbacks.onDuplicate(path);
            }

            return;
        }

        if ((event.ctrlKey || event.metaKey) && shortcutLetter(event) === 'a') {
            event.preventDefault();
            callbacks.onSelectAll();

            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            callbacks.onClearSelection();
        }
    };

    treeElement.addEventListener('keydown', handleKey);

    return {
        dispose: () => treeElement.removeEventListener('keydown', handleKey),
    };
}

function moveFocus(callbacks: TreeKeybindingCallbacks, delta: number): void {
    const visible = callbacks.getVisiblePaths();

    if (visible.length === 0) {
        return;
    }

    const focused = callbacks.getFocusedPath();
    const currentIndex = focused == null ? -1 : visible.indexOf(focused);
    const nextIndex = Math.min(Math.max(currentIndex + delta, 0), visible.length - 1);
    const nextPath = visible[nextIndex];

    if (nextPath != null) {
        callbacks.focusPath(nextPath);
    }
}

function handleLeft(callbacks: TreeKeybindingCallbacks): void {
    const path = callbacks.getFocusedPath();

    if (path == null) {
        return;
    }

    if (callbacks.isDirectory(path) && callbacks.isExpanded(path)) {
        callbacks.onCollapse(path);

        return;
    }

    const parent = callbacks.getParentOf(path);

    if (parent != null && parent !== '') {
        callbacks.focusPath(parent);
    }
}

function handleRight(callbacks: TreeKeybindingCallbacks): void {
    const path = callbacks.getFocusedPath();

    if (path == null) {
        return;
    }

    if (!callbacks.isDirectory(path)) {
        return;
    }

    if (!callbacks.isExpanded(path)) {
        callbacks.onExpand(path);

        return;
    }

    const firstChild = callbacks.getFirstChildOf(path);

    if (firstChild != null) {
        callbacks.focusPath(firstChild);
    }
}

function handleEnter(callbacks: TreeKeybindingCallbacks): void {
    const path = callbacks.getFocusedPath();

    if (path == null) {
        return;
    }

    if (callbacks.isDirectory(path)) {
        if (callbacks.isExpanded(path)) {
            callbacks.onCollapse(path);
        }
        else {
            callbacks.onExpand(path);
        }

        return;
    }

    callbacks.onOpen(path);
}
