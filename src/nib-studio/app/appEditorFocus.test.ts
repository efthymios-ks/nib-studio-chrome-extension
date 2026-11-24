import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { textOf } from '../../common/fs/testing/fakeFileSystem.js';
import { createAppHarness, openHarnessWorkspaceAsync, type AppHarness } from '../testing/appHarness.js';
import { ignoreSelectionChange, pressKey, settleAsync } from '../testing/testHelpers.js';
import { setFilesSurfaceView } from '../views/filesSurface.js';

let harness: AppHarness;

beforeEach(() => {
    document.addEventListener('selectionchange', ignoreSelectionChange, true);
    setFilesSurfaceView('editor');
    harness = createAppHarness({
        'notes.txt': 'alpha\n',
        'data.json': '{ "a" : [1, 2] }',
        'feed.xml': '<feed><item>1</item></feed>',
        'readme.md': 'make it loud\n',
    });
});

afterEach(() => {
    harness.app.dispose();
    document.body.replaceChildren();
    document.removeEventListener('selectionchange', ignoreSelectionChange, true);
});

interface FocusedEditor {
    readonly content: HTMLElement;
    readonly view: EditorView;
}

// A Markdown file opens in Preview, so the test moves it to the view it wants, Editor unless told otherwise.
async function openAndFocusAsync(path: string, preview = false, markdownView = 'editor'): Promise<FocusedEditor> {
    await openHarnessWorkspaceAsync(harness);
    await harness.callAsync('openFileAsync', path, { preview });

    if (path.endsWith('.md')) {
        document.querySelector<HTMLElement>(`[data-view="${markdownView}"]`)!.click();
    }

    const content = document.querySelector<HTMLElement>('.cm-content')!;
    const view = EditorView.findFromDOM(content)!;
    view.focus();

    return { content, view };
}

function type(editor: FocusedEditor, text: string): void {
    const head = editor.view.state.selection.main.head;
    editor.view.dispatch({ changes: { from: head, insert: text }, selection: { anchor: head + text.length }, userEvent: 'input.type' });
}

// The editor that had focus before the action still exists and still has it.
function expectFocusKept(editor: FocusedEditor): void {
    expect(editor.content.isConnected).toBe(true);
    expect(document.querySelector('.cm-content')).toBe(editor.content);
    expect(editor.content.contains(document.activeElement)).toBe(true);
}

function press(element: Element): void {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    (element as HTMLElement).click();
}

function activeFile(): { text: string; dirty: boolean; preview: boolean } {
    const state = harness.state();

    return state.openFiles.find((file) => file.path === state.activePath)!;
}

describe('App keeps the editor focused', () => {
    it.each(['notes.txt', 'data.json', 'feed.xml', 'readme.md'])('on the first keystroke in clean %s', async (path) => {
        const editor = await openAndFocusAsync(path);

        type(editor, 'x');

        expect(activeFile().dirty).toBe(true);
        expectFocusKept(editor);

        type(editor, 'y');

        expectFocusKept(editor);
        expect(editor.view.state.selection.main.head).toBe(2);
    });

    it('when typing promotes a preview tab', async () => {
        const editor = await openAndFocusAsync('notes.txt', true);
        expect(activeFile().preview).toBe(true);

        type(editor, 'x');

        expect(activeFile().preview).toBe(false);
        expectFocusKept(editor);
    });

    it('when Ctrl+Z and Ctrl+Y go back to the saved text and away from it', async () => {
        const editor = await openAndFocusAsync('notes.txt');
        type(editor, 'x');

        pressKey(editor.content, 'z', { ctrlKey: true });

        expect(activeFile()).toMatchObject({ text: 'alpha\n', dirty: false });
        expectFocusKept(editor);

        pressKey(editor.content, 'y', { ctrlKey: true });

        expect(activeFile()).toMatchObject({ text: 'xalpha\n', dirty: true });
        expectFocusKept(editor);
    });

    it('when Ctrl+S saves', async () => {
        const editor = await openAndFocusAsync('notes.txt');
        type(editor, 'x');

        pressKey(editor.content, 's', { ctrlKey: true });
        await settleAsync();

        expect(textOf(harness.folder, 'notes.txt')).toBe('xalpha\n');
        expect(activeFile().dirty).toBe(false);
        expectFocusKept(editor);
    });

    it('when Format, Minify and Save are clicked', async () => {
        const editor = await openAndFocusAsync('data.json');
        const button = (action: string): Element => document.querySelector(`.editor-toolbar [data-action="${action}"]`)!;

        press(button('format'));

        expect(activeFile()).toMatchObject({ text: '{\n  "a": [\n    1,\n    2\n  ]\n}', dirty: true });
        expectFocusKept(editor);

        press(button('minify'));

        expect(activeFile().text).toBe('{"a":[1,2]}');
        expectFocusKept(editor);

        press(button('save'));
        await settleAsync();

        expect(textOf(harness.folder, 'data.json')).toBe('{"a":[1,2]}');
        expectFocusKept(editor);

        pressKey(editor.content, 'z', { ctrlKey: true });

        expect(activeFile().text).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
        expectFocusKept(editor);
    });

    it('when Convert to JSON is clicked', async () => {
        const editor = await openAndFocusAsync('feed.xml');

        press(document.querySelector('.editor-toolbar [data-action="convert-to-json"]')!);

        expect(JSON.parse(activeFile().text)).toBeTruthy();
        expectFocusKept(editor);
    });

    it('when the editor bar buttons are clicked', async () => {
        const editor = await openAndFocusAsync('readme.md');
        editor.view.dispatch({ selection: { anchor: 8, head: 12 } });
        const barButton = (command: string): Element => document.querySelector(`.editor-bar-button[data-command="${command}"]`)!;

        press(barButton('bold'));

        expect(activeFile().text).toBe('make it **loud**\n');
        expectFocusKept(editor);

        press(barButton('undo'));

        expect(activeFile()).toMatchObject({ text: 'make it loud\n', dirty: false });
        expectFocusKept(editor);

        press(barButton('redo'));

        expect(activeFile().dirty).toBe(true);
        expectFocusKept(editor);
    });

    it('in the Interactive view', async () => {
        const editor = await openAndFocusAsync('readme.md', false, 'interactive');

        expect(editor.view.dom.getAttribute('data-live-preview')).toBe('true');

        type(editor, '**');
        pressKey(editor.content, 'z', { ctrlKey: true });
        press(document.querySelector('.editor-bar-button[data-command="taskList"]')!);

        expect(activeFile().text).toBe('- [ ] make it loud\n');
        expectFocusKept(editor);
    });
});
