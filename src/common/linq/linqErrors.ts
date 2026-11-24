export interface LinqSpan {
    readonly start: number;
    readonly end: number;
}

// A syntax or runtime error tied to a span of the query text.
export class LinqError extends Error {
    readonly start: number;

    readonly end: number;

    line = 1;

    column = 1;

    constructor(message: string, span: LinqSpan) {
        super(message);
        this.name = 'LinqError';
        this.start = span.start;
        this.end = Math.max(span.start, span.end);
    }

    // Fills line and column (both 1-based) from the query text.
    locate(text: string): this {
        const position = locateOffset(text, this.start);
        this.line = position.line;
        this.column = position.column;

        return this;
    }
}

export function locateOffset(text: string, offset: number): { line: number; column: number } {
    let line = 1;
    let lineStart = 0;
    const limit = Math.min(offset, text.length);

    for (let index = 0; index < limit; index += 1) {
        if (text.charCodeAt(index) === 10) {
            line += 1;
            lineStart = index + 1;
        }
    }

    return { line, column: limit - lineStart + 1 };
}

export function isLinqError(error: unknown): error is LinqError {
    return error instanceof LinqError;
}

// The candidate closest to the name, ignoring case, when it is close enough to be a likely typo.
export function suggestName(name: string, candidates: Iterable<string>): string | null {
    const wanted = name.toLowerCase();
    let best: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
        const distance = editDistance(wanted, candidate.toLowerCase());

        if (distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
        }
    }

    if (best == null) {
        return null;
    }

    const allowed = Math.max(1, Math.floor(Math.max(wanted.length, best.length) / 3));

    return bestDistance <= allowed ? best : null;
}

export function withSuggestion(message: string, name: string, candidates: Iterable<string>): string {
    const suggestion = suggestName(name, candidates);

    return suggestion == null ? message : `${message} Did you mean '${suggestion}'?`;
}

function editDistance(left: string, right: string): number {
    let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
        const current = [leftIndex];

        for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
            const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
            current[rightIndex] = Math.min(
                (current[rightIndex - 1] as number) + 1,
                (previous[rightIndex] as number) + 1,
                (previous[rightIndex - 1] as number) + cost,
            );
        }

        previous = current;
    }

    return previous[right.length] as number;
}
