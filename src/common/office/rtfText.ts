import { decodeCodePage } from './codePage.js';

// Groups whose content is never text: tables, metadata, pictures, embedded objects and field instructions.
const SKIPPED_DESTINATIONS = new Set([
    'fonttbl',
    'colortbl',
    'stylesheet',
    'info',
    'pict',
    'object',
    'objdata',
    'themedata',
    'colorschememapping',
    'datastore',
    'latentstyles',
    'listtable',
    'listoverridetable',
    'rsidtbl',
    'generator',
    'xmlnstbl',
    'fldinst',
    'header',
    'headerl',
    'headerr',
    'headerf',
    'footer',
    'footerl',
    'footerr',
    'footerf',
    'filetbl',
    'revtbl',
    'pgdsctbl',
    'mmathPr',
]);

// Control words that end a line or a paragraph, or stand for a character.
const CONTROL_TEXT: ReadonlyMap<string, string> = new Map([
    ['par', '\n'],
    ['line', '\n'],
    ['row', '\n'],
    ['sect', '\n'],
    ['page', '\n'],
    ['tab', '\t'],
    ['cell', '\t'],
    ['emdash', '—'],
    ['endash', '–'],
    ['bullet', '•'],
    ['lquote', '‘'],
    ['rquote', '’'],
    ['ldblquote', '“'],
    ['rdblquote', '”'],
    ['emspace', ' '],
    ['enspace', ' '],
]);

const CONTROL_SYMBOLS: ReadonlyMap<string, string> = new Map([
    ['\\', '\\'],
    ['{', '{'],
    ['}', '}'],
    ['~', ' '],
    ['_', '‑'],
    ['-', ''],
]);

interface GroupState {
    readonly isSkipped: boolean;
    readonly unicodeSkip: number;
}

// The plain text of an RTF document: its paragraphs, line breaks and tabs, without formatting, pictures or field codes.
// It is small rather than complete; anything it doesn't know is left out.
export function extractRtfText(source: string): string {
    const output: string[] = [];
    const stack: GroupState[] = [];
    let group: GroupState = { isSkipped: false, unicodeSkip: 1 };
    let codePage = 1252;
    let pendingBytes: number[] = [];
    let skipFallback = 0;
    let index = 0;

    const flushBytes = (): void => {
        if (pendingBytes.length > 0) {
            output.push(decodeCodePage(Uint8Array.from(pendingBytes), codePage));
            pendingBytes = [];
        }
    };

    const emit = (text: string): void => {
        if (group.isSkipped) {
            return;
        }

        flushBytes();
        output.push(text);
    };

    while (index < source.length) {
        const character = source[index] ?? '';

        if (character === '{') {
            flushBytes();
            stack.push(group);
            const isIgnorable = source.startsWith('\\*', index + 1);
            group = { isSkipped: group.isSkipped || isIgnorable, unicodeSkip: group.unicodeSkip };
            index += isIgnorable ? 3 : 1;
            continue;
        }

        if (character === '}') {
            flushBytes();
            group = stack.pop() ?? { isSkipped: false, unicodeSkip: 1 };
            skipFallback = 0;
            index += 1;
            continue;
        }

        if (character === '\r' || character === '\n') {
            index += 1;
            continue;
        }

        if (character !== '\\') {
            if (skipFallback > 0) {
                skipFallback -= 1;
            }
            else {
                emit(character);
            }

            index += 1;
            continue;
        }

        const next = source[index + 1] ?? '';

        if (next === '\'') {
            const byte = Number.parseInt(source.slice(index + 2, index + 4), 16);
            index += 4;

            if (skipFallback > 0) {
                skipFallback -= 1;
                continue;
            }

            if (!group.isSkipped && Number.isFinite(byte)) {
                pendingBytes.push(byte);
            }

            continue;
        }

        const symbol = CONTROL_SYMBOLS.get(next);

        if (symbol != null) {
            emit(symbol);
            index += 2;
            continue;
        }

        const word = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(source.slice(index, index + 40));

        if (word == null) {
            index += 2;
            continue;
        }

        index += word[0].length;
        const name = word[1] ?? '';
        const parameter = word[2] == null ? null : Number(word[2]);

        if (SKIPPED_DESTINATIONS.has(name)) {
            group = { ...group, isSkipped: true };
            continue;
        }

        if (name === 'ansicpg' && parameter != null) {
            codePage = parameter;
            continue;
        }

        if (name === 'uc' && parameter != null) {
            group = { ...group, unicodeSkip: parameter };
            continue;
        }

        if (name === 'u' && parameter != null) {
            emit(String.fromCharCode(parameter < 0 ? parameter + 0x10000 : parameter));
            skipFallback = group.unicodeSkip;
            continue;
        }

        const text = CONTROL_TEXT.get(name);

        if (text != null) {
            emit(text);
        }
    }

    flushBytes();

    return output.join('').replace(/\n+$/, '');
}
