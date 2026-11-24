import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isolateHistory, undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { textOf } from '../../common/fs/testing/fakeFileSystem.js';
import { createAppHarness, openHarnessWorkspaceAsync, tabElement, type AppHarness } from '../testing/appHarness.js';
import { ignoreSelectionChange, settleAsync, toastTexts } from '../testing/testHelpers.js';
import { setFilesSurfaceView } from '../views/filesSurface.js';
import type { OpenFile } from './store.js';

let harness: AppHarness;

beforeEach(() => {
    document.addEventListener('selectionchange', ignoreSelectionChange, true);
    setFilesSurfaceView('editor');
    harness = createAppHarness({
        'windows.txt': 'one\r\ntwo\r\n',
        'unix.txt': 'one\ntwo\n',
        'mixed.txt': 'a\r\nb\r\nc\nd',
        'data.json': '{"name":"nib",\r\n"tags":[1,2]}\r\n',
        'broken.json': '{\r\n"name": \r\n',
        'feed.xml': '<feed>\r\n<item>1</item>\r\n</feed>\r\n',
    });
});

afterEach(() => {
    harness.app.dispose();
    document.body.replaceChildren();
    document.removeEventListener('selectionchange', ignoreSelectionChange, true);
});

async function openInEditorAsync(path: string): Promise<EditorView> {
    await openHarnessWorkspaceAsync(harness);
    await harness.callAsync('openFileAsync', path);

    return EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-content')!)!;
}

// Each call is its own undo step, as typing is after a pause.
function typeAtStart(view: EditorView, text: string): void {
    view.dispatch({ changes: { from: 0, insert: text }, userEvent: 'input.type', annotations: isolateHistory.of('full') });
}

function openFile(path: string): OpenFile {
    const file = harness.state().openFiles.find((item) => item.path === path);

    if (file == null) {
        throw new Error(`${path} is not open`);
    }

    return file;
}

describe('App line endings', () => {
    it('opens a Windows file without marking it unsaved', async () => {
        await openInEditorAsync('windows.txt');

        expect(openFile('windows.txt')).toMatchObject({ dirty: false, lineEnding: '\r\n' });
        expect(tabElement('windows.txt')?.dataset['dirty']).not.toBe('true');
    });

    it('saves an edited Windows file with Windows line endings', async () => {
        const view = await openInEditorAsync('windows.txt');
        typeAtStart(view, 'zero\n');

        await harness.callAsync('saveAsync', 'windows.txt');

        expect(textOf(harness.folder, 'windows.txt')).toBe('zero\r\none\r\ntwo\r\n');
        expect(openFile('windows.txt').dirty).toBe(false);
    });

    it('clears the unsaved mark when an edit to a Windows file is undone', async () => {
        const view = await openInEditorAsync('windows.txt');
        typeAtStart(view, 'x');

        expect(openFile('windows.txt').dirty).toBe(true);

        undo(view);

        expect(openFile('windows.txt').dirty).toBe(false);
        expect(tabElement('windows.txt')?.dataset['dirty']).not.toBe('true');
    });

    it('stays clean after a save when the edits are undone back to the saved text', async () => {
        const view = await openInEditorAsync('windows.txt');
        typeAtStart(view, 'x');
        await harness.callAsync('saveAsync', 'windows.txt');

        typeAtStart(view, 'y');
        undo(view);

        expect(openFile('windows.txt').dirty).toBe(false);
        expect(textOf(harness.folder, 'windows.txt')).toBe('xone\r\ntwo\r\n');
    });

    it('keeps the Unix line endings of a Unix file', async () => {
        const view = await openInEditorAsync('unix.txt');
        typeAtStart(view, 'zero\n');

        await harness.callAsync('saveAsync', 'unix.txt');

        expect(openFile('unix.txt').lineEnding).toBe('\n');
        expect(textOf(harness.folder, 'unix.txt')).toBe('zero\none\ntwo\n');
    });

    it('opens a file with mixed line endings clean and saves it with its most common ending', async () => {
        const view = await openInEditorAsync('mixed.txt');

        expect(openFile('mixed.txt').dirty).toBe(false);

        typeAtStart(view, 'x');
        undo(view);

        expect(openFile('mixed.txt').dirty).toBe(false);

        typeAtStart(view, 'x');
        await harness.callAsync('saveAsync', 'mixed.txt');

        expect(textOf(harness.folder, 'mixed.txt')).toBe('xa\r\nb\r\nc\r\nd');
        expect(openFile('mixed.txt').dirty).toBe(false);
    });

    it('formats a Windows JSON file from the context menu and saves it with Windows line endings', async () => {
        await openHarnessWorkspaceAsync(harness);

        await harness.callAsync('formatJsonFileAsync', 'data.json');

        expect(openFile('data.json').dirty).toBe(true);

        await harness.callAsync('saveAsync', 'data.json');

        expect(textOf(harness.folder, 'data.json')).toBe('{\r\n  "name": "nib",\r\n  "tags": [\r\n    1,\r\n    2\r\n  ]\r\n}');
    });

    it('labels invalid JSON in Format JSON like Format does, with the line and column', async () => {
        await openHarnessWorkspaceAsync(harness);

        await harness.callAsync('formatJsonFileAsync', 'broken.json');
        await settleAsync();

        expect(openFile('broken.json').dirty).toBe(false);
        expect(toastTexts()).toContain('Not valid JSON: Expected a value but found end of input. (line 3, column 1).');
    });

    it('gives the JSON converted from an XML file the line ending of that file', async () => {
        await openHarnessWorkspaceAsync(harness);

        await harness.callAsync('convertXmlToJsonAsync', 'feed.xml');
        await harness.callAsync('saveAsync', 'feed.xml.converted.json');

        expect(openFile('feed.xml.converted.json').lineEnding).toBe('\r\n');
        expect(textOf(harness.folder, 'feed.xml.converted.json')).toContain('{\r\n');
        expect(textOf(harness.folder, 'feed.xml.converted.json')).not.toMatch(/[^\r]\n/);
    });
});
