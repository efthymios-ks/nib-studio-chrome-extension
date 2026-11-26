import { currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { runScopeHandlers } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryEditorState, mountQueryEditor, queryPlaceholder, type QueryEditorHandle } from './queryEditor.js';
import { settleAsync } from '../testing/testHelpers.js';

function tokensOf(state: EditorState): Array<[string, string]> {
    const tokens: Array<[string, string]> = [];
    const tree = ensureSyntaxTree(state, state.doc.length, 1000)!;
    tree.iterate({
        enter: (node) => {
            if (node.name !== 'Document' && node.from < node.to) {
                tokens.push([state.sliceDoc(node.from, node.to), node.name]);
            }
        },
    });

    return tokens;
}

describe('mountQueryEditor', () => {
    let parent: HTMLElement;
    let handle: QueryEditorHandle | null;

    beforeEach(() => {
        parent = document.createElement('div');
        document.body.append(parent);
        handle = null;
    });

    afterEach(() => {
        handle?.destroy();
        parent.remove();
    });

    function mount(initialText: string, handlers: { onRun?: () => void; onChange?: (state: EditorState) => void } = {}, columns: string[] = ['total', 'unit price']): QueryEditorHandle {
        handle = mountQueryEditor({ parent, columns, handlers, initialText });

        return handle;
    }

    function errorMarks(): string[] {
        return [...parent.querySelectorAll('.query-error-mark')].map((mark) => mark.textContent ?? '');
    }

    it('mounts an editor labelled Query with the initial text', () => {
        const editor = mount('from row in table select row');

        expect(editor.getText()).toBe('from row in table select row');
        expect(parent.querySelector('.cm-content')?.getAttribute('aria-label')).toBe('Query');
    });

    it('continues from a saved state', () => {
        const state = createQueryEditorState('select 1', [], {});
        handle = mountQueryEditor({ parent, columns: [], handlers: {}, state });

        expect(handle.getText()).toBe('select 1');
        expect(handle.view.state).toBe(state);
    });

    it('replaces the text and puts the caret at the end', () => {
        const editor = mount('old');

        editor.setText('where row.total > 5');

        expect(editor.getText()).toBe('where row.total > 5');
        expect(editor.view.state.selection.main.head).toBe('where row.total > 5'.length);
    });

    it('reports document and selection changes', () => {
        const onChange = vi.fn();
        const editor = mount('abc', { onChange });

        editor.view.dispatch({ changes: { from: 3, insert: 'd' } });
        editor.view.dispatch({ selection: { anchor: 1 } });

        expect(onChange).toHaveBeenCalledTimes(2);
        expect((onChange.mock.calls[0]?.[0] as EditorState).doc.toString()).toBe('abcd');
    });

    it('runs the query on Mod-Enter', () => {
        const onRun = vi.fn();
        const editor = mount('select row', { onRun });
        const isMac = /Mac/.test(navigator.platform);

        const handled = runScopeHandlers(editor.view, new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: !isMac, metaKey: isMac }), 'editor');

        expect(handled).toBe(true);
        expect(onRun).toHaveBeenCalledTimes(1);
    });

    it('underlines an error span and clears it', () => {
        const editor = mount('where row.bogus > 1');

        editor.markError({ start: 6, end: 15 });
        expect(errorMarks()).toEqual(['row.bogus']);

        editor.markError(null);
        expect(errorMarks()).toEqual([]);
    });

    it('clamps an error span past the end to the last character', () => {
        const editor = mount('abc');

        editor.markError({ start: 10, end: 20 });

        expect(errorMarks()).toEqual(['c']);
    });

    it('marks nothing in an empty query', () => {
        const editor = mount('');

        editor.markError({ start: 0, end: 4 });

        expect(errorMarks()).toEqual([]);
    });

    it('drops the error mark when the text is edited or replaced', () => {
        const editor = mount('abc def');
        editor.markError({ start: 4, end: 7 });

        editor.view.dispatch({ changes: { from: 0, insert: 'x' } });
        expect(errorMarks()).toEqual([]);

        editor.markError({ start: 0, end: 2 });
        editor.setText('new');
        expect(errorMarks()).toEqual([]);
    });

    it('highlights keywords, columns, members, literals and comments', () => {
        const editor = mount('from row in table where row.total > 1.5 && `unit price` != "x" orderby true // done');
        const tokens = tokensOf(editor.view.state);

        expect(tokens).toContainEqual(['from', 'keyword']);
        expect(tokens).toContainEqual(['row', 'column']);
        expect(tokens).toContainEqual(['total', 'propertyName']);
        expect(tokens).toContainEqual(['1.5', 'number']);
        expect(tokens).toContainEqual(['`unit price`', 'column']);
        expect(tokens).toContainEqual(['"x"', 'string']);
        expect(tokens).toContainEqual(['true', 'atom']);
        expect(tokens).toContainEqual(['// done', 'comment']);
        expect(tokens).toContainEqual(['>', 'operator']);
    });

    it('treats order as a keyword only when followed by by', () => {
        const editor = mount('order by row.order');
        const tokens = tokensOf(editor.view.state);

        expect(tokens[0]).toEqual(['order', 'keyword']);
        expect(tokens).toContainEqual(['order', 'propertyName']);

        handle?.destroy();
        handle = mount('select order');
        expect(tokensOf(handle.view.state)).toContainEqual(['order', 'column']);
    });

    it('suggests quoted columns, keywords and functions when asked explicitly', async () => {
        const editor = mount('');

        startCompletion(editor.view);
        await settleAsync();

        const labels = currentCompletions(editor.view.state).map((completion) => completion.label);
        expect(labels).toContain('where');
        expect(labels).toContain('total');
        expect(labels).toContain('`unit price`');
        expect(labels).toContain('Math');
    });

    it('narrows suggestions to the word being typed', async () => {
        const editor = mount('wh');
        editor.view.dispatch({ selection: { anchor: 2 } });

        startCompletion(editor.view);
        await settleAsync();

        expect(currentCompletions(editor.view.state).map((completion) => completion.label)).toEqual(['where']);
    });

    it('suggests Math functions after Math.', async () => {
        const editor = mount('Math.');
        editor.view.dispatch({ selection: { anchor: 5 } });

        startCompletion(editor.view);
        await settleAsync();

        const completions = currentCompletions(editor.view.state);
        expect(completions.length).toBeGreaterThan(0);
        expect(completions.every((completion) => completion.type === 'function')).toBe(true);
        expect(completions.map((completion) => completion.label)).not.toContain('where');
    });

    it('suggests members and columns after a dot', async () => {
        const editor = mount('row.');
        editor.view.dispatch({ selection: { anchor: 4 } });

        startCompletion(editor.view);
        await settleAsync();

        const labels = currentCompletions(editor.view.state).map((completion) => completion.label);
        expect(labels).toContain('Key');
        expect(labels).toContain('total');
        expect(labels).not.toContain('where');
    });

    describe('in a workbook', () => {
        const SHEETS = [
            { name: 'Q1', hidden: false },
            { name: 'Q2', hidden: false },
            { name: 'North Region', hidden: false },
            { name: 'Rates', hidden: true },
        ];
        const COLUMNS_BY_SHEET: Readonly<Record<string, string[]>> = {
            'q1': ['order_id', 'total'],
            'q2': ['order_id', 'total'],
            'north region': ['customer', 'revenue'],
        };

        function mountWorkbook(text: string, sheets = SHEETS): QueryEditorHandle {
            const handlers = {
                completions: (query: string) => {
                    const named = /from\s+(?:\w+\s+in\s+)?(?:\[([^\]]*)\]|'([^']*)'|(\w+))/i.exec(query);
                    const sheet = (named?.[1] ?? named?.[2] ?? named?.[3] ?? 'Q1').toLowerCase();

                    return { columns: COLUMNS_BY_SHEET[sheet] ?? [], sheets, allowsStar: sheets.length === 1 };
                },
            };
            handle = mountQueryEditor({ parent, columns: [], handlers, initialText: text });
            handle.view.dispatch({ selection: { anchor: text.length } });

            return handle;
        }

        async function labelsAsync(editor: QueryEditorHandle): Promise<string[]> {
            startCompletion(editor.view);
            await settleAsync();

            return currentCompletions(editor.view.state).map((completion) => completion.label);
        }

        it('suggests every sheet after from, quoting names with spaces, and no star when there are several', async () => {
            const labels = await labelsAsync(mountWorkbook('from '));

            expect(labels).toEqual(expect.arrayContaining(['Q1', 'Q2', "'North Region'", 'Rates']));
            expect(labels).not.toContain('*');
            expect(labels).not.toContain('where');
        });

        it('marks hidden sheets as such', async () => {
            const editor = mountWorkbook('from ');
            startCompletion(editor.view);
            await settleAsync();

            const rates = currentCompletions(editor.view.state).find((completion) => completion.label === 'Rates');
            expect(rates?.detail).toBe('hidden sheet');
        });

        it('narrows sheets to what is typed, in the style it is typed in', async () => {
            expect(await labelsAsync(mountWorkbook('from Nor'))).toEqual(["'North Region'"]);
            handle?.destroy();
            expect(await labelsAsync(mountWorkbook('from [Nor'))).toEqual(['[North Region]']);
            handle?.destroy();
            expect(await labelsAsync(mountWorkbook("from row in 'No"))).toEqual(["'North Region'"]);
        });

        it('applies the chosen sheet', async () => {
            const editor = mountWorkbook('from [Nor');
            startCompletion(editor.view);
            await settleAsync();
            runScopeHandlers(editor.view, new KeyboardEvent('keydown', { key: 'Enter' }), 'editor');

            expect(editor.getText()).toBe('from [North Region]');
        });

        it('offers the star, or table after in, when the workbook has one sheet', async () => {
            const single = [{ name: 'Data', hidden: false }];

            expect(await labelsAsync(mountWorkbook('from ', single))).toEqual(expect.arrayContaining(['Data', '*']));
            handle?.destroy();
            expect(await labelsAsync(mountWorkbook('from row in ', single))).toEqual(expect.arrayContaining(['Data', 'table']));
        });

        it('suggests the columns of the sheet the query names', async () => {
            const north = await labelsAsync(mountWorkbook("from 'North Region' where "));

            expect(north).toContain('customer');
            expect(north).not.toContain('order_id');
            handle?.destroy();

            const first = await labelsAsync(mountWorkbook('from Q2 where '));

            expect(first).toContain('order_id');
            expect(first).not.toContain('customer');
        });
    });

    it('shows a placeholder for the source, and changes it', () => {
        const editor = mount('');

        expect(parent.querySelector('.cm-placeholder')?.textContent).toBe(queryPlaceholder('*'));
        expect(queryPlaceholder('*')).toBe('from row in table\nwhere row.total > 100\nselect row');

        editor.setPlaceholder(queryPlaceholder("'North Region'"));

        expect(parent.querySelector('.cm-placeholder')?.textContent).toBe("from row in 'North Region'\nwhere row.total > 100\nselect row");
    });
});
