import { compareMarkdown } from '../markdown/diff/comparer.js';
import type { ChangeRecord, DiffStatus, MarkdownSegment } from '../markdown/diff/types.js';
import {
    DIFF_DOCUMENT_FORMAT,
    DIFF_DOCUMENT_VERSION,
    summarizeChanges,
    type DiffCell,
    type DiffCellStatus,
    type DiffChange,
    type DiffChangeKind,
    type DiffDocumentSide,
    type DiffRow,
    type MarkdownDiffDocument,
} from './diffDocument.js';

export interface MarkdownDiffDocumentInput {
    readonly original: DiffDocumentSide;
    readonly modified: DiffDocumentSide;
    readonly originalText: string;
    readonly modifiedText: string;
    // Leaves the blocks that did not change out of the page; off unless set.
    readonly changesOnly?: boolean;
}

const CHANGE_KINDS: Readonly<Record<Exclude<DiffStatus, 'Unchanged'>, DiffChangeKind>> = Object.freeze({
    Added: 'added',
    Removed: 'removed',
    Modified: 'changed',
});

const CELL_STATUSES: Readonly<Record<DiffStatus, DiffCellStatus>> = Object.freeze({
    Added: 'added',
    Removed: 'removed',
    Modified: 'changed',
    Unchanged: 'unchanged',
});

export function buildMarkdownDiffDocument(input: MarkdownDiffDocumentInput): MarkdownDiffDocument {
    const changesOnly = input.changesOnly ?? false;
    const markdown = compareMarkdown(input.originalText, input.modifiedText, {
        includeUnchanged: !changesOnly,
        originalName: input.original.name,
        modifiedName: input.modified.name,
    });
    const rows: DiffRow[] = [];
    const changes: DiffChange[] = [];

    for (const record of markdown.changes) {
        // Numbered as the Markdown page numbers its changes, chg1 first.
        const change = record.status === 'Unchanged' ? null : changeOf(record, `chg${changes.length + 1}`, rows.length);

        if (change != null) {
            changes.push(change);
        }

        rows.push({
            ...(change == null ? {} : { change: change.id }),
            left: cellOf(record.original, record.status),
            right: cellOf(record.modified, record.status),
        });
    }

    return {
        format: DIFF_DOCUMENT_FORMAT,
        version: DIFF_DOCUMENT_VERSION,
        kind: 'markdown',
        original: input.original,
        modified: input.modified,
        options: { changesOnly },
        summary: { ...summarizeChanges(changes), unchanged: markdown.summary.unchanged },
        changes,
        rows,
        markdown,
    };
}

// The title the Markdown page carries: both side names.
export function markdownDiffTitle(document: Pick<MarkdownDiffDocument, 'original' | 'modified'>): string {
    return `${document.original.name} ↔ ${document.modified.name}`;
}

function changeOf(record: ChangeRecord, id: string, row: number): DiffChange {
    const kind = CHANGE_KINDS[record.status as Exclude<DiffStatus, 'Unchanged'>];

    return {
        id,
        kind,
        location: record.path === '' ? {} : { path: record.path },
        row,
        ...(record.original == null || kind === 'added' ? {} : { before: record.original.raw }),
        ...(record.modified == null || kind === 'removed' ? {} : { after: record.modified.raw }),
    };
}

function cellOf(segment: MarkdownSegment | null, status: DiffStatus): DiffCell | null {
    if (segment == null) {
        return null;
    }

    return {
        status: CELL_STATUSES[status],
        line: segment.startLine,
        label: segment.type,
        tokens: [{ text: segment.raw, type: 'markdown' }],
    };
}
