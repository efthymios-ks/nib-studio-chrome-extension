import { decodeHtmlEntities } from '../encoding/htmlEntities.js';

// The text Lookup keeps of a file: flattened to one line, every run of white space and control characters as one space,
// and at most this many characters of it.
export const MAX_TEXT_CHARS = 2_000_000;

// A named part of a file's lines, such as one sheet of a workbook: the line it starts on, counting from 1,
// and the number its first line has within it, such as the sheet's row number.
export interface TextSection {
    readonly name: string;
    readonly firstLine: number;
    readonly firstNumber: number;
}

export interface FlatText {
    readonly text: string;
    // For a text file, where the line after each line break of the original starts in the flat text,
    // so a place in the flat text gives its line number; null for documents, which have no lines of their own.
    readonly lineStarts: Int32Array | null;
}

const BREAKS = /[\s\x00-\x1f\x7f]+/gu;
const REFERENCE = /&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/gu;
const LINE_BREAK = /\r\n|\r|\n/gu;

export function flattenText(text: string, options: { readonly keepLines: boolean }): FlatText {
    const parts: string[] = [];
    const lineStarts: number[] = [];
    let length = 0;
    let last = 0;
    BREAKS.lastIndex = 0;

    for (let match = BREAKS.exec(text); match != null && length < MAX_TEXT_CHARS; match = BREAKS.exec(text)) {
        const word = text.slice(last, match.index);
        parts.push(word);
        length += word.length;
        last = match.index + match[0].length;

        // White space at either end goes, so the text starts and ends with a word.
        if (length > 0 && last < text.length) {
            parts.push(' ');
            length += 1;
        }

        if (options.keepLines) {
            for (let count = countLineBreaks(match[0]); count > 0; count -= 1) {
                lineStarts.push(length);
            }
        }
    }

    if (length < MAX_TEXT_CHARS && last < text.length) {
        parts.push(text.slice(last));
    }

    const flat = parts.join('');

    return {
        text: flat.length > MAX_TEXT_CHARS ? flat.slice(0, MAX_TEXT_CHARS) : flat,
        lineStarts: options.keepLines ? Int32Array.from(lineStarts) : null,
    };
}

function countLineBreaks(space: string): number {
    if (!space.includes('\n') && !space.includes('\r')) {
        return 0;
    }

    return space.match(LINE_BREAK)?.length ?? 0;
}

// The line, counting from 1, that a place in the flat text lies on.
export function lineAt(lineStarts: Int32Array, position: number): number {
    let low = 0;
    let high = lineStarts.length;

    while (low < high) {
        const middle = (low + high) >>> 1;

        if ((lineStarts[middle] ?? 0) <= position) {
            low = middle + 1;
        }
        else {
            high = middle;
        }
    }

    return low + 1;
}

// The section a line lies in, and the line's number within it; null when the line comes before every section.
export function sectionAt(
    sections: ReadonlyArray<TextSection>,
    line: number,
): { readonly name: string; readonly number: number } | null {
    let found: TextSection | null = null;

    for (const section of sections) {
        if (section.firstLine > line) {
            break;
        }

        found = section;
    }

    return found == null ? null : { name: found.name, number: found.firstNumber + line - found.firstLine };
}

// Decodes the character references of HTML or XML text; one the studio doesn't know stays as it is written.
export function decodeReferences(text: string): string {
    if (!text.includes('&')) {
        return text;
    }

    return text.replace(REFERENCE, (reference) => {
        const decoded = decodeHtmlEntities(reference);

        return decoded.ok ? decoded.value : reference;
    });
}
