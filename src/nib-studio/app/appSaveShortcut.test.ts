import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { textOf, type FakeFileHandle } from '../../common/fs/testing/fakeFileSystem.js';
import { buildTinyXlsx } from '../../common/office/testing/encryptionFixtures.js';
import { createAppHarness, openHarnessWorkspaceAsync, type AppHarness } from '../testing/appHarness.js';
import { ignoreSelectionChange, settleAsync } from '../testing/testHelpers.js';
import { setFilesSurfaceView } from '../views/filesSurface.js';

let harness: AppHarness;

beforeEach(() => {
    document.addEventListener('selectionchange', ignoreSelectionChange, true);
    setFilesSurfaceView('editor');
    harness = createAppHarness({
        'data.json': '{"name":"nib"}\n',
        'feed.xml': '<feed><item>1</item></feed>\n',
        'users.csv': 'id,name\r\n1,Anna\r\n',
        'sales.xlsx': buildTinyXlsx([['region', 'total'], ['North', 1250]]),
    });
});

afterEach(() => {
    harness.app.dispose();
    document.body.replaceChildren();
    document.removeEventListener('selectionchange', ignoreSelectionChange, true);
});

async function openAndEditAsync(path: string): Promise<void> {
    await openHarnessWorkspaceAsync(harness);
    await harness.callAsync('openFileAsync', path);
    const view = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-content')!)!;
    view.dispatch({ changes: { from: 0, insert: ' ' }, userEvent: 'input.type' });
}

function switchView(view: string): void {
    document.querySelector<HTMLElement>(`[data-view="${view}"]`)!.click();
}

function pressSave(): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);

    return event;
}

describe('Ctrl+S outside the editor', () => {
    it('saves the file from its Tree view, as the Save button does', async () => {
        await openAndEditAsync('data.json');
        switchView('tree');

        const event = pressSave();
        await settleAsync();

        expect(event.defaultPrevented).toBe(true);
        expect(textOf(harness.folder, 'data.json')).toBe(' {"name":"nib"}\n');
        expect(harness.state().openFiles.find((file) => file.path === 'data.json')?.dirty).toBe(false);
    });

    it('writes nothing from a view whose Save button is off, such as As JSON', async () => {
        await openAndEditAsync('feed.xml');
        switchView('as-json');
        const handle = harness.folder.find('feed.xml') as FakeFileHandle;

        pressSave();
        await settleAsync();

        expect(handle.writeCount).toBe(0);
        expect(harness.state().openFiles.find((file) => file.path === 'feed.xml')?.dirty).toBe(true);
    });

    it('writes nothing from a table, a CSV file or a workbook, which is view only', async () => {
        await openHarnessWorkspaceAsync(harness);

        for (const path of ['users.csv', 'sales.xlsx']) {
            await harness.callAsync('openFileAsync', path);
            const handle = harness.folder.find(path) as FakeFileHandle;

            const event = pressSave();
            await settleAsync();

            expect(event.defaultPrevented).toBe(true);
            expect(handle.writeCount).toBe(0);
        }
    });
});
