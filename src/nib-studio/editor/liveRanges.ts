import { findClusterBreak, type EditorState } from '@codemirror/state';

export interface Span {
    readonly from: number;
    readonly to: number;
}

// The range the position falls strictly inside, not on its edge; undefined when there is none.
export function rangeAround<T extends Span>(ranges: ReadonlyArray<T>, position: number): T | undefined {
    return ranges.find((range) => range.from < position && position < range.to);
}

// Past the ranges beside the position, one after another, as long as `canSkip` lets each go:
// forward over each that starts where the last ended, backward over each that ends where the last started.
export function skipRanges<T extends Span>(
    ranges: ReadonlyArray<T>,
    position: number,
    forward: boolean,
    canSkip: (range: T) => boolean,
): number {
    let current = position;

    for (;;) {
        const next = forward
            ? ranges.find((range) => range.from === current && range.to > current && canSkip(range))
            : ranges.find((range) => range.to === current && range.from < current && canSkip(range));

        if (next == null) {
            return current;
        }

        current = forward ? next.to : next.from;
    }
}

// The parts of the range that none of the kept spans covers, in order.
export function subtractSpans(range: Span, kept: ReadonlyArray<Span>): Span[] {
    const pieces: Span[] = [];
    let start = range.from;
    const sorted = kept
        .filter((span) => span.to > range.from && span.from < range.to)
        .sort((left, right) => left.from - right.from);

    for (const span of sorted) {
        if (span.from > start) {
            pieces.push({ from: start, to: Math.min(span.from, range.to) });
        }

        start = Math.max(start, span.to);
    }

    if (start < range.to) {
        pieces.push({ from: start, to: range.to });
    }

    return pieces;
}

// Where the character before the position starts, a whole emoji or accented letter at a time;
// at the start of a line, the line break before it.
export function clusterBefore(state: EditorState, position: number): number {
    const line = state.doc.lineAt(position);

    return position === line.from ? position - 1 : line.from + findClusterBreak(line.text, position - line.from, false);
}

// Where the character after the position ends, a whole emoji or accented letter at a time;
// at the end of a line, past the line break after it.
export function clusterAfter(state: EditorState, position: number): number {
    const line = state.doc.lineAt(position);

    return position === line.to ? position + 1 : line.from + findClusterBreak(line.text, position - line.from, true);
}
