import {
    compareTextWithRules,
    DEFAULT_TEXT_COMPARE_RULES,
    type RuledDiffLine,
    type RuledDiffMarker,
    type TextCompareRules,
} from '../text/textCompareRules.js';
import {
    DIFF_DOCUMENT_FORMAT,
    DIFF_DOCUMENT_VERSION,
    summarizeChanges,
    type DiffCell,
    type DiffCellStatus,
    type DiffChange,
    type DiffChangeKind,
    type DiffDocumentSide,
    type DiffLineSpan,
    type DiffRow,
    type TextDiffDocument,
    type TextDiffOptions,
} from './diffDocument.js';

export interface TextDiffDocumentInput {
    readonly original: DiffDocumentSide;
    readonly modified: DiffDocumentSide;
    readonly originalText: string;
    readonly modifiedText: string;
    readonly rules?: TextCompareRules;
}

const STATUS_OF_MARKER: Readonly<Record<RuledDiffMarker, DiffCellStatus>> = Object.freeze({
    add: 'added',
    del: 'removed',
    same: 'unchanged',
    ignored: 'ignored',
});

interface LineCell {
    readonly number: number;
    readonly text: string;
    readonly marker: RuledDiffMarker;
}

export function buildTextDiffDocument(input: TextDiffDocumentInput): TextDiffDocument {
    const rules = input.rules ?? DEFAULT_TEXT_COMPARE_RULES;
    const result = compareTextWithRules(input.originalText, input.modifiedText, rules);
    const rows: DiffRow[] = [];
    const changes: DiffChange[] = [];
    let left: LineCell[] = [];
    let right: LineCell[] = [];

    // Within a change, the removed lines sit beside the added ones, with placeholders where one side has fewer.
    const flushChange = (): void => {
        if (left.length === 0 && right.length === 0) {
            return;
        }

        const paired = Array.from({ length: Math.max(left.length, right.length) }, (_, index) => ({
            left: left[index] ?? null,
            right: right[index] ?? null,
        }));
        const removed = left.filter((cell) => cell.marker === 'del');
        const added = right.filter((cell) => cell.marker === 'add');
        const firstRow = rows.length;
        const kind = changeKindOf(removed.length > 0, added.length > 0);
        const id = kind == null ? null : String(changes.length);

        if (kind != null && id != null) {
            changes.push({
                id,
                kind,
                location: { lines: { original: spanOf(left), modified: spanOf(right) } },
                row: firstRow,
                ...(removed.length === 0 ? {} : { before: removed.map((cell) => cell.text).join('\n') }),
                ...(added.length === 0 ? {} : { after: added.map((cell) => cell.text).join('\n') }),
            });
        }

        for (const pair of paired) {
            rows.push({ ...(id == null ? {} : { change: id }), left: cellOf(pair.left), right: cellOf(pair.right) });
        }

        left = [];
        right = [];
    };

    for (const line of result.lines) {
        if (line.marker === 'same') {
            flushChange();
            rows.push({ left: cellOf(originalCell(line)), right: cellOf(modifiedCell(line)) });

            continue;
        }

        if (line.originalLineNumber != null) {
            left.push(originalCell(line));
        }
        else if (line.modifiedLineNumber != null) {
            right.push(modifiedCell(line));
        }
    }

    flushChange();

    return {
        format: DIFF_DOCUMENT_FORMAT,
        version: DIFF_DOCUMENT_VERSION,
        kind: 'text',
        original: input.original,
        modified: input.modified,
        options: textOptionsOf(rules),
        summary: {
            ...summarizeChanges(changes),
            lines: { added: result.addCount, removed: result.delCount, ignored: result.ignoredCount },
        },
        changes,
        rows,
    };
}

// Lines the rules ignored are no change of their own.
function changeKindOf(removes: boolean, adds: boolean): DiffChangeKind | null {
    if (removes && adds) {
        return 'changed';
    }

    if (removes) {
        return 'removed';
    }

    return adds ? 'added' : null;
}

function textOptionsOf(rules: TextCompareRules): TextDiffOptions {
    return {
        whitespace: rules.whitespace,
        ignoreCase: rules.ignoreCase,
        ignoreBlankLines: rules.ignoreBlankLines,
        normalizeLineEndings: rules.normalizeLineEndings,
        ignorePatterns: [...rules.ignorePatterns],
        sortLines: rules.sortLines,
        uniqueLines: rules.uniqueLines,
        trimLines: rules.trimLines,
    };
}

function originalCell(line: RuledDiffLine): LineCell {
    return { number: line.originalLineNumber ?? 0, text: line.originalText ?? '', marker: line.marker };
}

function modifiedCell(line: RuledDiffLine): LineCell {
    return { number: line.modifiedLineNumber ?? 0, text: line.modifiedText ?? '', marker: line.marker };
}

function cellOf(cell: LineCell | null): DiffCell | null {
    if (cell == null) {
        return null;
    }

    return { status: STATUS_OF_MARKER[cell.marker], line: cell.number, tokens: [{ text: cell.text, type: 'text' }] };
}

function spanOf(cells: ReadonlyArray<LineCell>): DiffLineSpan | null {
    if (cells.length === 0) {
        return null;
    }

    return cells.reduce(
        (span, cell) => ({ from: Math.min(span.from, cell.number), to: Math.max(span.to, cell.number) }),
        { from: Number.MAX_SAFE_INTEGER, to: 0 },
    );
}
