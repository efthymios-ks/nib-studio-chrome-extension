import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { destroyLiveEditors, mountLiveEditor, shownLines } from '../testing/liveEditor.js';
import { ignoreSelectionChange } from '../testing/testHelpers.js';
import { blockItems, liveStructure, normalizeLabel, regionAt } from './liveBlocks.js';

vi.mock('../views/mermaidBridge.js', () => ({
    renderMermaidIntoAsync: vi.fn(async () => {}),
}));

beforeEach(() => {
    document.addEventListener('selectionchange', ignoreSelectionChange, true);
});

afterEach(() => {
    destroyLiveEditors();
    document.body.replaceChildren();
    document.removeEventListener('selectionchange', ignoreSelectionChange, true);
});

function structureOf(text: string): { view: EditorView; structure: NonNullable<ReturnType<typeof liveStructure>> } {
    const view = mountLiveEditor(text).view;

    return { view, structure: liveStructure(view.state)! };
}

describe('front matter', () => {
    it('reads YAML front matter closed by three dots', () => {
        const { view, structure } = structureOf('---\ntitle: Notes\n...\n\nbody');

        expect(structure.frontMatter).toEqual({
            kind: 'frontMatter',
            from: 0,
            to: 20,
            content: { from: 4, to: 16 },
            language: 'yaml',
            source: 'title: Notes',
            isClosed: true,
        });
        expect(view.contentDOM.querySelector('.cm-live-front-matter .cm-live-box-label')?.textContent).toBe('Front matter');
    });

    it('reads empty front matter as a box with no lines', () => {
        expect(structureOf('---\n---\n\nbody').structure.frontMatter).toMatchObject({ from: 0, to: 7, content: null, source: '' });
    });

    it('needs the dashes on the first line and a closing line', () => {
        expect(structureOf('\n---\ntitle: x\n---').structure.frontMatter).toBeNull();
        expect(structureOf('---\ntitle: x').structure.frontMatter).toBeNull();
    });
});

describe('code blocks', () => {
    it('reads the language of a tilde fence and the lines between the fences', () => {
        const { structure } = structureOf('~~~py\nprint(1)\n~~~\n');

        expect(structure.regions).toEqual([{
            kind: 'code',
            from: 0,
            to: 18,
            content: { from: 6, to: 14 },
            language: 'py',
            source: 'print(1)',
            isClosed: true,
        }]);
    });

    it('runs an unclosed block to the end of the document, as a code box even for mermaid', () => {
        const { view, structure } = structureOf('intro\n\n```mermaid\ngraph TD;\nA-->B');

        expect(structure.regions).toEqual([expect.objectContaining({
            kind: 'code',
            content: { from: 18, to: 33 },
            isClosed: false,
        })]);
        expect(view.contentDOM.querySelector('.cm-live-code-box .cm-live-code-end')).toBeNull();
        expect(shownLines(view).slice(-2)).toEqual(['graph TD;', 'A-->B']);
    });

    it('draws a closed mermaid block as a diagram whatever the case of its language', () => {
        const { structure } = structureOf('```Mermaid\ngraph TD;\n```\n\nend');

        expect(structure.regions.map((region) => region.kind)).toEqual(['mermaid']);
    });

    it('hides the indentation a fenced block shares with its fence', () => {
        const { view } = structureOf('- item\n\n  ```js\n  let a;\n    nested;\n  ```\n\nend');

        expect([...view.contentDOM.querySelectorAll('.cm-live-code-box .cm-line')].map((line) => line.textContent))
            .toEqual(['let a;', '  nested;']);
    });
});

describe('regionAt', () => {
    const TEXT = '---\nk: v\n---\n\ntext\n\n```js\ncode\n```\n\n***\n';

    it('finds the box around a position, its edges included', () => {
        const { view } = structureOf(TEXT);
        const codeStart = TEXT.indexOf('```js');
        const codeEnd = TEXT.indexOf('```\n\n***') + 3;
        const rule = TEXT.indexOf('***');

        expect(regionAt(view.state, 0)?.kind).toBe('frontMatter');
        expect(regionAt(view.state, 12)?.kind).toBe('frontMatter');
        expect(regionAt(view.state, TEXT.indexOf('text'))).toBeNull();
        expect(regionAt(view.state, codeStart)?.kind).toBe('code');
        expect(regionAt(view.state, codeEnd)?.kind).toBe('code');
        expect(regionAt(view.state, codeEnd + 1)).toBeNull();
        expect(regionAt(view.state, rule + 1)?.kind).toBe('rule');
    });
});

describe('link references', () => {
    it('matches labels without case, brackets or repeated spaces', () => {
        expect(normalizeLabel('[Read  the\tDocs]')).toBe('read the docs');
        expect(normalizeLabel(' faq ')).toBe('faq');
    });

    it('keeps the first definition of a label', () => {
        const { structure } = structureOf('[a]\n\n[A]: https://first.example\n[a]: https://second.example');

        expect([...structure.references]).toEqual([['a', 'https://first.example']]);
    });
});

describe('setext headings', () => {
    it('reads the level from the underline and hides the underline', () => {
        const { view, structure } = structureOf('Two\nlines\n---\n\nbody');

        expect(structure.setextHeadings).toEqual([{ from: 0, textTo: 9, to: 13, level: 2 }]);
        expect(blockItems(view.state).map((item) => view.state.sliceDoc(item.from, item.to))).toEqual(['\n---']);
        expect(shownLines(view)).toEqual(['Two', 'lines', '', 'body']);
    });
});

describe('tables', () => {
    function cells(view: EditorView): string[][] {
        return [...view.contentDOM.querySelectorAll('.cm-live-table-row')]
            .map((row) => [...row.querySelectorAll('.cm-live-table-cell')].map((cell) => cell.textContent ?? ''));
    }

    it('draws a table without outer pipes as the same grid', () => {
        const { view } = structureOf('a | b\n--|--\n1 | 2\n\nend');

        expect(cells(view)).toEqual([['a', 'b'], ['1', '2']]);
        expect(shownLines(view).join('\n')).not.toContain('|');
    });

    it('draws an empty cell so the columns still line up', () => {
        const { view } = structureOf('| a | b | c |\n| - | - | - |\n| 1 || 3 |');

        expect(cells(view)[1]).toEqual(['1', '', '3']);
    });

    it('steps the caret over pipes and padding in source order', () => {
        const { view } = structureOf('| a | b |\n| - | - |\n| 1 | 2 |');
        const starts = blockItems(view.state).map((item) => item.from);

        expect(starts).toEqual([...starts].sort((left, right) => left - right));
        expect(blockItems(view.state).every((item) => item.side != null)).toBe(true);
    });
});
