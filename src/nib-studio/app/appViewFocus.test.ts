import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKSPACE_CONFIG_PATH } from '../../common/fs/workspaceConfig.js';
import { createAppHarness, openHarnessWorkspaceAsync, treeRow, type AppHarness } from '../testing/appHarness.js';
import { ignoreSelectionChange } from '../testing/testHelpers.js';
import { setFilesSurfaceView } from '../views/filesSurface.js';

type TextBox = HTMLInputElement | HTMLTextAreaElement;

let harness: AppHarness;

beforeEach(() => {
    document.addEventListener('selectionchange', ignoreSelectionChange, true);
    setFilesSurfaceView('editor');
    harness = createAppHarness({
        'data.json': '{"age": "old"}',
        'feed.xml': '<feed><item>1</item></feed>',
        'stock.csv': 'item,qty\nwidget,3\ngadget,5\n',
    });
});

afterEach(() => {
    harness.app.dispose();
    vi.useRealTimers();
    document.body.replaceChildren();
    document.removeEventListener('selectionchange', ignoreSelectionChange, true);
});

// Types into a box the way a keystroke does: the value changes, the caret lands, and an input event follows.
function typeInto(box: TextBox, value: string, caret: number): void {
    box.focus();
    box.value = value;
    box.setSelectionRange(caret, caret);
    box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
}

function expectFocusKept(box: TextBox, caret: number): void {
    expect(box.isConnected).toBe(true);
    expect(document.activeElement).toBe(box);
    expect(box.selectionStart).toBe(caret);
}

function expectEditorFocusKept(content: HTMLElement, head: number): void {
    expect(content.isConnected).toBe(true);
    expect(content.contains(document.activeElement)).toBe(true);
    expect(EditorView.findFromDOM(content)?.state.selection.main.head).toBe(head);
}

describe('App keeps a box in a view focused through unrelated store updates', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    async function showViewAsync(path: string, view: string): Promise<void> {
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', path);
        document.querySelector<HTMLElement>(`.editor-toolbar [data-view="${view}"]`)!.click();
        await vi.advanceTimersByTimeAsync(0);
    }

    // The keys rest long enough for the box's own debounced work and for the studio's first configuration write,
    // which reads the tree again to show the new file; then one more unrelated change goes through the store.
    async function letUnrelatedUpdatesHappenAsync(): Promise<void> {
        await vi.advanceTimersByTimeAsync(1000);
        expect(treeRow(WORKSPACE_CONFIG_PATH)).toBeDefined();
        harness.store.update({ selectedPath: WORKSPACE_CONFIG_PATH });
        await vi.advanceTimersByTimeAsync(1000);
    }

    it('in the Schema view, through its debounced check and the first configuration write', async () => {
        await showViewAsync('data.json', 'schema');
        const box = document.querySelector<HTMLTextAreaElement>('.schema-panel .schema-input')!;

        typeInto(box, '{"type":"object","properties":{"age":{"type":"number"}}}', 10);
        await letUnrelatedUpdatesHappenAsync();

        expectFocusKept(box, 10);
        expect(document.querySelector('.schema-panel')?.contains(box)).toBe(true);
        expect(document.querySelector('.schema-panel .path-query-status')?.textContent).toBe('1 error');
    });

    it.each([
        { path: 'data.json', view: 'jsonpath', name: 'JSONPath' },
        { path: 'feed.xml', view: 'xpath', name: 'XPath' },
    ])('in the $name view', async ({ path, view }) => {
        await showViewAsync(path, view);
        const box = document.querySelector<HTMLInputElement>('.path-query-input')!;

        typeInto(box, `${box.value}abc`, 2);
        await letUnrelatedUpdatesHappenAsync();

        expectFocusKept(box, 2);
    });

    it('in the side editor of a compare', async () => {
        await openHarnessWorkspaceAsync(harness);
        harness.app.newCompare('text');
        const header = document.querySelector<HTMLElement>('.diff-side-header[data-side="modified"]')!;
        header.querySelector<HTMLElement>('[data-side-action="edit"]')!.click();
        const content = document.querySelector<HTMLElement>('.diff-side-editor-host .cm-content')!;
        const editor = EditorView.findFromDOM(content)!;
        editor.dispatch({ changes: { from: 0, insert: 'draft text' }, selection: { anchor: 5 } });

        await letUnrelatedUpdatesHappenAsync();

        expectEditorFocusKept(content, 5);
    });

    it('on the Hash & encode surface', async () => {
        await openHarnessWorkspaceAsync(harness);
        document.querySelector<HTMLElement>('.app-tab[data-surface="hash"]')!.click();
        const box = document.querySelector<HTMLTextAreaElement>('.hash-surface .tool-textarea')!;

        typeInto(box, 'hello world', 5);
        await letUnrelatedUpdatesHappenAsync();

        expectFocusKept(box, 5);
    });
});

// A table reads its rows from the file, which needs the real event loop, so these run on real timers.
describe('App keeps a box in a table focused through unrelated store updates', () => {
    async function openTableAsync(): Promise<void> {
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'stock.csv');
        await vi.waitFor(() => expect(document.querySelector('.table-search')).not.toBeNull());
    }

    // The studio's first configuration write reads the tree again to show the new file; then one more change follows.
    async function letUnrelatedUpdatesHappenAsync(): Promise<void> {
        await harness.callAsync('flushConfigAsync');
        expect(treeRow(WORKSPACE_CONFIG_PATH)).toBeDefined();
        harness.store.update({ selectedPath: WORKSPACE_CONFIG_PATH });
    }

    it('in the search box', async () => {
        await openTableAsync();
        const box = document.querySelector<HTMLInputElement>('.table-search')!;

        typeInto(box, 'widget', 3);
        await letUnrelatedUpdatesHappenAsync();

        expectFocusKept(box, 3);
    });

    it('in the query panel editor', async () => {
        await openTableAsync();
        document.querySelector<HTMLElement>('.table-query-toggle')!.click();
        const content = await vi.waitFor(() => {
            const found = document.querySelector<HTMLElement>('.query-panel .cm-content');
            expect(found).not.toBeNull();

            return found!;
        });
        const editor = EditorView.findFromDOM(content)!;
        editor.focus();
        editor.dispatch({
            changes: { from: 0, to: editor.state.doc.length, insert: 'from row in rows' },
            selection: { anchor: 4 },
        });

        await letUnrelatedUpdatesHappenAsync();

        expectEditorFocusKept(content, 4);
    });
});
