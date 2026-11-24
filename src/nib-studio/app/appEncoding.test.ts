import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { bytesOf, textOf } from '../../common/fs/testing/fakeFileSystem.js';
import { createAppHarness, markChange, openHarnessWorkspaceAsync, type AppHarness } from '../testing/appHarness.js';
import { clickDialogButton, ignoreSelectionChange, settleAsync } from '../testing/testHelpers.js';
import { setFilesSurfaceView } from '../views/filesSurface.js';
import type { OpenFile } from './store.js';

// `Καλημέρα\r\nΚόσμε\r\n` in Windows-1253, as an older Greek Windows program saves it.
const GREEK_1253 = Uint8Array.of(0xca, 0xe1, 0xeb, 0xe7, 0xec, 0xdd, 0xf1, 0xe1, 0x0d, 0x0a, 0xca, 0xfc, 0xf3, 0xec, 0xe5, 0x0d, 0x0a);

let harness: AppHarness;

beforeEach(async () => {
    document.addEventListener('selectionchange', ignoreSelectionChange, true);
    setFilesSurfaceView('editor');
    harness = createAppHarness({
        'old notes.txt': GREEK_1253,
        'NOTES': GREEK_1253,
        'plain.txt': 'plain\n',
    });
    await openHarnessWorkspaceAsync(harness);
});

afterEach(() => {
    harness.app.dispose();
    document.body.replaceChildren();
    document.removeEventListener('selectionchange', ignoreSelectionChange, true);
});

function openFile(path: string): OpenFile {
    const file = harness.state().openFiles.find((item) => item.path === path);

    if (file == null) {
        throw new Error(`${path} is not open`);
    }

    return file;
}

function editorText(): string {
    return EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-content')!)!.state.doc.toString();
}

function statusItems(): string[] {
    return [...document.querySelectorAll('.status-item')].map((item) => item.textContent ?? '');
}

describe('App text encodings', () => {
    it('opens Greek text in Windows-1253 as Greek, clean, and names the encoding in the status bar', async () => {
        await harness.callAsync('openFileAsync', 'old notes.txt');

        expect(editorText()).toBe('Καλημέρα\nΚόσμε\n');
        expect(openFile('old notes.txt')).toMatchObject({ dirty: false, encoding: 'windows-1253', lineEnding: '\r\n' });
        expect(statusItems()).toContain('Windows-1253');
    });

    it('opens a file of no known type in Windows-1253 as text, not as a file that isn\'t text', async () => {
        await harness.callAsync('openFileAsync', 'NOTES');

        expect(openFile('NOTES').binary).toBeUndefined();
        expect(editorText()).toBe('Καλημέρα\nΚόσμε\n');
    });

    it('says UTF-8 for a UTF-8 file', async () => {
        await harness.callAsync('openFileAsync', 'plain.txt');

        expect(statusItems()).toContain('UTF-8');
    });

    it('saves an edit back in Windows-1253, with the file\'s line endings', async () => {
        await harness.callAsync('openFileAsync', 'old notes.txt');
        markChange(harness, 'old notes.txt', 'Καλημέρα\nΚόσμε\nΤέλος\n');

        await harness.callAsync('saveAsync', 'old notes.txt');

        expect(bytesOf(harness.folder, 'old notes.txt')).toEqual([...GREEK_1253, 0xd4, 0xdd, 0xeb, 0xef, 0xf2, 0x0d, 0x0a]);
        expect(openFile('old notes.txt')).toMatchObject({ dirty: false, encoding: 'windows-1253' });
    });

    it('offers UTF-8 for characters Windows-1253 can\'t hold, and saves as UTF-8 when asked', async () => {
        await harness.callAsync('openFileAsync', 'old notes.txt');
        markChange(harness, 'old notes.txt', 'Καλημέρα ü €\n');

        const saving = harness.callAsync<boolean>('saveAsync', 'old notes.txt');
        await settleAsync();

        expect(document.querySelector('.modal')?.textContent).toContain('old notes.txt is in Windows-1253, which can\'t hold ü.');
        clickDialogButton('Save as UTF-8');

        expect(await saving).toBe(true);
        expect(textOf(harness.folder, 'old notes.txt')).toBe('Καλημέρα ü €\r\n');
        expect(openFile('old notes.txt')).toMatchObject({ dirty: false, encoding: 'utf-8' });
        expect(statusItems()).toContain('UTF-8');
    });

    it('writes nothing, and keeps the edit, when saving as UTF-8 is turned down', async () => {
        await harness.callAsync('openFileAsync', 'old notes.txt');
        markChange(harness, 'old notes.txt', 'ü\n');

        const saving = harness.callAsync<boolean>('saveAsync', 'old notes.txt');
        await settleAsync();
        clickDialogButton('Cancel');

        expect(await saving).toBe(false);
        expect(bytesOf(harness.folder, 'old notes.txt')).toEqual([...GREEK_1253]);
        expect(openFile('old notes.txt')).toMatchObject({ dirty: true, encoding: 'windows-1253' });
    });
});
