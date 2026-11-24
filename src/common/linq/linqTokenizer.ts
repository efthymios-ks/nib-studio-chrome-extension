import { LinqError } from './linqErrors.js';

export type LinqTokenKind = 'identifier' | 'number' | 'string' | 'punct' | 'eof';

export interface LinqToken {
    readonly kind: LinqTokenKind;
    // Source text for identifiers and punctuation; the decoded text for strings.
    readonly text: string;
    readonly start: number;
    readonly end: number;
    // Set for numbers.
    readonly number?: number;
    // True for a `backtick quoted` identifier, which is never a keyword.
    readonly quoted?: boolean;
}

// Longest first, so `??` wins over `?` and `<=` over `<`.
const PUNCTUATION = [
    '==', '!=', '<>', '<=', '>=', '&&', '||', '??',
    '(', ')', '{', '}', '[', ']', ',', '.', '?', ':', '=', '<', '>', '+', '-', '*', '/', '%', '!',
];

const STRING_ESCAPES: Readonly<Record<string, string>> = {
    'n': '\n',
    't': '\t',
    'r': '\r',
    '0': '\0',
    '\\': '\\',
    '"': '"',
    '\'': '\'',
};

export function tokenize(text: string): LinqToken[] {
    const tokens: LinqToken[] = [];
    let position = 0;

    while (position < text.length) {
        const char = text[position] as string;

        if (/\s/.test(char)) {
            position += 1;
            continue;
        }

        if (char === '/' && text[position + 1] === '/') {
            while (position < text.length && text[position] !== '\n') {
                position += 1;
            }

            continue;
        }

        if (/[A-Za-z_]/.test(char)) {
            const start = position;

            while (position < text.length && /[A-Za-z0-9_]/.test(text[position] as string)) {
                position += 1;
            }

            tokens.push({ kind: 'identifier', text: text.slice(start, position), start, end: position });
            continue;
        }

        if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(text[position + 1] ?? ''))) {
            tokens.push(readNumber(text, position));
            position = (tokens[tokens.length - 1] as LinqToken).end;
            continue;
        }

        if (char === '"' || char === '\'') {
            tokens.push(readString(text, position));
            position = (tokens[tokens.length - 1] as LinqToken).end;
            continue;
        }

        if (char === '`') {
            const close = text.indexOf('`', position + 1);

            if (close < 0) {
                throw new LinqError('This `quoted name` is never closed with a backtick.', { start: position, end: text.length });
            }

            const name = text.slice(position + 1, close);

            if (name.trim() === '') {
                throw new LinqError('A `quoted name` cannot be empty.', { start: position, end: close + 1 });
            }

            tokens.push({ kind: 'identifier', text: name, start: position, end: close + 1, quoted: true });
            position = close + 1;
            continue;
        }

        const punct = PUNCTUATION.find((candidate) => text.startsWith(candidate, position));

        if (punct == null) {
            throw new LinqError(`Unexpected character '${char}'.`, { start: position, end: position + 1 });
        }

        tokens.push({ kind: 'punct', text: punct === '<>' ? '!=' : punct, start: position, end: position + punct.length });
        position += punct.length;
    }

    tokens.push({ kind: 'eof', text: '', start: text.length, end: text.length });

    return tokens;
}

function readNumber(text: string, start: number): LinqToken {
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(start));
    const source = (match?.[0] ?? '');
    let end = start + source.length;

    // A trailing dot belongs to member access, as in `1.ToString()`.
    if (source.endsWith('.') && /[A-Za-z_]/.test(text[end] ?? '')) {
        end -= 1;
    }

    if (/[A-Za-z_]/.test(text[end] ?? '')) {
        throw new LinqError('A number cannot run straight into letters.', { start, end: end + 1 });
    }

    return { kind: 'number', text: text.slice(start, end), start, end, number: Number(text.slice(start, end)) };
}

function readString(text: string, start: number): LinqToken {
    const quote = text[start] as string;
    let value = '';
    let position = start + 1;

    while (position < text.length) {
        const char = text[position] as string;

        if (char === quote) {
            return { kind: 'string', text: value, start, end: position + 1 };
        }

        if (char === '\\') {
            const next = text[position + 1] ?? '';
            const escaped = STRING_ESCAPES[next];

            if (escaped == null) {
                throw new LinqError(`Unknown escape '\\${next}' in a string.`, { start: position, end: position + 2 });
            }

            value += escaped;
            position += 2;
            continue;
        }

        if (char === '\n') {
            break;
        }

        value += char;
        position += 1;
    }

    throw new LinqError('This string is never closed.', { start, end: position });
}
