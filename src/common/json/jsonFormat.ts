import { parseJson, type JsonParseError } from './jsonTree.js';

// Format: a 2-space indent, as the editor's Format and Copy formatted lay JSON out. Minify: one line, no spaces.
export type JsonLayout = 'format' | 'minify';

export type JsonFormatResult = { readonly ok: true; readonly text: string } | JsonParseError;

// The document laid out again, its values and key order kept; a text that isn't JSON gives where it stopped.
export function formatJson(text: string, layout: JsonLayout): JsonFormatResult {
    const parsed = parseJson(text);

    if (!parsed.ok) {
        return parsed;
    }

    return { ok: true, text: JSON.stringify(parsed.value, null, layout === 'format' ? 2 : undefined) };
}
