import type { DialogPath } from './dialog.js';
import { showDialogAsync } from './dialog.js';

export interface ConfirmOptions {
    readonly title?: string;
    readonly body: string;
    readonly tone?: 'default' | 'danger';
    readonly paths?: ReadonlyArray<DialogPath>;
    readonly confirmLabel?: string;
    readonly cancelLabel?: string;
}

// Confirmation prompt on top of the unified dialog.
// Returns true when the user picks the primary action.
export async function confirmActionAsync(options: ConfirmOptions | string): Promise<boolean> {
    const normalised = typeof options === 'string'
        ? { body: options }
        : options;
    const result = await showDialogAsync({
        title: normalised.title ?? 'Confirm',
        body: normalised.body,
        tone: normalised.tone,
        paths: normalised.paths,
        kind: {
            kind: 'two-button',
            confirmLabel: normalised.confirmLabel ?? 'OK',
            cancelLabel: normalised.cancelLabel ?? 'Cancel',
            tone: normalised.tone,
        },
    });

    return result.outcome === 'yes';
}

// The file is not read here, so a caller can check what it holds before reading it as text.
export interface PickedDiskFile {
    readonly path: string;
    readonly file: File;
}

export async function pickFileFromDiskAsync(): Promise<PickedDiskFile | null> {
    try {
        const [handle] = await window.showOpenFilePicker({ multiple: false });

        if (handle == null) {
            return null;
        }

        const file = await handle.getFile();

        return { path: file.name, file };
    }
    catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            return null;
        }

        throw error;
    }
}
