import { notValidMessage } from '../../common/errorMessage.js';
import { formatJson, type JsonLayout } from '../../common/json/jsonFormat.js';
import type { OpenFile } from '../app/store.js';
import { toast } from '../app/toast.js';

export interface JsonActionCallbacks {
    readonly onChange: (path: string, text: string) => void;
}

// Applies Format (2-space pretty print) or Minify to an OpenFile and dispatches
// the result through onChange. Shows a toast when the document is not valid JSON.
export function applyJsonTransform(
    file: OpenFile,
    callbacks: JsonActionCallbacks,
    mode: JsonLayout,
): void {
    const formatted = formatJson(file.text, mode);

    if (!formatted.ok) {
        toast(notValidMessage('JSON', formatted), 'fail');

        return;
    }

    callbacks.onChange(file.path, formatted.text);
}
