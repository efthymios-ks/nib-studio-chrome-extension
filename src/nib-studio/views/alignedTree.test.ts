import { describe, expect, it, vi } from 'vitest';
import { buildJsonDiffDocument } from '../../common/diff/jsonDiffDocument.js';
import { renderAlignedTree, treeRowId, type TreeViewRow } from './alignedTree.js';

function rowsOf(left: unknown, right: unknown): TreeViewRow[] {
    const document = buildJsonDiffDocument({ original: { name: 'a.json', source: 'file' }, modified: { name: 'b.json', source: 'file' }, left, right });

    return document.rows.map((source) => {
        const cell = source.left ?? source.right;

        return { id: treeRowId(source), source, node: cell?.node ?? 'leaf', depth: cell?.depth ?? 0, expanded: cell?.node === 'open' };
    });
}

describe('treeRowId', () => {
    it('names a row by its left path, a right-only row by its right path, and a closing row after its opening one', () => {
        const ids = rowsOf({ a: { x: 1 } }, { a: { x: 1 }, b: 2 }).map((row) => row.id);

        expect(ids).toEqual(['$', '$.a', '$.a.x', '$.a:close', 'r:$.b', '$:close']);
    });
});

describe('renderAlignedTree', () => {
    it('draws one row per key on both sides, with placeholders where a side lacks it, and marks rows only one side has', () => {
        const grid = renderAlignedTree({ rows: rowsOf({ a: 1, b: 2 }, { a: 1, c: 3 }), onToggle: vi.fn() });
        const rows = [...grid.querySelectorAll<HTMLElement>('.aligned-row')];

        expect(rows.map((row) => [...row.children].map((cell) => (cell as HTMLElement).dataset['placeholder'] === 'true' ? '·' : cell.textContent).join(' | '))).toEqual([
            '▾{2 keys | ▾{2 keys',
            'a:1 | a:1',
            'b:2 | ·',
            '· | c:3',
            '} | }',
        ]);
        expect(rows.map((row) => row.dataset['only'] ?? '')).toEqual(['', '', 'original', 'modified', '']);
        expect(rows.map((row) => row.dataset['role'])).toEqual(['open', 'leaf', 'leaf', 'leaf', 'close']);
    });

    it('marks the cells of a change with their state, and leaves the rest of an added branch plain', () => {
        const grid = renderAlignedTree({ rows: rowsOf({ a: 1 }, { a: 2, list: [1] }), onToggle: vi.fn() });
        const marked = [...grid.querySelectorAll<HTMLElement>('.aligned-cell[data-diff]')].map((cell) => `${cell.dataset['side']}:${cell.dataset['path']}:${cell.dataset['diff']}`);

        expect(marked).toEqual(['original:$.a:changed', 'modified:$.a:changed', 'modified:$.list:added']);
    });

    it('types scalar values, counts the children of an open object, and shows a closed one in full', () => {
        const rows = rowsOf({ o: { s: 'x', n: 1, b: true, z: null } }, { o: { s: 'x', n: 1, b: true, z: null } });
        const closed = rows.map((row) => row.id === '$.o' ? { ...row, expanded: false } : row).filter((row) => !row.id.startsWith('$.o.') && row.id !== '$.o:close');
        const open = renderAlignedTree({ rows, onToggle: vi.fn() });

        expect([...open.querySelectorAll<HTMLElement>('.aligned-cell[data-side="original"] .aligned-value')].map((value) => `${value.dataset['kind']}/${value.dataset['type'] ?? ''}:${value.textContent}`)).toEqual([
            'object/:{',
            'object/:{',
            'scalar/boolean:true',
            'scalar/number:1',
            'scalar/string:"x"',
            'scalar/null:null',
            'object/:}',
            'object/:}',
        ]);
        expect(open.querySelector('.aligned-row[data-id="$.o"] .json-count')?.textContent).toBe('4 keys');
        expect(renderAlignedTree({ rows: closed, onToggle: vi.fn() }).querySelector('.aligned-row[data-id="$.o"] .aligned-value')?.textContent).toBe('{ 4 keys');
    });

    it('toggles a node from its twist, and hands the rule path of a clicked array to the array handler', () => {
        const onToggle = vi.fn();
        const onArrayClick = vi.fn();
        const grid = renderAlignedTree({ rows: rowsOf({ list: [1] }, { list: [2] }), onToggle, onArrayClick });

        grid.querySelector<HTMLButtonElement>('.aligned-row[data-id="$.list"] .aligned-twist')!.click();
        grid.querySelector<HTMLElement>('.aligned-row[data-id="$.list"] [data-clickable="true"]')!.click();

        expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: '$.list' }));
        expect(onArrayClick).toHaveBeenCalledWith('$.list[*]');
    });
});
