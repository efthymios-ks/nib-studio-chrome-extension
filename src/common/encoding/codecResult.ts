// What went wrong in a parse or conversion, and where in its input.
export interface CodecError {
    readonly message: string;
    // Zero-based index of the first character at fault, or null when no single place is at fault.
    readonly position: number | null;
    // How many characters from position are at fault, for highlighting.
    readonly length: number;
}

export type CodecResult<T> =
    | { readonly ok: true; readonly value: T; readonly warning: CodecError | null }
    | { readonly ok: false; readonly error: CodecError };

export function succeed<T>(value: T, warning: CodecError | null = null): CodecResult<T> {
    return { ok: true, value, warning };
}

export function fail<T>(message: string, position: number | null, length = 1): CodecResult<T> {
    return { ok: false, error: { message, position, length } };
}

// "position 5" for one-line input, "line 2, column 3" once the input has several lines; both count from 1.
export function describePosition(text: string, position: number): string {
    if (!text.includes('\n')) {
        return `position ${position + 1}`;
    }

    const before = text.slice(0, position);
    const line = before.split('\n').length;
    const column = position - before.lastIndexOf('\n');

    return `line ${line}, column ${column}`;
}

// The character at a position, quoted for a message; a whole emoji rather than half of its surrogate pair.
export function quoteCharacterAt(text: string, position: number): string {
    const codePoint = text.codePointAt(position);

    if (codePoint == null) {
        return 'end of input';
    }

    const character = String.fromCodePoint(codePoint);

    if (/\s/.test(character)) {
        return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
    }

    return `'${character}'`;
}
