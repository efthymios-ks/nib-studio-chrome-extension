// The editor always holds text with `\n` line breaks, so files keep their own line ending
// by detecting it on load, comparing texts without it, and putting it back on save.

export type LineEnding = '\n' | '\r\n' | '\r';

const LINE_BREAK_PATTERN = /\r\n|\r|\n/g;

// The most common line ending in the text; `\n` when there is none or on a tie with it.
export function detectLineEnding(text: string): LineEnding {
    let unix = 0;
    let windows = 0;
    let classicMac = 0;

    for (const match of text.matchAll(LINE_BREAK_PATTERN)) {
        if (match[0] === '\r\n') {
            windows++;
        }
        else if (match[0] === '\r') {
            classicMac++;
        }
        else {
            unix++;
        }
    }

    if (windows > unix && windows >= classicMac) {
        return '\r\n';
    }

    if (classicMac > unix && classicMac > windows) {
        return '\r';
    }

    return '\n';
}

// Every line break in the text, of any kind, becomes `\n`.
// Runs on every edit, so text without a carriage return comes back as it is.
export function normalizeLineEndings(text: string): string {
    return text.includes('\r') ? text.replace(LINE_BREAK_PATTERN, '\n') : text;
}

// Every line break in the text, of any kind, becomes the given ending.
export function applyLineEnding(text: string, ending: LineEnding): string {
    if (ending === '\n') {
        return normalizeLineEndings(text);
    }

    return text.replace(LINE_BREAK_PATTERN, ending);
}
