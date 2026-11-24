import { describe, expect, it } from 'vitest';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState, type Line, type TransactionSpec } from '@codemirror/state';
import {
    cellSafeText,
    deleteColumn,
    deleteRow,
    findTables,
    insertColumn,
    insertRow,
    moveToNextCell,
    parseAlignment,
    readRow,
    tableAt,
} from './markdownTables.js';

function stateOf(text: string, caret = 0): EditorState {
    const state = EditorState.create({
        doc: text,
        selection: EditorSelection.single(caret),
        extensions: [markdown({ base: markdownLanguage })],
    });
    ensureSyntaxTree(state, state.doc.length, 5000);

    return state;
}

function apply(state: EditorState, spec: TransactionSpec | null): string {
    return spec == null ? 'null' : state.update(spec).state.doc.toString();
}

function lineOf(text: string): Line {
    return { from: 0, to: text.length, text, number: 1, length: text.length } as Line;
}

function cellTexts(text: string): string[] {
    return readRow(lineOf(text)).cells.map((cell) => text.slice(cell.textFrom, cell.textTo));
}

const TABLE = '| Name | Qty |\n| :--- | --: |\n| Pen | 3 |\n| Ink | 5 |';

describe('reading rows', () => {
    it.each([
        ['with outer pipes', '| a | b |', ['a', 'b']],
        ['without outer pipes', 'a | b', ['a', 'b']],
        ['with an escaped pipe in a cell', '| a\\|b | c |', ['a\\|b', 'c']],
        ['with a blank cell', '| a |  | c |', ['a', '', 'c']],
        ['with trailing spaces', '| a | b |   ', ['a', 'b']],
        ['with a single cell', '| a |', ['a']],
    ])('splits a row %s', (_name, text, expected) => {
        expect(cellTexts(text)).toEqual(expected);
    });

    it('notes the outer pipes and the dividers', () => {
        const row = readRow(lineOf('a | b |'));

        expect(row.hasLeadingPipe).toBe(false);
        expect(row.hasTrailingPipe).toBe(true);
        expect(row.dividers).toEqual([{ from: 2, to: 3 }, { from: 6, to: 7 }]);
    });

    it('reads column alignment from the delimiter row', () => {
        expect(['---', ':--', '--:', ':-:'].map(parseAlignment)).toEqual([null, 'left', 'right', 'center']);
        expect(findTables(stateOf(TABLE))[0]?.alignments).toEqual(['left', 'right']);
    });

    it('finds the table, row and column at a position', () => {
        const state = stateOf(`intro\n\n${TABLE}`);
        const position = tableAt(state, state.doc.toString().indexOf('5'));

        expect(position?.rowIndex).toBe(2);
        expect(position?.column).toBe(1);
        expect(tableAt(state, 2)).toBeNull();
    });
});

describe('table edits', () => {
    it('inserts a blank row below and above a body row, and below the header after the delimiter row', () => {
        const state = stateOf(TABLE);
        const [table] = findTables(state);

        expect(apply(state, insertRow(table!, 1, 'below'))).toBe('| Name | Qty |\n| :--- | --: |\n| Pen | 3 |\n|  |  |\n| Ink | 5 |');
        expect(apply(state, insertRow(table!, 1, 'above'))).toBe('| Name | Qty |\n| :--- | --: |\n|  |  |\n| Pen | 3 |\n| Ink | 5 |');
        expect(apply(state, insertRow(table!, 0, 'below'))).toBe('| Name | Qty |\n| :--- | --: |\n|  |  |\n| Pen | 3 |\n| Ink | 5 |');
        expect(insertRow(table!, 0, 'above')).toBeNull();
    });

    it('inserts a column on every line, the delimiter row included', () => {
        const state = stateOf(TABLE);
        const [table] = findTables(state);

        expect(apply(state, insertColumn(state, table!, 0, 'left')))
            .toBe('|  | Name | Qty |\n| --- | :--- | --: |\n|  | Pen | 3 |\n|  | Ink | 5 |');
        expect(apply(state, insertColumn(state, table!, 1, 'right')))
            .toBe('| Name | Qty |  |\n| :--- | --: | --- |\n| Pen | 3 |  |\n| Ink | 5 |  |');
    });

    it('inserts a column into a table without outer pipes', () => {
        const state = stateOf('a | b\n--- | ---\n1 | 2');
        const [table] = findTables(state);

        expect(apply(state, insertColumn(state, table!, 1, 'right'))).toBe('a | b | \n--- | --- | ---\n1 | 2 | ');
    });

    it('deletes a body row, never the header', () => {
        const state = stateOf(TABLE);
        const [table] = findTables(state);

        expect(apply(state, deleteRow(state, table!, 2))).toBe('| Name | Qty |\n| :--- | --: |\n| Pen | 3 |');
        expect(deleteRow(state, table!, 0)).toBeNull();
    });

    it('deletes a column from every line, never the last one', () => {
        const state = stateOf(TABLE);
        const [table] = findTables(state);

        expect(apply(state, deleteColumn(state, table!, 0))).toBe('| Qty |\n| --: |\n| 3 |\n| 5 |');
        expect(apply(state, deleteColumn(state, table!, 1))).toBe('| Name |\n| :--- |\n| Pen |\n| Ink |');

        const single = stateOf('| a |\n| - |');

        expect(deleteColumn(single, findTables(single)[0]!, 0)).toBeNull();
    });

    it('adds a row from the last cell with Tab and selects the next cell otherwise', () => {
        const last = stateOf(TABLE, TABLE.length - 2);

        expect(apply(last, moveToNextCell(last, true))).toBe(`${TABLE}\n|  |  |`);

        const first = stateOf(TABLE, 3);
        const next = first.update(moveToNextCell(first, true)!).state;

        expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe('Qty');
        expect(moveToNextCell(stateOf('plain'), true)).toBeNull();
    });

    it('keeps typed and pasted text inside a cell', () => {
        expect(cellSafeText('a|b\nc')).toBe('a\\|b c');
        expect(cellSafeText('already \\| escaped')).toBe('already \\| escaped');
    });
});
