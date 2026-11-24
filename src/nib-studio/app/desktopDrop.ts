import { readDroppedItemsAsync, type DroppedItem } from './droppedItems.js';

// Files and folders dragged in from the computer: the hints while they are over the window,
// and opening whatever the Explorer tree and the diff drop zones leave alone.

const OPEN_HINT = 'Drop to open';
const IMPORT_HINT = 'Drop on a folder to import';

export interface DesktopDropOptions {
    readonly sidebar: HTMLElement;
    readonly main: HTMLElement;
    // True while a workspace is open, so the Explorer tree imports what is dropped on it.
    readonly canImport: () => boolean;
    readonly onOpen: (items: Promise<DroppedItem[]>) => void;
    readonly onClear?: () => void;
}

export interface DesktopDropHandle {
    readonly dispose: () => void;
}

export function registerDesktopDrop(options: DesktopDropOptions): DesktopDropHandle {
    // Every element the pointer enters fires dragenter before the one it leaves fires dragleave,
    // so the count only drops to zero when the pointer leaves the window.
    const tracking = { depth: 0, active: false };

    const show = (): void => {
        tracking.active = true;
        options.main.dataset['dropHint'] = OPEN_HINT;

        if (options.canImport()) {
            options.sidebar.dataset['dropHint'] = IMPORT_HINT;
        }
        else {
            delete options.sidebar.dataset['dropHint'];
        }
    };

    const clear = (): void => {
        tracking.depth = 0;

        if (!tracking.active) {
            return;
        }

        tracking.active = false;
        delete options.main.dataset['dropHint'];
        delete options.sidebar.dataset['dropHint'];
        options.onClear?.();
    };

    const onDragEnter = (event: DragEvent): void => {
        if (!isFileDrag(event)) {
            return;
        }

        event.preventDefault();
        tracking.depth += 1;
        show();
    };

    const onDragOver = (event: DragEvent): void => {
        if (!isFileDrag(event)) {
            return;
        }

        // Without it Chrome leaves the studio to show the dropped file.
        event.preventDefault();

        if (event.dataTransfer != null) {
            event.dataTransfer.dropEffect = 'copy';
        }

        if (!tracking.active) {
            show();
        }
    };

    const onDragLeave = (event: DragEvent): void => {
        if (!isFileDrag(event)) {
            return;
        }

        tracking.depth = Math.max(0, tracking.depth - 1);

        if (tracking.depth === 0 || leftWindow(event)) {
            clear();
        }
    };

    // Runs before any element sees the drop, so the hints go even when a drop zone stops the event,
    // and editors don't also paste the dropped file's text.
    const onDropCapture = (event: DragEvent): void => {
        if (!isFileDrag(event)) {
            return;
        }

        event.preventDefault();
        clear();
    };

    // Reached only by drops that the Explorer tree and the diff drop zones leave alone.
    const onDrop = (event: DragEvent): void => {
        if (!isFileDrag(event) || event.dataTransfer == null) {
            return;
        }

        options.onOpen(readDroppedItemsAsync(event.dataTransfer));
    };

    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            clear();
        }
    };

    window.addEventListener('dragenter', onDragEnter, true);
    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('dragleave', onDragLeave, true);
    window.addEventListener('drop', onDropCapture, true);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', clear, true);
    window.addEventListener('keydown', onKeyDown, true);

    return {
        dispose: () => {
            window.removeEventListener('dragenter', onDragEnter, true);
            window.removeEventListener('dragover', onDragOver, true);
            window.removeEventListener('dragleave', onDragLeave, true);
            window.removeEventListener('drop', onDropCapture, true);
            window.removeEventListener('drop', onDrop);
            window.removeEventListener('dragend', clear, true);
            window.removeEventListener('keydown', onKeyDown, true);
            clear();
        },
    };
}

function isFileDrag(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

// A leave with no element to go to and a point on or past the window's edge means the pointer left the window.
function leftWindow(event: DragEvent): boolean {
    if (event.relatedTarget != null) {
        return false;
    }

    const { clientX, clientY } = event;

    if (typeof clientX !== 'number' || typeof clientY !== 'number') {
        return false;
    }

    return clientX <= 0
        || clientY <= 0
        || clientX >= window.innerWidth
        || clientY >= window.innerHeight;
}
