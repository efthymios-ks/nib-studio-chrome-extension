import { syntaxTree } from '@codemirror/language';
import { EditorSelection, type EditorState, type Line, type TransactionSpec } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';
import { asUndoStep } from './liveTransactions.js';

export type CellAlignment = 'left' | 'center' | 'right' | null;

export interface TableCell {
    // Between the dividers around the cell, its padding included.
    readonly from: number;
    readonly to: number;
    // The cell's text without its padding; both sit inside the padding when the cell is blank.
    readonly textFrom: number;
    readonly textTo: number;
}

export interface TableDivider {
    readonly from: number;
    readonly to: number;
}

export interface TableRow {
    readonly from: number;
    readonly to: number;
    readonly indent: string;
    readonly cells: ReadonlyArray<TableCell>;
    // The row's pipes, in order.
    readonly dividers: ReadonlyArray<TableDivider>;
    readonly hasLeadingPipe: boolean;
    readonly hasTrailingPipe: boolean;
}

export interface MarkdownTable {
    // From the start of the header line to the end of the last row.
    readonly from: number;
    readonly to: number;
    // The header first, then the body rows; the delimiter row is apart.
    readonly rows: ReadonlyArray<TableRow>;
    readonly delimiterRow: TableRow;
    readonly alignments: ReadonlyArray<CellAlignment>;
    readonly columnCount: number;
}

export interface TablePosition {
    readonly table: MarkdownTable;
    // 0 for the header, then 1 and up for the body rows.
    readonly rowIndex: number;
    readonly column: number;
}

export type RowPlacement = 'above' | 'below';
export type ColumnPlacement = 'left' | 'right';

const CONTAINER_BLOCKS = new Set(['Document', 'Blockquote', 'BulletList', 'OrderedList', 'ListItem']);
const BLANK_PATTERN = /^[ \t]*$/;
const DELIMITER_CELL = '---';

// The tables of the document, found in its block structure without walking inline content.
export function findTables(state: EditorState, tree: Tree = syntaxTree(state)): MarkdownTable[] {
    const tables: MarkdownTable[] = [];

    tree.iterate({
        enter: (node) => {
            if (node.name === 'Table') {
                const table = readTable(state, node.from, node.to);

                if (table != null) {
                    tables.push(table);
                }

                return false;
            }

            return CONTAINER_BLOCKS.has(node.name);
        },
    });

    return tables;
}

// The table, row and column at the position, or null outside a table.
export function tableAt(state: EditorState, position: number): TablePosition | null {
    const node = enclosingTableNode(state, position, 1) ?? enclosingTableNode(state, position, -1);

    if (node == null) {
        return null;
    }

    const table = readTable(state, node.from, node.to);

    if (table == null) {
        return null;
    }

    const lineFrom = state.doc.lineAt(position).from;
    const rowIndex = table.rows.findIndex((row) => row.from === lineFrom);

    if (rowIndex < 0) {
        return null;
    }

    return { table, rowIndex, column: columnAt(table.rows[rowIndex]!, position) };
}

function enclosingTableNode(state: EditorState, position: number, side: -1 | 1): SyntaxNode | null {
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, side);

    while (node != null && node.name !== 'Table') {
        node = node.parent;
    }

    return node;
}

function columnAt(row: TableRow, position: number): number {
    const index = row.cells.findIndex((cell) => position <= cell.to);

    return index < 0 ? Math.max(0, row.cells.length - 1) : index;
}

function readTable(state: EditorState, from: number, to: number): MarkdownTable | null {
    const firstLine = state.doc.lineAt(from);
    const lastLine = state.doc.lineAt(to);

    if (lastLine.number < firstLine.number + 1) {
        return null;
    }

    const header = readRow(state.doc.line(firstLine.number));
    const delimiterRow = readRow(state.doc.line(firstLine.number + 1));
    const rows: TableRow[] = [header];

    for (let number = firstLine.number + 2; number <= lastLine.number; number++) {
        const line = state.doc.line(number);

        if (!BLANK_PATTERN.test(line.text)) {
            rows.push(readRow(line));
        }
    }

    const alignments = delimiterRow.cells.map((cell) => parseAlignment(state.sliceDoc(cell.textFrom, cell.textTo)));

    return {
        from: firstLine.from,
        to: rows.at(-1)?.to ?? lastLine.to,
        rows,
        delimiterRow,
        alignments,
        columnCount: header.cells.length,
    };
}

// Splits a row on its unescaped pipes; a pipe after an odd number of backslashes is text.
export function readRow(line: Line): TableRow {
    const text = line.text;
    const indent = /^[ \t]*/.exec(text)?.[0] ?? '';
    const pipes: number[] = [];

    for (let index = indent.length; index < text.length; index++) {
        if (text[index] === '|' && countBackslashesBefore(text, index) % 2 === 0) {
            pipes.push(index);
        }
    }

    const contentEnd = text.trimEnd().length;
    const hasLeadingPipe = pipes[0] === indent.length;
    const hasTrailingPipe = pipes.length > (hasLeadingPipe ? 1 : 0) && pipes.at(-1) === contentEnd - 1;
    const bounds: number[] = [hasLeadingPipe ? indent.length : indent.length - 1];

    for (const pipe of pipes) {
        if (pipe !== bounds[0] && !(hasTrailingPipe && pipe === pipes.at(-1))) {
            bounds.push(pipe);
        }
    }

    bounds.push(hasTrailingPipe ? contentEnd - 1 : text.length);
    const cells: TableCell[] = [];

    for (let index = 0; index < bounds.length - 1; index++) {
        const cellFrom = bounds[index]! + 1;
        const cellTo = bounds[index + 1]!;
        cells.push(cellBounds(line.from, text, cellFrom, cellTo));
    }

    return {
        from: line.from,
        to: line.to,
        indent,
        cells,
        dividers: pipes.map((pipe) => ({ from: line.from + pipe, to: line.from + pipe + 1 })),
        hasLeadingPipe,
        hasTrailingPipe,
    };
}

function countBackslashesBefore(text: string, index: number): number {
    let count = 0;

    while (index - count - 1 >= 0 && text[index - count - 1] === '\\') {
        count++;
    }

    return count;
}

// A blank cell keeps its text position after the first padding space, so typing there reads `| x |`.
function cellBounds(lineFrom: number, text: string, from: number, to: number): TableCell {
    const content = text.slice(from, to);
    const leading = content.length - content.trimStart().length;
    const trimmed = content.trim();

    if (trimmed === '') {
        const blank = lineFrom + Math.min(from + 1, to);

        return { from: lineFrom + from, to: lineFrom + to, textFrom: blank, textTo: blank };
    }

    return {
        from: lineFrom + from,
        to: lineFrom + to,
        textFrom: lineFrom + from + leading,
        textTo: lineFrom + from + leading + trimmed.length,
    };
}

export function parseAlignment(cell: string): CellAlignment {
    const starts = cell.startsWith(':');
    const ends = cell.endsWith(':');

    if (starts && ends) {
        return 'center';
    }

    if (ends) {
        return 'right';
    }

    return starts ? 'left' : null;
}

// Tab moves to the next cell and Shift+Tab to the previous one, selecting its text;
// Tab in the last cell adds a row. Null outside a table.
export function moveToNextCell(state: EditorState, forward: boolean): TransactionSpec | null {
    const position = tableAt(state, state.selection.main.head);

    if (position == null) {
        return null;
    }

    const { table, rowIndex, column } = position;
    const columns = table.columnCount;
    const flat = rowIndex * columns + column + (forward ? 1 : -1);

    if (flat < 0) {
        return {};
    }

    if (flat >= table.rows.length * columns) {
        return insertRow(table, table.rows.length - 1, 'below');
    }

    return selectCell(table, Math.floor(flat / columns), flat % columns);
}

// ↑ and ↓ move to the same column in the row above or below; null at the table's edge.
export function moveToRowCell(state: EditorState, forward: boolean): TransactionSpec | null {
    const position = tableAt(state, state.selection.main.head);

    if (position == null) {
        return null;
    }

    const target = position.rowIndex + (forward ? 1 : -1);

    if (target < 0 || target >= position.table.rows.length) {
        return null;
    }

    const cell = cellOf(position.table, target, position.column);

    return cell == null ? null : { selection: EditorSelection.cursor(cell.textTo), scrollIntoView: true, userEvent: 'select' };
}

// Home and End go to the start and end of the cell's text, not of the row; null outside a table.
export function moveToCellEdge(state: EditorState, forward: boolean, extend: boolean): TransactionSpec | null {
    const main = state.selection.main;
    const position = tableAt(state, main.head);
    const cell = position == null ? null : cellOf(position.table, position.rowIndex, position.column);

    if (cell == null) {
        return null;
    }

    const target = forward ? cell.textTo : cell.textFrom;

    return {
        selection: extend ? EditorSelection.range(main.anchor, target) : EditorSelection.cursor(target),
        scrollIntoView: true,
        userEvent: 'select',
    };
}

// Enter moves down a row like a spreadsheet, adding a row below the last one.
export function moveDownOrAddRow(state: EditorState): TransactionSpec | null {
    const position = tableAt(state, state.selection.main.head);

    if (position == null) {
        return null;
    }

    if (position.rowIndex === position.table.rows.length - 1) {
        return insertRow(position.table, position.rowIndex, 'below', position.column);
    }

    const cell = cellOf(position.table, position.rowIndex + 1, position.column);

    return cell == null ? {} : { selection: EditorSelection.cursor(cell.textTo), scrollIntoView: true, userEvent: 'select' };
}

function cellOf(table: MarkdownTable, rowIndex: number, column: number): TableCell | null {
    const row = table.rows[rowIndex];

    if (row == null || row.cells.length === 0) {
        return null;
    }

    return row.cells[Math.min(column, row.cells.length - 1)] ?? null;
}

function selectCell(table: MarkdownTable, rowIndex: number, column: number): TransactionSpec {
    const cell = cellOf(table, rowIndex, column);

    if (cell == null) {
        return {};
    }

    return { selection: EditorSelection.range(cell.textFrom, cell.textTo), scrollIntoView: true, userEvent: 'select' };
}

function blankRowText(table: MarkdownTable): string {
    const style = table.rows[0]!;
    const cells = Array.from({ length: table.columnCount }, () => '').join(' | ');

    return `${style.indent}${style.hasLeadingPipe ? '| ' : ''}${cells}${style.hasTrailingPipe ? ' |' : ''}`;
}

// Adds a blank row and puts the caret in its cell at `column`; the header has no row above it.
export function insertRow(
    table: MarkdownTable,
    rowIndex: number,
    placement: RowPlacement,
    column = 0,
): TransactionSpec | null {
    const row = table.rows[rowIndex];

    if (row == null || (rowIndex === 0 && placement === 'above')) {
        return null;
    }

    const text = blankRowText(table);
    // Below the header means below the delimiter row.
    const anchor = rowIndex === 0 ? table.delimiterRow : row;
    const insertAt = placement === 'below' ? anchor.to : anchor.from;
    const inserted = placement === 'below' ? `\n${text}` : `${text}\n`;
    const lineStart = placement === 'below' ? insertAt + 1 : insertAt;
    const blank = readRowText(lineStart, text);
    const cell = blank.cells[Math.min(column, blank.cells.length - 1)];

    return asTableEdit({
        changes: { from: insertAt, insert: inserted },
        selection: EditorSelection.cursor(cell?.textFrom ?? lineStart),
    });
}

function readRowText(from: number, text: string): TableRow {
    return readRow({ from, to: from + text.length, text, number: 0, length: text.length } as Line);
}

// Removes a body row; the header stays, so it is never removed.
export function deleteRow(state: EditorState, table: MarkdownTable, rowIndex: number): TransactionSpec | null {
    const row = table.rows[rowIndex];

    if (row == null || rowIndex === 0) {
        return null;
    }

    const next = table.rows[rowIndex + 1] ?? table.rows[rowIndex - 1]!;
    const from = row.from - 1;
    const changes = { from, to: row.to };
    const mapped = state.changes(changes);
    const target = cellOf(table, table.rows.indexOf(next), 0);

    return asTableEdit({
        changes,
        selection: EditorSelection.cursor(mapped.mapPos(target?.textFrom ?? from, -1)),
    });
}

// Adds a column on every line of the table, the delimiter row included, keeping the rows' pipe style.
export function insertColumn(
    state: EditorState,
    table: MarkdownTable,
    column: number,
    placement: ColumnPlacement,
): TransactionSpec {
    const index = placement === 'left' ? column : column + 1;
    const changes = allLines(table).map((row) => insertCellChange(row, index, row === table.delimiterRow ? DELIMITER_CELL : ''));
    const changeSet = state.changes(changes.map(({ from, insert }) => ({ from, insert })));
    const caretRow = tableAt(state, state.selection.main.head)?.rowIndex ?? 0;
    const caretChange = insertCellChange(table.rows[caretRow] ?? table.rows[0]!, index, '');
    const insertedAt = changeSet.mapPos(caretChange.from, -1);

    return asTableEdit({
        changes: changeSet,
        selection: EditorSelection.cursor(insertedAt + caretChange.caretOffset),
    });
}

interface CellInsertion {
    readonly from: number;
    readonly insert: string;
    // Where the new cell's text starts within the inserted text.
    readonly caretOffset: number;
}

function insertCellChange(row: TableRow, index: number, text: string): CellInsertion {
    const cell = row.cells[index];

    if (cell != null) {
        // Before an existing cell: after the pipe in front of it, or at the line's text start without one.
        const pipeBefore = row.dividers.find((divider) => divider.to === cell.from);

        return pipeBefore == null
            ? { from: cell.from, insert: `${text} | `, caretOffset: 0 }
            : { from: pipeBefore.to, insert: ` ${text} |`, caretOffset: 1 };
    }

    const last = row.dividers.at(-1);

    return row.hasTrailingPipe && last != null
        ? { from: last.to, insert: ` ${text} |`, caretOffset: 1 }
        : { from: row.to, insert: ` | ${text}`, caretOffset: 3 };
}

// Removes a column from every line of the table; the last column stays.
export function deleteColumn(state: EditorState, table: MarkdownTable, column: number): TransactionSpec | null {
    if (table.columnCount <= 1) {
        return null;
    }

    const changes = allLines(table)
        .map((row) => deleteCellChange(row, column))
        .filter((change): change is { from: number; to: number } => change != null);
    const changeSet = state.changes(changes);
    const caret = tableAt(state, state.selection.main.head);
    const row = table.rows[caret?.rowIndex ?? 0] ?? table.rows[0]!;
    const neighbour = row.cells[column === 0 ? 1 : column - 1];

    return asTableEdit({
        changes: changeSet,
        selection: EditorSelection.cursor(changeSet.mapPos(neighbour?.textTo ?? row.from, 1)),
    });
}

function deleteCellChange(row: TableRow, column: number): { from: number; to: number } | null {
    const cell = row.cells[column];

    if (cell == null) {
        return null;
    }

    const pipeBefore = row.dividers.find((divider) => divider.to === cell.from);
    const pipeAfter = row.dividers.find((divider) => divider.from === cell.to);

    if (pipeBefore != null && pipeAfter != null) {
        return { from: pipeBefore.to, to: pipeAfter.to };
    }

    if (pipeAfter != null) {
        return { from: cell.from, to: pipeAfter.to };
    }

    return pipeBefore == null ? { from: cell.from, to: cell.to } : { from: pipeBefore.from, to: cell.to };
}

function allLines(table: MarkdownTable): TableRow[] {
    const [header, ...body] = table.rows;

    return [header!, table.delimiterRow, ...body];
}

// Every table edit is one undo step of its own.
function asTableEdit(spec: TransactionSpec): TransactionSpec {
    return asUndoStep(spec, 'input.table');
}

// Text typed into a cell stays in it: pipes are escaped and line breaks become spaces.
export function cellSafeText(text: string): string {
    return text.replace(/\r?\n/g, ' ').replace(/(?<!\\)\|/g, '\\|');
}
