import { getIndentUnit } from '@codemirror/language';
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown';
import { EditorSelection, Prec, type EditorState, type Extension, type Line, type TransactionSpec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { dispatchCommand } from './liveTransactions.js';

interface ListLine {
    readonly line: Line;
    readonly indent: number;
    // Where the item's text starts, after the marker and its spaces.
    readonly contentColumn: number;
}

const LIST_ITEM_PATTERN = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)/;

// List and quote keys, as in a rich-text editor:
// Enter continues a list, task list or quote, and on an empty item ends the list;
// Backspace at the start of an item removes its marker;
// Tab and Shift+Tab nest items under the item above or move them out to the parent's level, sub-items included.
// Other lines keep the usual Enter, Backspace, indent and outdent.
export function markdownListKeymap(): Extension {
    return Prec.high(keymap.of([
        { key: 'Enter', run: insertNewlineContinueMarkupCommand({ nonTightLists: false }) },
        { key: 'Backspace', run: deleteMarkupBackward },
        { key: 'Tab', run: (view) => dispatchCommand(view, indentListItems) },
        { key: 'Shift-Tab', run: (view) => dispatchCommand(view, outdentListItems) },
    ]));
}

// Null when a selected line is not a list item.
export function indentListItems(state: EditorState): TransactionSpec | null {
    const lines = selectedListLines(state);
    const first = lines?.[0];

    if (lines == null || first == null) {
        return null;
    }

    const target = findSiblingAbove(state, first)?.contentColumn ?? first.indent + getIndentUnit(state);
    const shift = Math.max(target - first.indent, 1);

    return shiftLines(state, withSubItems(state, lines), shift, 'input.indent');
}

// Null when a selected line is not a list item.
export function outdentListItems(state: EditorState): TransactionSpec | null {
    const lines = selectedListLines(state);
    const first = lines?.[0];

    if (lines == null || first == null) {
        return null;
    }

    if (first.indent === 0) {
        return {};
    }

    const parentIndent = findParentAbove(state, first)?.indent ?? Math.max(0, first.indent - getIndentUnit(state));

    return shiftLines(state, withSubItems(state, lines), parentIndent - first.indent, 'delete.dedent');
}

function parseListLine(line: Line): ListLine | null {
    const match = LIST_ITEM_PATTERN.exec(line.text);

    if (match == null) {
        return null;
    }

    const indent = match[1]?.length ?? 0;

    return { line, indent, contentColumn: match[0].length };
}

function selectedListLines(state: EditorState): ListLine[] | null {
    const numbers = new Set<number>();

    for (const range of state.selection.ranges) {
        const firstNumber = state.doc.lineAt(range.from).number;
        const lastNumber = state.doc.lineAt(range.to).number;

        for (let number = firstNumber; number <= lastNumber; number++) {
            numbers.add(number);
        }
    }

    const lines: ListLine[] = [];

    for (const number of [...numbers].sort((left, right) => left - right)) {
        const line = state.doc.line(number);
        const parsed = parseListLine(line);

        if (parsed == null) {
            if (line.text.trim() === '') {
                continue;
            }

            return null;
        }

        lines.push(parsed);
    }

    return lines;
}

// The nearest item above at the same depth, which the line nests under.
function findSiblingAbove(state: EditorState, item: ListLine): ListLine | null {
    for (const above of listLinesAbove(state, item.line)) {
        if (above.indent === item.indent) {
            return above;
        }

        if (above.indent < item.indent) {
            return null;
        }
    }

    return null;
}

// The nearest item above at a shallower depth, which holds the line.
function findParentAbove(state: EditorState, item: ListLine): ListLine | null {
    for (const above of listLinesAbove(state, item.line)) {
        if (above.indent < item.indent) {
            return above;
        }
    }

    return null;
}

// List items above the line, nearest first, stopping where the list ends.
function* listLinesAbove(state: EditorState, line: Line): Generator<ListLine> {
    for (let number = line.number - 1; number >= 1; number--) {
        const above = state.doc.line(number);
        const parsed = parseListLine(above);

        if (parsed != null) {
            yield parsed;
            continue;
        }

        // Blank lines and indented continuation text stay inside the list.
        if (above.text.trim() !== '' && !/^\s/.test(above.text)) {
            return;
        }
    }
}

// The selected items plus the deeper lines right after the last one, so sub-items move with their item.
function withSubItems(state: EditorState, lines: ReadonlyArray<ListLine>): Line[] {
    const result = lines.map((item) => item.line);
    const last = lines.at(-1);

    if (last == null) {
        return result;
    }

    for (let number = last.line.number + 1; number <= state.doc.lines; number++) {
        const next = state.doc.line(number);
        const indent = /^[ \t]*/.exec(next.text)?.[0].length ?? 0;

        if (next.text.trim() === '' || indent <= last.indent) {
            break;
        }

        result.push(next);
    }

    return result;
}

function shiftLines(
    state: EditorState,
    lines: ReadonlyArray<Line>,
    shift: number,
    userEvent: string,
): TransactionSpec {
    const changes = state.changes(lines.map((line) => {
        if (shift > 0) {
            return { from: line.from, insert: ' '.repeat(shift) };
        }

        const indent = /^[ \t]*/.exec(line.text)?.[0].length ?? 0;

        return { from: line.from, to: line.from + Math.min(indent, -shift) };
    }));
    const ranges = state.selection.ranges.map((range) => EditorSelection.range(
        changes.mapPos(range.anchor, 1),
        changes.mapPos(range.head, 1),
    ));

    return {
        changes,
        selection: EditorSelection.create(ranges, state.selection.mainIndex),
        scrollIntoView: true,
        userEvent,
    };
}
