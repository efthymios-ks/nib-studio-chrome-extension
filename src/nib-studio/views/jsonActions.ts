import { notValidMessage } from '../../common/errorMessage.js';
import { parseJson } from '../../common/json/jsonTree.js';
import type { OpenFile } from '../app/store.js';
import { toast } from '../app/toast.js';

export type JsonTransform = 'format' | 'minify';

export interface JsonActionCallbacks {
    readonly onChange: (path: string, text: string) => void;
}

// Applies Format (2-space pretty print) or Minify to an OpenFile and dispatches
// the result through onChange. Shows a toast when the document is not valid JSON.
export function applyJsonTransform(
    file: OpenFile,
    callbacks: JsonActionCallbacks,
    mode: JsonTransform,
): void {
    const parsed = parseJson(file.text);

    if (!parsed.ok) {
        toast(notValidMessage('JSON', parsed), 'fail');

        return;
    }

    const next = mode === 'format'
        ? JSON.stringify(parsed.value, null, 2)
        : JSON.stringify(parsed.value);
    callbacks.onChange(file.path, next);
}
