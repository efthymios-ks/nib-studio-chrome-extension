import { describe, expect, it } from 'vitest';
import type { RowSet } from '../csv/rowCompare.js';
import type { DiffDocumentSide, DiffRow } from './diffDocument.js';
import { buildRowsDiffDocument, displayKey, type RowsDiffDocumentInput } from './rowDiffDocument.js';

const ORIGINAL: DiffDocumentSide = { name: 'a.csv', source: 'file', path: 'a.csv' };
const MODIFIED: DiffDocumentSide = { name: 'b.csv', source: 'file', path: 'b.csv' };

const LEFT: RowSet = { columns: ['id', 'name', 'price'], rows: [['1', 'pen', '2'], ['2', 'ink', '3'], ['3', 'cap', '1']] };
const RIGHT: RowSet = { columns: ['id', 'price', 'colour'], rows: [['2', '4', 'red'], ['1', '2', 'blue'], ['4', '9', 'green']] };

function build(overrides: Partial<RowsDiffDocumentInput> = {}): ReturnType<typeof buildRowsDiffDocument> {
    return buildRowsDiffDocument({ original: ORIGINAL, modified: MODIFIED, left: LEFT, right: RIGHT, keyColumns: ['id'], ...overrides });
}

function describeRows(rows: ReadonlyArray<DiffRow>): string[] {
    const side = (cell: DiffRow['left']): string => cell == null
        ? '·'
        : `${cell.label}#${cell.line}:${cell.status} ${cell.tokens.map((token) => token == null ? '_' : `${token.text}${token.status == null ? '' : '*'}`).join(',')}`;

    return rows.map((row) => `${side(row.left)} | ${side(row.right)}${row.change == null ? '' : ` <${row.change}>`}`);
}

describe('buildRowsDiffDocument', () => {
    it('pairs rows by key in the original order, with rows only the modified file has after them, and columns in file order', () => {
        const document = build();

        expect(document.columns).toEqual([
            { name: 'id', original: true, modified: true },
            { name: 'name', original: true, modified: false },
            { name: 'price', original: true, modified: true },
            { name: 'colour', original: false, modified: true },
        ]);
        expect(describeRows(document.rows)).toEqual([
            '1#1:unchanged 1,pen,2,_ | 1#2:unchanged 1,_,2,blue',
            '2#2:changed 2,ink,3*,_ | 2#1:changed 2,_,4*,red <row id=2 · price>',
            '3#3:removed 3,cap,1,_ | · <row id=3>',
            '· | 4#3:added 4,_,9,green <row id=4>',
        ]);
    });

    it('names changed cells as row key · column and rows only one file has by their key, with their values', () => {
        const document = build();

        expect(document.changes).toEqual([
            { id: 'row id=2 · price', kind: 'changed', location: { key: '2', column: 'price' }, row: 1, before: '3', after: '4' },
            { id: 'row id=3', kind: 'removed', location: { key: '3' }, row: 2, before: { id: '3', price: '1' } },
            { id: 'row id=4', kind: 'added', location: { key: '4' }, row: 3, after: { id: '4', price: '9' } },
        ]);
        expect(document.rows[1]?.left?.tokens[2]).toEqual({ text: '3', type: 'text', column: 'price', status: 'changed', change: 'row id=2 · price' });
        expect(document.summary).toEqual({ total: 3, added: 1, removed: 1, changed: 1, typeChanged: 0, unchanged: 1 });
    });

    it('names every key column of a multi-column key', () => {
        const document = build({ keyColumns: ['id', 'price'] });

        expect(document.changes.map((change) => change.id)).toContain('row id=2, price=3');
        expect(document.rows.find((row) => row.left?.label === '2, 3')).toBeDefined();
        expect(displayKey('2\u001f3')).toBe('2, 3');
    });

    it('sorts columns by name when asked, and orders both files by the sort columns before pairing', () => {
        const document = build({ sortColumnsByName: true, sortColumns: ['price'] });

        expect(document.columns.map((column) => column.name)).toEqual(['colour', 'id', 'name', 'price']);
        expect(document.rows.map((row) => (row.left ?? row.right)?.label)).toEqual(['3', '1', '2', '4']);
        expect(document.options).toEqual({ keyColumns: ['id'], sortColumns: ['price'], ignoreColumns: [], sortColumnsByName: true, caseSensitive: true });
    });

    it('shows a key held by several rows on each of them, with its changes on the first', () => {
        const document = buildRowsDiffDocument({
            original: ORIGINAL,
            modified: MODIFIED,
            left: { columns: ['id', 'v'], rows: [['1', 'a'], ['1', 'b']] },
            right: { columns: ['id', 'v'], rows: [['1', 'c']] },
            keyColumns: ['id'],
        });

        expect(describeRows(document.rows)).toEqual([
            '1#1:changed 1,a* | 1#1:changed 1,c* <row id=1 · v>',
            '1#2:changed 1,b* | ·',
        ]);
        expect(document.changes).toHaveLength(1);
    });

    it('builds the same JSON for the same inputs', () => {
        expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
    });
});
