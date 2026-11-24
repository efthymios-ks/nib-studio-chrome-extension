import { Annotation, EditorSelection, EditorState, type Extension, type SelectionRange } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { blockItems, regionAt } from './liveBlocks.js';
import { scanInline } from './liveInline.js';
import { atomicItems, type LiveItem } from './liveItems.js';
import { rangeAround, skipRanges } from './liveRanges.js';

// Marks a selection change that places the caret exactly, such as before Enter continues a list.
export const exactCaret = Annotation.define<boolean>();

const MAX_SNAP_STEPS = 8;

// The hidden and replaced ranges on the position's line and the lines on either side,
// enough to follow a hidden range that crosses a line break, such as a table's delimiter row.
export function caretItemsAround(state: EditorState, position: number): LiveItem[] {
    const { doc } = state;
    const line = doc.lineAt(position);
    const from = doc.line(Math.max(1, line.number - 1)).from;
    const to = doc.line(Math.min(doc.lines, line.number + 1)).to;
    const blocks = blockItems(state).filter((item) => item.to >= from && item.from <= to);

    return atomicItems([...scanInline(state, from, to), ...blocks]);
}

// Where a caret at `position` belongs among hidden syntax: with the formatting of the character before it.
// At the end of bold text that is inside the closing `**`, before bold text after plain text it is in front of the `**`,
// past a line's hidden prefix such as `# ` or `- `, and after a link rather than inside its text.
export function canonicalCaret(state: EditorState, position: number, items = caretItemsAround(state, position)): number {
    const inside = rangeAround(items, position);
    const edge = inside == null ? position : edgeOf(inside, position);
    const beforeFormatting = skipRanges(items, edge, false, (item) => item.side !== 'both');

    return skipRanges(items, beforeFormatting, true, (item) => item.side === 'after');
}

function edgeOf(item: LiveItem, position: number): number {
    if (item.side === 'after') {
        return item.to;
    }

    if (item.side === 'before') {
        return item.from;
    }

    return position - item.from <= item.to - position ? item.from : item.to;
}

// A caret on a line that is part of a box's frame, such as a code block's fence, moves to the nearest editable spot
// in the direction it came from: into the block when entering it, out of it when leaving.
export function snapToEditable(state: EditorState, position: number, previous: number | null): number {
    let current = position;

    for (let step = 0; step < MAX_SNAP_STEPS; step++) {
        const region = regionAt(state, current);

        if (region == null) {
            return current;
        }

        const { content } = region;

        if (content != null && content.from <= current && current <= content.to) {
            return current;
        }

        const above = region.from > 0 ? region.from - 1 : null;
        const below = region.to < state.doc.length ? region.to + 1 : null;
        let target: number | null;

        if (previous == null || previous < region.from) {
            target = content?.from ?? below ?? above;
        }
        else if (previous > region.to) {
            target = content?.to ?? above ?? below;
        }
        else if (current < (content?.from ?? region.to)) {
            target = above ?? content?.from ?? null;
        }
        else {
            target = below ?? content?.to ?? null;
        }

        if (target == null || target === current) {
            return current;
        }

        previous = current;
        current = target;
    }

    return current;
}

// The editable position for a caret the user or a command put at `position`.
function placeCaret(state: EditorState, position: number, previous: number | null): number {
    return canonicalCaret(state, snapToEditable(state, position, previous));
}

// Keeps every caret on an editable, canonical position, whatever moved it: keys, clicks, commands, undo.
export function liveCaretFilter(): Extension {
    return EditorState.transactionFilter.of((transaction) => {
        if (transaction.selection == null || transaction.annotation(exactCaret) === true) {
            return transaction;
        }

        const state = transaction.docChanged ? transaction.state : transaction.startState;
        const selection = transaction.docChanged ? transaction.state.selection : transaction.selection;
        let isChanged = false;
        const ranges = selection.ranges.map((range, index) => {
            if (!range.empty) {
                return range;
            }

            const previous = transaction.docChanged ? null : transaction.startState.selection.ranges[index]?.head ?? null;
            const placed = placeCaret(state, range.head, previous);

            if (placed === range.head) {
                return range;
            }

            isChanged = true;

            return EditorSelection.cursor(placed, placed < range.head ? 1 : -1);
        });

        if (!isChanged) {
            return transaction;
        }

        return [transaction, { selection: EditorSelection.create(ranges, selection.mainIndex), sequential: true }];
    });
}

// Moves one visible character or word: hidden syntax in the way is skipped first, so no key press is lost on it.
export function moveVisible(view: EditorView, forward: boolean, extend: boolean, byGroup: boolean): boolean {
    const { state } = view;
    const selection = EditorSelection.create(state.selection.ranges.map((range) => {
        if (!extend && !range.empty) {
            return EditorSelection.cursor(forward ? range.to : range.from);
        }

        const head = stepVisible(view, range.head, forward, byGroup);

        return extend ? EditorSelection.range(range.anchor, head) : EditorSelection.cursor(head, forward ? -1 : 1);
    }), state.selection.mainIndex);

    view.dispatch({ selection, scrollIntoView: true, userEvent: 'select' });

    return true;
}

export function stepVisible(view: EditorView, position: number, forward: boolean, byGroup: boolean): number {
    const current = skipHidden(view.state, position, forward);
    const cursor = EditorSelection.cursor(current);
    const moved: SelectionRange = byGroup ? view.moveByGroup(cursor, forward) : view.moveByChar(cursor, forward);

    return moved.head;
}

// Past the hidden ranges at `position` in the direction, stopping at a column divider or an image.
export function skipHidden(state: EditorState, position: number, forward: boolean, items = caretItemsAround(state, position)): number {
    return skipRanges(items, position, forward, (item) => item.side !== 'both');
}

