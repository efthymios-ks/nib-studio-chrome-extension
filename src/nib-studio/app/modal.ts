import type { DialogPath } from './dialog.js';
import { showDialogAsync } from './dialog.js';

export type ModalTone = 'default' | 'danger';

export interface TextInputModalOptions {
    readonly title: string;
    readonly label: string;
    readonly initialValue?: string;
    readonly confirmLabel?: string;
    readonly cancelLabel?: string;
    readonly hint?: string;
    readonly tone?: ModalTone;
    readonly selectionRange?: 'all' | 'basename';
    readonly validate?: (value: string) => string | null;
    readonly paths?: ReadonlyArray<DialogPath>;
}

// Text-input prompt on top of the unified dialog.
// Returns the entered text, or null if the user cancelled.
export async function showTextInputModalAsync(options: TextInputModalOptions): Promise<string | null> {
    const result = await showDialogAsync({
        title: options.title,
        body: options.hint ?? options.label,
        tone: options.tone,
        paths: options.paths,
        kind: {
            kind: 'input',
            initialValue: options.initialValue,
            selectionRange: options.selectionRange,
            validate: options.validate,
        },
    });

    if (result.outcome === 'input') {
        return result.value;
    }

    return null;
}
