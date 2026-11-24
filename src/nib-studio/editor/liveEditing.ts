import { syntaxTree } from '@codemirror/language';
import { deleteMarkupBackward } from '@codemirror/lang-markdown';
import {
    ChangeSet,
    EditorSelection,
    EditorState,
    Prec,
    StateEffect,
    StateField,
    Transaction,
    type ChangeSpec,
    type Extension,
    type Line,
    type TransactionSpec,
} from '@codemirror/state';
import { EditorView, keymap, type KeyBinding } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { showContextMenu, type ContextMenuGroup } from '../explorer/contextMenu.js';
import { canonicalCaret, caretItemsAround, exactCaret, moveVisible, skipHidden, stepVisible } from './liveCaret.js';
import { blockItems, liveStructure, regionAt, type LiveRegion } from './liveBlocks.js';
import { linkParts, pendingPairField } from './liveInline.js';
import type { LiveItem } from './liveItems.js';
import { clusterAfter, clusterBefore, subtractSpans, type Span } from './liveRanges.js';
import { asUndoStep, dispatchCommand } from './liveTransactions.js';
import {
    cellSafeText,
    deleteColumn,
    deleteRow,
    insertColumn,
    insertRow,
    moveDownOrAddRow,
    moveToCellEdge,
    moveToNextCell,
    moveToRowCell,
    tableAt,
    type MarkdownTable,
} from './markdownTables.js';

// A formatting run: its markers and the text between them.
interface InlineRun {
    readonly from: number;
    readonly to: number;
    readonly contentFrom: number;
    readonly contentTo: number;
    readonly markers: ReadonlyArray<{ readonly from: number; readonly to: number }>;
}

export interface VisibleDeletion {
    readonly changes: ReadonlyArray<Span>;
    // Where text typed over the deleted range goes, before the changes.
    readonly at: number;
}

const RUN_NODES = new Set(['StrongEmphasis', 'Emphasis', 'Strikethrough', 'InlineCode', 'Link', 'Autolink', 'Escape']);
// Runs that Markdown no longer reads as runs once their text starts or ends with a space.
const EDGE_SPACE_RUNS = new Set(['StrongEmphasis', 'Emphasis', 'Strikethrough']);
const LEADING_SPACES = /^[ \t]+/;
const TRAILING_SPACES = /[ \t]+$/;
const SPACES_ONLY = /^[ \t]+$/;
const BLANK = /^[ \t]*$/;
const TASK_DONE = /\[[xX]\]/;
const LIST_PREFIX = /^\s*(?:>\s?)*(?:[-*+]|\d{1,9}[.)])\s/;
const CODE_FENCE_OPENING = '```';

// The formatting run a syntax node makes, or null for other nodes.
function inlineRunOf(state: EditorState, node: SyntaxNode): InlineRun | null {
    if (!RUN_NODES.has(node.name)) {
        return null;
    }

    if (node.name === 'Link') {
        const parts = linkParts(state, node, liveStructure(state));

        return parts == null
            ? null
            : {
                from: node.from,
                to: node.to,
                contentFrom: parts.textFrom,
                contentTo: parts.textTo,
                markers: [{ from: node.from, to: parts.textFrom }, { from: parts.textTo, to: node.to }],
            };
    }

    if (node.name === 'Autolink') {
        return {
            from: node.from,
            to: node.to,
            contentFrom: node.from + 1,
            contentTo: node.to - 1,
            markers: [{ from: node.from, to: node.from + 1 }, { from: node.to - 1, to: node.to }],
        };
    }

    // An escaped character goes with its backslash.
    if (node.name === 'Escape') {
        return { from: node.from, to: node.to, contentFrom: node.from + 1, contentTo: node.to, markers: [{ from: node.from, to: node.from + 1 }] };
    }

    const opening = node.firstChild;
    const closing = node.lastChild;

    if (opening == null || closing == null || opening === closing || !opening.name.endsWith('Mark') || !closing.name.endsWith('Mark')) {
        return null;
    }

    return {
        from: node.from,
        to: node.to,
        contentFrom: opening.to,
        contentTo: closing.from,
        markers: [{ from: opening.from, to: opening.to }, { from: closing.from, to: closing.to }],
    };
}

function runsOverlapping(state: EditorState, from: number, to: number): InlineRun[] {
    const runs: InlineRun[] = [];

    syntaxTree(state).iterate({
        from,
        to,
        enter: (node) => {
            const run = inlineRunOf(state, node.node);

            if (run != null && run.from < to && run.to > from) {
                runs.push(run);
            }
        },
    });

    return runs;
}

function isInside(inner: Span, outer: Span): boolean {
    return outer.from <= inner.from && inner.to <= outer.to;
}

// Deletes [from, to) as visible text. A formatting run whose text is all deleted goes with its markers,
// one cut in half keeps them, and the frame of a table or code block the range only reaches into stays.
export function visibleDeletion(state: EditorState, from: number, to: number): VisibleDeletion {
    let range: Span = { from, to };

    for (;;) {
        const grown = runsOverlapping(state, range.from, range.to).reduce<Span>((span, run) => {
            const hasText = run.contentTo > run.contentFrom;
            const textGone = hasText && isInside({ from: run.contentFrom, to: run.contentTo }, span);

            return textGone ? { from: Math.min(span.from, run.from), to: Math.max(span.to, run.to) } : span;
        }, range);

        if (grown.from === range.from && grown.to === range.to) {
            break;
        }

        range = grown;
    }

    const kept: Span[] = [];

    for (const run of runsOverlapping(state, range.from, range.to)) {
        if (!isInside(run, range)) {
            kept.push(...run.markers);
        }
    }

    kept.push(...structureKept(state, range));

    return { changes: subtractSpans(range, kept), at: range.from };
}

// Table pipes, delimiter rows, code fences and the line breaks around them, unless the range takes the whole block.
function structureKept(state: EditorState, range: Span): Span[] {
    const structure = liveStructure(state);

    if (structure == null) {
        return [];
    }

    const kept: Span[] = [];
    const boxes: LiveRegion[] = [...structure.regions, ...(structure.frontMatter == null ? [] : [structure.frontMatter])];

    for (const region of boxes) {
        if (region.kind === 'rule' || region.kind === 'indentedCode' || isInside(region, range)) {
            continue;
        }

        if (region.to < range.from || region.from > range.to) {
            continue;
        }

        const opening = state.doc.lineAt(region.from);
        kept.push({ from: Math.max(0, opening.from - 1), to: Math.min(state.doc.length, opening.to + 1) });

        if (region.isClosed) {
            const closing = state.doc.lineAt(region.to);
            kept.push({ from: closing.from - 1, to: Math.min(state.doc.length, closing.to + 1) });
        }
    }

    for (const table of structure.tables) {
        if (isInside(table, range) || table.to < range.from || table.from > range.to) {
            continue;
        }

        kept.push(...tableFrame(state, table));
    }

    return kept;
}

// The table's pipes, cell padding and delimiter row, the hidden parts of its grid, and the line breaks between rows.
function tableFrame(state: EditorState, table: MarkdownTable): Span[] {
    const kept: Span[] = [{ from: Math.max(0, table.from - 1), to: table.from }, { from: table.to, to: Math.min(state.doc.length, table.to + 1) }];
    kept.push(...blockItems(state).filter((item) => item.from >= table.from && item.to <= table.to));

    for (const row of table.rows) {
        kept.push({ from: row.to, to: Math.min(state.doc.length, row.to + 1) });
    }

    return kept;
}

// Replaces the selection with text as the user sees it: within one formatting run the text keeps the formatting;
// across runs or lines, the runs cut in half keep their markers and the text goes where the selection started.
function visibleReplacement(state: EditorState, from: number, to: number, text: string): TransactionSpec {
    const innerFrom = skipHidden(state, from, true);
    const innerTo = skipHidden(state, to, false);
    const isOneLine = state.doc.lineAt(innerFrom).number === state.doc.lineAt(Math.max(innerFrom, innerTo)).number;
    const markersInside = innerTo > innerFrom
        && caretItemsAround(state, innerFrom).some((item) => item.from >= innerFrom && item.to <= innerTo);

    if (isOneLine && innerTo >= innerFrom && !markersInside && runsSplitBy(state, innerFrom, innerTo) === 0) {
        return {
            changes: { from: innerFrom, to: innerTo, insert: text },
            selection: EditorSelection.cursor(innerFrom + text.length),
        };
    }

    const deletion = visibleDeletion(state, from, to);
    const changes: ChangeSpec[] = deletion.changes.map((span) => ({ from: span.from, to: span.to }));
    changes.push({ from: deletion.at, insert: text });
    const changeSet = state.changes(changes);

    return {
        changes: changeSet,
        selection: EditorSelection.cursor(changeSet.mapPos(deletion.at, -1) + text.length),
    };
}

// How many runs the range cuts in half, which a plain replacement would break.
function runsSplitBy(state: EditorState, from: number, to: number): number {
    if (to <= from) {
        return 0;
    }

    return runsOverlapping(state, from, to).filter((run) => {
        const startsInside = run.from >= from && run.from < to;
        const endsInside = run.to > from && run.to <= to;

        return startsInside !== endsInside;
    }).length;
}

// The source of the selection, with the markers it cuts off added back, so a copied part of `**bold**` stays bold.
export function markdownForRange(state: EditorState, from: number, to: number): string {
    const opening: string[] = [];
    const closing: string[] = [];

    for (const run of runsOverlapping(state, from, to)) {
        if (run.contentTo <= from || run.contentFrom >= to) {
            continue;
        }

        const [openingMarker, closingMarker] = run.markers;

        if (run.from < from && openingMarker != null) {
            opening.push(state.sliceDoc(openingMarker.from, openingMarker.to));
        }

        if (run.to > to && closingMarker != null) {
            closing.unshift(state.sliceDoc(closingMarker.from, closingMarker.to));
        }
    }

    return `${opening.join('')}${state.sliceDoc(from, to)}${closing.join('')}`;
}

function dispatchDeletion(view: EditorView, from: number, to: number, userEvent: string): boolean {
    const { state } = view;
    const deletion = visibleDeletion(state, from, to);

    if (deletion.changes.length === 0) {
        return true;
    }

    const changes = state.changes(deletion.changes.map((span) => ({ from: span.from, to: span.to })));
    view.dispatch({
        changes,
        selection: EditorSelection.cursor(changes.mapPos(deletion.at, -1)),
        scrollIntoView: true,
        userEvent,
    });

    return true;
}

function cancelPendingPair(view: EditorView): boolean {
    const pending = view.state.field(pendingPairField, false);
    const main = view.state.selection.main;

    if (pending == null || !main.empty || main.head !== pending.position) {
        return false;
    }

    const size = pending.marker.length;
    view.dispatch({
        changes: { from: pending.position - size, to: pending.position + size },
        userEvent: 'delete',
        annotations: Transaction.addToHistory.of(false),
    });

    return true;
}

// Backspace: removes the visible character before the caret, never a hidden marker;
// at the start of a line it acts on the line's formatting first.
function deleteVisibleBackward(view: EditorView, byGroup = false): boolean {
    const { state } = view;
    const main = state.selection.main;

    if (state.readOnly) {
        return false;
    }

    if (!main.empty) {
        return dispatchDeletion(view, main.from, main.to, 'delete.selection');
    }

    if (cancelPendingPair(view)) {
        return true;
    }

    const head = main.head;
    const items = caretItemsAround(state, head);
    const start = skipHidden(state, head, false, items);
    const line = state.doc.lineAt(head);

    if (isAtCellStart(items, start)) {
        return true;
    }

    if (start <= line.from) {
        return head > line.from ? removeLinePrefix(view, line, head) : joinWithLineAbove(view, line);
    }

    const image = items.find((item) => item.to === start && item.side === 'both');

    if (image != null) {
        return dispatchDeletion(view, image.from, start, 'delete.backward');
    }

    const target = byGroup
        ? Math.max(line.from, stepVisible(view, start, false, true))
        : clusterBefore(state, start);

    return dispatchDeletion(view, target, start, 'delete.backward');
}

// Delete: removes the visible character after the caret, never a hidden marker.
function deleteVisibleForward(view: EditorView, byGroup = false): boolean {
    const { state } = view;
    const main = state.selection.main;

    if (state.readOnly) {
        return false;
    }

    if (!main.empty) {
        return dispatchDeletion(view, main.from, main.to, 'delete.selection');
    }

    if (cancelPendingPair(view)) {
        return true;
    }

    const head = main.head;
    const items = caretItemsAround(state, head);
    const end = skipHidden(state, head, true, items);
    const line = state.doc.lineAt(head);

    if (isAtCellEnd(items, end)) {
        return true;
    }

    if (end >= line.to) {
        return joinWithLineBelow(view, line);
    }

    const image = items.find((item) => item.from === end && item.side === 'both');

    if (image != null) {
        return dispatchDeletion(view, end, image.to, 'delete.forward');
    }

    const target = byGroup
        ? Math.min(line.to, stepVisible(view, end, true, true))
        : clusterAfter(state, end);

    return dispatchDeletion(view, end, target, 'delete.forward');
}

function isDivider(item: LiveItem): boolean {
    return item.side === 'both' && item.decoration.spec.widget == null;
}

function isAtCellStart(items: ReadonlyArray<LiveItem>, position: number): boolean {
    return items.some((item) => item.to === position && isDivider(item));
}

function isAtCellEnd(items: ReadonlyArray<LiveItem>, position: number): boolean {
    return items.some((item) => item.from === position && isDivider(item));
}

// Backspace at the start of a line's text: a heading becomes a paragraph, a quote or list item loses its marker.
function removeLinePrefix(view: EditorView, line: Line, head: number): boolean {
    const { state } = view;

    if (tableAt(state, head) != null) {
        return true;
    }

    const region = regionAt(state, head);

    if (region != null && region.kind !== 'indentedCode') {
        return joinWithLineAbove(view, line, head);
    }

    const heading = headingMarkOnLine(state, line);

    if (heading != null) {
        return dispatchChange(view, { from: heading, to: head }, 'delete.backward');
    }

    if (deleteMarkupBackward(view)) {
        return true;
    }

    return dispatchChange(view, { from: line.from, to: head }, 'delete.backward');
}

function headingMarkOnLine(state: EditorState, line: Line): number | null {
    let found: number | null = null;

    syntaxTree(state).iterate({
        from: line.from,
        to: line.to,
        enter: (node) => {
            if (node.name === 'HeaderMark' && found == null && node.from >= line.from && node.node.parent?.name.startsWith('ATXHeading') === true) {
                const before = state.sliceDoc(line.from, node.from);
                found = before.trim() === '' ? line.from : node.from;
            }
        },
    });

    return found;
}

function dispatchChange(view: EditorView, change: { from: number; to: number; insert?: string }, userEvent: string): boolean {
    view.dispatch({
        changes: change,
        selection: EditorSelection.cursor(change.from + (change.insert?.length ?? 0)),
        scrollIntoView: true,
        userEvent,
    });

    return true;
}

// Backspace at the very start of a line. Blocks drawn as a box or a grid never merge with the text around them:
// an empty line after one is removed instead, and a horizontal rule above is deleted as a whole.
function joinWithLineAbove(view: EditorView, line: Line, head = line.from): boolean {
    const { state } = view;

    if (setextFirstLine(view, line) || line.number === 1) {
        return true;
    }

    const previous = state.doc.line(line.number - 1);
    const above = structureEndingAt(state, previous);
    const ownRegion = regionAt(state, line.from);

    if (ownRegion?.content != null && ownRegion.kind !== 'indentedCode' && ownRegion.content.from === line.from) {
        return removeEmptyBox(view, ownRegion);
    }

    if (above == null) {
        return dispatchChange(view, { from: previous.to, to: head }, 'delete.backward');
    }

    if (above.kind === 'rule') {
        return dispatchChange(view, { from: previous.from, to: line.from }, 'delete.backward');
    }

    if (BLANK.test(line.text)) {
        view.dispatch({
            changes: { from: previous.to, to: line.to },
            selection: EditorSelection.cursor(above.contentEnd),
            scrollIntoView: true,
            userEvent: 'delete.backward',
        });

        return true;
    }

    view.dispatch({ selection: EditorSelection.cursor(above.contentEnd), scrollIntoView: true, userEvent: 'select' });

    return true;
}

// Backspace at the start of a setext heading's text turns it into a paragraph, removing the underline.
function setextFirstLine(view: EditorView, line: Line): boolean {
    const heading = liveStructure(view.state)?.setextHeadings.find((candidate) => candidate.from === line.from);

    if (heading == null) {
        return false;
    }

    view.dispatch({
        changes: { from: heading.textTo, to: heading.to },
        selection: EditorSelection.cursor(line.from),
        scrollIntoView: true,
        userEvent: 'delete.backward',
    });

    return true;
}

// A code box whose only line is empty goes away on Backspace; otherwise Backspace at its start does nothing.
function removeEmptyBox(view: EditorView, region: LiveRegion): boolean {
    const { state } = view;

    if (region.content == null || !BLANK.test(state.sliceDoc(region.content.from, region.content.to))) {
        return true;
    }

    const from = region.from > 0 ? region.from - 1 : region.from;
    const to = region.from > 0 ? region.to : Math.min(state.doc.length, region.to + 1);

    return dispatchChange(view, { from, to }, 'delete.backward');
}

interface StructureEnd {
    readonly kind: 'region' | 'rule' | 'table' | 'setext';
    // Where the caret goes when it steps back into the block.
    readonly contentEnd: number;
}

// The block whose last line is `line`, which text below it never merges into.
function structureEndingAt(state: EditorState, line: Line): StructureEnd | null {
    const structure = liveStructure(state);

    if (structure == null) {
        return null;
    }

    const region = regionAt(state, line.from);

    if (region != null && region.to === line.to && region.kind !== 'indentedCode') {
        if (region.kind === 'rule') {
            return { kind: 'rule', contentEnd: line.from };
        }

        if (region.isClosed) {
            return { kind: 'region', contentEnd: region.content?.to ?? Math.max(0, region.from - 1) };
        }
    }

    const table = structure.tables.find((candidate) => candidate.to === line.to);

    if (table != null) {
        const lastRow = table.rows.at(-1)!;

        return { kind: 'table', contentEnd: lastRow.cells.at(-1)?.textTo ?? lastRow.to };
    }

    const heading = structure.setextHeadings.find((candidate) => candidate.to === line.to);

    return heading == null ? null : { kind: 'setext', contentEnd: heading.textTo };
}

// Delete at the very end of a line brings the next line's text up without its formatting,
// but never into or out of a box, a table or a setext heading.
function joinWithLineBelow(view: EditorView, line: Line): boolean {
    const { state } = view;

    if (line.number === state.doc.lines) {
        return true;
    }

    const next = state.doc.line(line.number + 1);
    const ownRegion = regionAt(state, line.from);
    const nextRegion = regionAt(state, next.from);
    const isInFrame = tableAt(state, line.from) != null
        || (ownRegion?.content != null && ownRegion.kind !== 'indentedCode' && ownRegion.content.to === line.to)
        || liveStructure(state)?.setextHeadings.some((heading) => heading.textTo === line.to) === true;
    const isFrameBelow = (nextRegion != null && nextRegion !== ownRegion) || tableAt(state, next.from) != null;

    if (isInFrame) {
        return true;
    }

    if (isFrameBelow) {
        if (BLANK.test(line.text) && ownRegion == null) {
            return dispatchChange(view, { from: line.from, to: next.from }, 'delete.forward');
        }

        return true;
    }

    return dispatchChange(view, { from: line.to, to: canonicalCaret(state, next.from) }, 'delete.forward');
}

// Enter: tables move down a row, an empty last line of a code box leaves the box, a setext heading
// continues under its underline, and the text after a heading's hidden `# ` keeps its heading.
function insertLiveNewline(view: EditorView): boolean {
    const { state } = view;
    const main = state.selection.main;

    if (state.readOnly || state.selection.ranges.length > 1) {
        return false;
    }

    if (!main.empty) {
        return false;
    }

    const head = main.head;
    const tableMove = moveDownOrAddRow(state);

    if (tableMove != null) {
        view.dispatch(tableMove);

        return true;
    }

    const line = state.doc.lineAt(head);
    const region = regionAt(state, head);

    if (region != null && region.kind !== 'rule' && region.kind !== 'indentedCode' && region.kind !== 'frontMatter') {
        return leaveCodeBox(view, region, line);
    }

    const heading = liveStructure(state)?.setextHeadings.find((candidate) => candidate.textTo === head);

    if (heading != null) {
        return dispatchChange(view, { from: heading.to, to: heading.to, insert: '\n' }, 'input');
    }

    if (head > line.from && head < line.to && state.sliceDoc(line.from, head).trim() !== '' && isLinePrefix(state, line, head)) {
        return newLineAbove(view, line, head);
    }

    const end = skipHidden(state, head, true);

    if (end === line.to && end > head) {
        view.dispatch({ selection: EditorSelection.cursor(end), annotations: exactCaret.of(true) });
    }

    return false;
}

function isLinePrefix(state: EditorState, line: Line, head: number): boolean {
    return canonicalCaret(state, line.from) === head;
}

// Enter at the start of a heading's or list item's text adds an empty line or item above and keeps this one.
function newLineAbove(view: EditorView, line: Line, head: number): boolean {
    const { state } = view;
    const prefix = state.sliceDoc(line.from, head);
    const isHeading = headingMarkOnLine(state, line) != null;

    if (!isHeading && !LIST_PREFIX.test(prefix)) {
        return false;
    }

    const inserted = isHeading ? '\n' : `${prefix.replace(TASK_DONE, '[ ]')}\n`;
    view.dispatch({
        changes: { from: line.from, insert: inserted },
        selection: EditorSelection.cursor(head + inserted.length),
        scrollIntoView: true,
        userEvent: 'input',
    });

    return true;
}

// Enter on an empty last line of a code box leaves the box for a new line under it.
function leaveCodeBox(view: EditorView, region: LiveRegion, line: Line): boolean {
    const { state } = view;
    const content = region.content;

    if (content == null || !region.isClosed || line.to !== content.to || !BLANK.test(line.text)) {
        return false;
    }

    const isOnlyLine = line.from === content.from;
    const changes: ChangeSpec[] = isOnlyLine ? [] : [{ from: line.from - 1, to: line.to }];
    const after = region.to < state.doc.length ? state.doc.lineAt(region.to + 1) : null;
    const removed = isOnlyLine ? 0 : line.to - line.from + 1;

    if (after != null && BLANK.test(after.text)) {
        view.dispatch(asUndoStep({ changes, selection: EditorSelection.cursor(after.from - removed) }, 'input'));

        return true;
    }

    changes.push({ from: region.to, insert: '\n' });
    view.dispatch(asUndoStep({ changes, selection: EditorSelection.cursor(region.to - removed + 1) }, 'input'));

    return true;
}

// ↓ on the last line before blocks that end the document, such as a closing code fence, adds a line under them.
function addLineBelowAtEnd(view: EditorView): boolean {
    const { state } = view;
    const main = state.selection.main;

    if (!main.empty || state.readOnly) {
        return false;
    }

    const line = state.doc.lineAt(main.head);

    if (line.number === state.doc.lines) {
        return false;
    }

    for (let number = line.number + 1; number <= state.doc.lines; number++) {
        const next = state.doc.line(number);
        const region = regionAt(state, next.from);
        const isFrame = region != null && region.kind !== 'indentedCode'
            && (region.content == null || next.from > region.content.to || next.to < region.content.from);

        if (!isFrame) {
            return false;
        }
    }

    view.dispatch(asUndoStep({
        changes: { from: state.doc.length, insert: '\n' },
        selection: EditorSelection.cursor(state.doc.length + 1),
    }, 'input'));

    return true;
}

// Typing: text goes on the side of hidden markers the caret shows, pipes typed in a table cell are escaped,
// typing over a selection keeps the formatting, and three backticks on an empty line make a code box.
function handleLiveInput(view: EditorView, from: number, to: number, text: string): boolean {
    const { state } = view;
    const main = state.selection.main;

    if (view.composing || state.readOnly || state.selection.ranges.length > 1) {
        return false;
    }

    const isInTable = tableAt(state, from) != null;
    const insert = isInTable ? cellSafeText(text) : text;

    if (from !== to) {
        if (from !== main.from || to !== main.to) {
            return false;
        }

        view.dispatch({ ...visibleReplacement(state, from, to, insert), scrollIntoView: true, userEvent: 'input.type' });

        return true;
    }

    const at = main.empty && from !== main.head && canonicalCaret(state, from) === main.head ? main.head : from;

    if (text === '`' && makesCodeBox(state, at)) {
        const line = state.doc.lineAt(at);
        view.dispatch(asUndoStep({
            changes: { from: line.from, to: line.to, insert: `${CODE_FENCE_OPENING}\n\n${CODE_FENCE_OPENING}` },
            selection: EditorSelection.cursor(line.from + CODE_FENCE_OPENING.length + 1),
        }, 'input.type'));

        return true;
    }

    if (spacesBeforePendingPair(view, at, insert) || continueRun(view, at, insert)) {
        return true;
    }

    if (at === from && insert === text) {
        return false;
    }

    view.dispatch({
        changes: { from: at, insert },
        selection: EditorSelection.cursor(at + insert.length),
        scrollIntoView: true,
        userEvent: 'input.type',
    });

    return true;
}

function makesCodeBox(state: EditorState, position: number): boolean {
    const line = state.doc.lineAt(position);

    return line.text === '``' && position === line.to && regionAt(state, position) == null;
}

// The changes in order, each with the range it replaces in the old document and the text it puts there.
function changeList(changes: ChangeSet): Array<{ from: number; to: number; text: string }> {
    const changed: Array<{ from: number; to: number; text: string }> = [];
    changes.iterChanges((fromA, toA, _fromB, _toB, text) => {
        changed.push({ from: fromA, to: toA, text: text.toString() });
    });

    return changed;
}

// Pasting over a selection keeps the structure it reaches into, and pasting into a table cell stays in the cell.
function livePasteFilter(): Extension {
    return EditorState.transactionFilter.of((transaction) => {
        if (!transaction.isUserEvent('input.paste') || transaction.startState.selection.ranges.length > 1) {
            return transaction;
        }

        const { startState } = transaction;
        const main = startState.selection.main;
        const changed = changeList(transaction.changes);
        const change = changed[0];

        if (changed.length !== 1 || change == null || change.from !== main.from || change.to !== main.to) {
            return transaction;
        }

        const isInTable = tableAt(startState, main.from) != null;

        if (!isInTable && main.empty) {
            return transaction;
        }

        const text = isInTable ? cellSafeText(change.text) : change.text;

        return { ...visibleReplacement(startState, main.from, main.to, text), scrollIntoView: true, userEvent: 'input.paste' };
    });
}

// An empty pair a formatting action left goes away when the caret leaves it, without an undo step.
function pendingPairCleanup(): Extension {
    return EditorState.transactionFilter.of((transaction) => {
        const pending = transaction.startState.field(pendingPairField, false);

        if (pending == null || transaction.isUserEvent('input.format')) {
            return transaction;
        }

        const position = transaction.changes.mapPos(pending.position, -1);
        const main = transaction.newSelection.main;

        if (main.empty && main.head === position) {
            return transaction;
        }

        const size = pending.marker.length;
        const doc = transaction.newDoc;
        const isStillEmpty = doc.sliceString(position - size, position) === pending.marker
            && doc.sliceString(position, position + size) === pending.marker;

        if (!isStillEmpty) {
            return transaction;
        }

        return [transaction, {
            changes: { from: position - size, to: position + size },
            sequential: true,
            annotations: transaction.docChanged ? [] : Transaction.addToHistory.of(false),
        }];
    });
}

// Spaces an edit left at the end of a run, moved out past its closing marker, with the caret after them.
interface ContinuedRun {
    readonly markerFrom: number;
    readonly markerTo: number;
    // The end of the moved spaces, where the caret is.
    readonly at: number;
}

const continuedRunEffect = StateEffect.define<ContinuedRun>();

// The run the next character typed goes back into, so text typed on after a space in bold text stays bold.
// It lasts while the caret stays after the moved spaces, through more spaces typed there.
const continuedRunField = StateField.define<ContinuedRun | null>({
    create: () => null,
    update: (value, transaction) => {
        for (const effect of transaction.effects) {
            if (effect.is(continuedRunEffect)) {
                return effect.value;
            }
        }

        if (value == null) {
            return null;
        }

        const main = transaction.newSelection.main;

        if (!transaction.docChanged) {
            return main.empty && main.head === value.at ? value : null;
        }

        const changed = changeList(transaction.changes);
        const [change] = changed;
        const isSpacesAtCaret = changed.length === 1
            && change?.from === value.at
            && change.to === value.at
            && SPACES_ONLY.test(change.text);
        const at = value.at + (change?.text.length ?? 0);

        return isSpacesAtCaret && main.empty && main.head === at ? { ...value, at } : null;
    },
});

// Spaces typed into the empty pair Ctrl+B leaves go in front of it, since a run can't start with a space;
// the pair stays around the caret for the text that follows.
function spacesBeforePendingPair(view: EditorView, at: number, text: string): boolean {
    const pending = view.state.field(pendingPairField, false);

    if (pending == null || at !== pending.position || !SPACES_ONLY.test(text)) {
        return false;
    }

    view.dispatch({
        changes: { from: pending.position - pending.marker.length, insert: text },
        selection: EditorSelection.cursor(pending.position + text.length),
        scrollIntoView: true,
        userEvent: 'input.type',
    });

    return true;
}

// Typing on after the moved spaces: the text goes into the run, and its closing marker moves after the text.
function continueRun(view: EditorView, at: number, text: string): boolean {
    const { state } = view;
    const continued = state.field(continuedRunField, false);

    if (
        continued == null
        || at !== continued.at
        || !state.selection.main.empty
        || text === ''
        || /\s/.test(text)
    ) {
        return false;
    }

    const marker = state.sliceDoc(continued.markerFrom, continued.markerTo);
    view.dispatch({
        changes: [
            { from: continued.markerFrom, to: continued.markerTo },
            { from: at, insert: `${text}${marker}` },
        ],
        selection: EditorSelection.cursor(at - marker.length + text.length),
        scrollIntoView: true,
        userEvent: 'input.type',
    });

    return true;
}

// The bold, italic and struck-through runs whose text an edit touched, before the edit.
function edgeSpaceRuns(transaction: Transaction): InlineRun[] {
    const { startState } = transaction;
    const runs: InlineRun[] = [];

    transaction.changes.iterChangedRanges((fromA, toA) => {
        syntaxTree(startState).iterate({
            from: Math.max(0, fromA - 1),
            to: Math.min(startState.doc.length, toA + 1),
            enter: (node) => {
                const run = EDGE_SPACE_RUNS.has(node.name) ? inlineRunOf(startState, node.node) : null;
                const isTouched = run != null && fromA <= run.contentTo && toA >= run.contentFrom;

                if (run != null && isTouched && !runs.some((other) => other.from === run.from)) {
                    runs.push(run);
                }
            },
        });
    });

    return runs;
}

// In Markdown, a run whose text starts or ends with a space is no run, and its markers would show:
// after an edit, the spaces at the edges of a bold, italic or struck-through run move outside its markers,
// and a run left with nothing but spaces loses its markers.
function runEdgeSpaces(): Extension {
    return EditorState.transactionFilter.of((transaction) => {
        const isEdit = transaction.isUserEvent('input') || transaction.isUserEvent('delete');

        if (!transaction.docChanged || !isEdit || transaction.startState.selection.ranges.length > 1) {
            return transaction;
        }

        const { changes } = transaction;
        const doc = transaction.newDoc;
        const head = transaction.newSelection.main.head;
        const moves: ChangeSpec[] = [];
        const placeHead: Array<(moved: ChangeSet) => { head: number; continued: ContinuedRun | null }> = [];

        for (const run of edgeSpaceRuns(transaction)) {
            const [opening, closing] = run.markers;

            if (opening == null || closing == null) {
                continue;
            }

            const openingFrom = changes.mapPos(opening.from, 1);
            const contentFrom = changes.mapPos(run.contentFrom, -1);
            const contentTo = changes.mapPos(run.contentTo, 1);
            const closingTo = changes.mapPos(closing.to, -1);
            const openingMarker = transaction.startState.sliceDoc(opening.from, opening.to);
            const closingMarker = transaction.startState.sliceDoc(closing.from, closing.to);
            const isIntact = contentFrom <= contentTo
                && doc.sliceString(openingFrom, contentFrom) === openingMarker
                && doc.sliceString(contentTo, closingTo) === closingMarker;

            if (!isIntact) {
                continue;
            }

            const content = doc.sliceString(contentFrom, contentTo);

            if (SPACES_ONLY.test(content)) {
                moves.push({ from: openingFrom, to: contentFrom }, { from: contentTo, to: closingTo });
                continue;
            }

            const trailing = TRAILING_SPACES.exec(content)?.[0] ?? '';

            if (trailing !== '') {
                const spacesFrom = contentTo - trailing.length;
                moves.push({ from: spacesFrom, to: contentTo }, { from: closingTo, insert: trailing });

                if (head > spacesFrom && head <= contentTo) {
                    placeHead.push((moved) => {
                        const markerFrom = moved.mapPos(contentTo, 1);
                        const at = moved.mapPos(closingTo, 1);
                        const continued = { markerFrom, markerTo: markerFrom + closingMarker.length, at };

                        return head === contentTo
                            ? { head: at, continued }
                            : { head: moved.mapPos(closingTo, -1) + head - spacesFrom, continued: null };
                    });
                }
            }

            const leading = LEADING_SPACES.exec(content)?.[0] ?? '';

            if (leading !== '') {
                const spacesTo = contentFrom + leading.length;
                moves.push({ from: contentFrom, to: spacesTo }, { from: openingFrom, insert: leading });

                if (head > contentFrom && head <= spacesTo) {
                    placeHead.push((moved) => ({
                        head: moved.mapPos(openingFrom, -1) + head - contentFrom,
                        continued: null,
                    }));
                }
            }
        }

        if (moves.length === 0) {
            return transaction;
        }

        const moved = ChangeSet.of(moves, doc.length);
        const placed = placeHead[0]?.(moved);

        return [transaction, {
            changes: moved,
            sequential: true,
            ...(placed == null ? {} : { selection: EditorSelection.cursor(placed.head) }),
            ...(placed?.continued == null ? {} : { effects: continuedRunEffect.of(placed.continued) }),
        }];
    });
}

function copyOrCut(event: ClipboardEvent, view: EditorView, isCut: boolean): boolean {
    const { state } = view;
    const ranges = state.selection.ranges.filter((range) => !range.empty);

    if (ranges.length === 0 || event.clipboardData == null) {
        return false;
    }

    const text = ranges.map((range) => markdownForRange(state, range.from, range.to)).join(state.lineBreak);
    event.clipboardData.clearData();
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();

    if (isCut && !state.readOnly) {
        const main = state.selection.main;
        dispatchDeletion(view, main.from, main.to, 'delete.cut');
    }

    return true;
}

// The table's right-click menu: rows and columns added or removed around the clicked cell.
function showTableMenu(event: MouseEvent, view: EditorView): boolean {
    const position = view.posAtCoords({ x: event.clientX, y: event.clientY });

    if (position == null || view.state.readOnly) {
        return false;
    }

    const clicked = tableAt(view.state, position);

    if (clicked == null) {
        return false;
    }

    const main = view.state.selection.main;

    if (position < main.from || position > main.to) {
        view.dispatch({ selection: EditorSelection.cursor(position), userEvent: 'select.pointer' });
    }

    const run = (command: (state: EditorState, table: MarkdownTable, row: number, column: number) => TransactionSpec | null) => (): void => {
        const current = tableAt(view.state, view.state.selection.main.head) ?? tableAt(view.state, position);

        if (current == null) {
            return;
        }

        const spec = command(view.state, current.table, current.rowIndex, current.column);

        if (spec != null) {
            view.dispatch(spec);
        }

        view.focus();
    };
    const isHeader = clicked.rowIndex === 0;
    const groups: ContextMenuGroup[] = [
        {
            items: [
                { label: 'Insert row above', disabled: isHeader, onSelect: run((_state, table, row) => insertRow(table, row, 'above')) },
                { label: 'Insert row below', onSelect: run((_state, table, row, column) => insertRow(table, row, 'below', column)) },
                { label: 'Insert column left', onSelect: run((state, table, _row, column) => insertColumn(state, table, column, 'left')) },
                { label: 'Insert column right', onSelect: run((state, table, _row, column) => insertColumn(state, table, column, 'right')) },
            ],
        },
        {
            items: [
                { label: 'Delete row', tone: 'fail', disabled: isHeader, onSelect: run((state, table, row) => deleteRow(state, table, row)) },
                {
                    label: 'Delete column',
                    tone: 'fail',
                    disabled: clicked.table.columnCount <= 1,
                    onSelect: run((state, table, _row, column) => deleteColumn(state, table, column)),
                },
            ],
        },
    ];
    showContextMenu(event, groups);

    return true;
}

const LIVE_KEYS: ReadonlyArray<KeyBinding> = [
    {
        key: 'ArrowLeft',
        run: (view) => moveVisible(view, false, false, false),
        shift: (view) => moveVisible(view, false, true, false),
    },
    {
        key: 'ArrowRight',
        run: (view) => moveVisible(view, true, false, false),
        shift: (view) => moveVisible(view, true, true, false),
    },
    {
        key: 'Mod-ArrowLeft',
        run: (view) => moveVisible(view, false, false, true),
        shift: (view) => moveVisible(view, false, true, true),
    },
    {
        key: 'Mod-ArrowRight',
        run: (view) => moveVisible(view, true, false, true),
        shift: (view) => moveVisible(view, true, true, true),
    },
    {
        key: 'Home',
        run: (view) => dispatchCommand(view, (state) => moveToCellEdge(state, false, false)),
        shift: (view) => dispatchCommand(view, (state) => moveToCellEdge(state, false, true)),
    },
    {
        key: 'End',
        run: (view) => dispatchCommand(view, (state) => moveToCellEdge(state, true, false)),
        shift: (view) => dispatchCommand(view, (state) => moveToCellEdge(state, true, true)),
    },
    { key: 'ArrowUp', run: (view) => dispatchCommand(view, (state) => moveToRowCell(state, false)) },
    {
        key: 'ArrowDown',
        run: (view) => dispatchCommand(view, (state) => moveToRowCell(state, true)) || addLineBelowAtEnd(view),
    },
    { key: 'Backspace', run: (view) => deleteVisibleBackward(view) },
    { key: 'Delete', run: (view) => deleteVisibleForward(view) },
    { key: 'Mod-Backspace', run: (view) => deleteVisibleBackward(view, true) },
    { key: 'Mod-Delete', run: (view) => deleteVisibleForward(view, true) },
    { key: 'Enter', run: insertLiveNewline },
    { key: 'Tab', run: (view) => dispatchCommand(view, (state) => moveToNextCell(state, true)) },
    { key: 'Shift-Tab', run: (view) => dispatchCommand(view, (state) => moveToNextCell(state, false)) },
];

// Editing in the Interactive view, where the Markdown syntax is hidden: keys, typing, paste, copy and the table menu.
export function liveEditing(): Extension {
    return [
        pendingPairField,
        pendingPairCleanup(),
        continuedRunField,
        runEdgeSpaces(),
        livePasteFilter(),
        Prec.highest(keymap.of([...LIVE_KEYS])),
        EditorView.inputHandler.of(handleLiveInput),
        EditorView.domEventHandlers({
            copy: (event, view) => copyOrCut(event, view, false),
            cut: (event, view) => copyOrCut(event, view, true),
            contextmenu: (event, view) => showTableMenu(event, view),
        }),
    ];
}
