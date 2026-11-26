import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bytesOf, FakeDirectoryHandle, textOf } from '../../common/fs/testing/fakeFileSystem.js';
import { createAppHarness, openHarnessWorkspaceAsync, tabElement, type AppHarness } from '../testing/appHarness.js';
import { stubClipboard as stubFileClipboard } from '../testing/fakeClipboard.js';
import { settleAsync, toastTexts } from '../testing/testHelpers.js';
import { setFilesSurfaceView } from '../views/filesSurface.js';
import { mountPreview } from '../views/previewPane.js';
import { showDialogAsync, type DialogRequest, type DialogResult } from './dialog.js';
import { isExternalPath, type OpenFile } from './store.js';

vi.mock('./dialog.js', () => ({
    showDialogAsync: vi.fn(),
}));

vi.mock('../views/previewPane.js', () => ({
    mountPreview: vi.fn((pane: HTMLElement) => {
        const element = document.createElement('div');
        element.className = 'preview-frame';
        pane.append(element);

        return { element, update: vi.fn(), destroy: vi.fn() };
    }),
}));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

let harness: AppHarness;

// Queues the answers the stubbed dialogs give, in order; later dialogs cancel.
function answerDialogs(...answers: DialogResult[]): void {
    for (const answer of answers) {
        vi.mocked(showDialogAsync).mockResolvedValueOnce(answer);
    }
}

function dialogRequests(): DialogRequest[] {
    return vi.mocked(showDialogAsync).mock.calls.map(([request]) => request);
}

// Puts one item with these types on the clipboard the app reads.
function stubClipboard(parts: Readonly<Record<string, string | Uint8Array>>): void {
    const item = {
        types: Object.keys(parts),
        getType: async (type: string) => new Blob([parts[type] as BlobPart], { type }),
    };
    vi.stubGlobal('navigator', {
        ...navigator,
        clipboard: { read: async () => (Object.keys(parts).length === 0 ? [] : [item]), readText: async () => '' },
    });
}

function stubRefusedClipboard(): void {
    const refuse = async (): Promise<never> => {
        throw new DOMException('Read permission denied.', 'NotAllowedError');
    };
    vi.stubGlobal('navigator', { ...navigator, clipboard: { read: refuse, readText: refuse } });
}

function menuItems(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('.context-menu[data-open="true"] .context-menu-item')];
}

// The "+" at the end of the tab bar, or Start a compare on the start screen while no workspace or tab is open.
function openNewTabMenu(): void {
    harness.root.querySelector<HTMLButtonElement>('[data-action="new-compare"]')!.click();
}

async function pasteAsync(parts: Readonly<Record<string, string | Uint8Array>>): Promise<OpenFile> {
    stubClipboard(parts);
    openNewTabMenu();
    menuItems().find((item) => item.textContent === 'Paste from clipboard')!.click();
    await settleAsync();

    return activeFile();
}

function activeFile(): OpenFile {
    const state = harness.state();
    const file = state.openFiles.find((candidate) => candidate.path === state.activePath);

    if (file == null) {
        throw new Error('No file tab is active');
    }

    return file;
}

function viewButtons(): string[] {
    return [...document.querySelectorAll<HTMLElement>('.editor-toolbar [data-view]')].map((button) => button.dataset['view'] ?? '');
}

function activeView(): string | undefined {
    return document.querySelector<HTMLElement>('[data-view][data-active="true"]')?.dataset['view'];
}

function pressSave(): void {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
}

beforeEach(async () => {
    vi.mocked(showDialogAsync).mockReset();
    vi.mocked(showDialogAsync).mockResolvedValue({ outcome: 'cancel' });
    vi.mocked(mountPreview).mockClear();
    setFilesSurfaceView('editor');
    harness = createAppHarness({
        'notes.txt': 'one\n',
        'docs/Clipboard.json': '{}\n',
    });
    await openHarnessWorkspaceAsync(harness);
});

afterEach(() => {
    harness.app.dispose();
    vi.unstubAllGlobals();
    // The context menu is made once per page, so it stays for the next test.
    document.body.replaceChildren(...document.querySelectorAll('.context-menu'));
});

describe('Paste from clipboard in the + menu', () => {
    it('follows the compares in a group of its own', () => {
        stubClipboard({ 'text/plain': 'x' });
        openNewTabMenu();

        expect(menuItems().map((item) => item.textContent)).toEqual([
            'Compare text',
            'Compare JSON',
            'Compare YAML',
            'Compare XML',
            'Compare Markdown',
            'Compare tables (CSV/TSV)',
            'Paste from clipboard',
        ]);
        expect(document.querySelectorAll('.context-menu[data-open="true"] .context-menu-separator')).toHaveLength(1);
    });

    it('is left out where the browser has no clipboard to read', () => {
        vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
        openNewTabMenu();

        expect(menuItems().map((item) => item.textContent)).not.toContain('Paste from clipboard');
    });

    it('opens pasted JSON in an unsaved tab, Clipboard.json, with the JSON views', async () => {
        const file = await pasteAsync({ 'text/plain': '{"name":"nib"}' });

        expect(isExternalPath(file.path)).toBe(true);
        expect(file).toMatchObject({ text: '{"name":"nib"}', dirty: true, external: { handle: null, pasted: true } });
        expect(tabElement(file.path)?.querySelector('.tab-name')?.textContent).toBe('Clipboard.json');
        expect(tabElement(file.path)?.dataset['dirty']).toBe('true');
        expect(viewButtons()).toEqual(['editor', 'tree', 'jsonpath', 'schema']);
        expect(harness.state().activeSurface).toBe('files');
    });

    it('marks a pasted tab as pasted rather than as a file from outside the workspace', async () => {
        const file = await pasteAsync({ 'text/plain': 'plain words' });
        const tab = tabElement(file.path)!;

        expect(tab.querySelector('.tab-external')).toBeNull();
        expect(tab.dataset['pasted']).toBe('true');
        expect(tab.title).toBe('Clipboard.txt, pasted from the clipboard. Save asks where to save it.');
    });

    it('numbers the next paste and shows CSV as a table', async () => {
        await pasteAsync({ 'text/plain': '{"name":"nib"}' });
        const file = await pasteAsync({ 'text/plain': 'name,age\nAnn,31\nBob,42\n' });

        expect(tabElement(file.path)?.querySelector('.tab-name')?.textContent).toBe('Clipboard 2.csv');
        await vi.waitFor(() => expect(document.querySelector('.table-search')).not.toBeNull());
    });

    it('opens Markdown in Preview, as a Markdown file opens, and plain text in Editor', async () => {
        const markdown = await pasteAsync({ 'text/plain': '# Notes\n\n- one\n- two\n' });

        expect(tabElement(markdown.path)?.querySelector('.tab-name')?.textContent).toBe('Clipboard.md');
        expect(activeView()).toBe('preview');

        const text = await pasteAsync({ 'text/plain': 'Just a note to self.' });

        expect(tabElement(text.path)?.querySelector('.tab-name')?.textContent).toBe('Clipboard 2.txt');
        expect(activeView()).toBe('editor');
    });

    it('opens a pasted picture in the image preview', async () => {
        const file = await pasteAsync({ 'image/png': PNG });

        expect(tabElement(file.path)?.querySelector('.tab-name')?.textContent).toBe('Clipboard.png');
        expect(file.dirty).toBe(true);
        expect(vi.mocked(mountPreview)).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({ kind: 'image', fileName: 'Clipboard.png', file: file.file }),
        );
    });

    it('says the clipboard is empty, and opens nothing', async () => {
        stubClipboard({});
        openNewTabMenu();
        menuItems().find((item) => item.textContent === 'Paste from clipboard')!.click();
        await settleAsync();

        expect(toastTexts()).toContain('The clipboard is empty.');
        expect(harness.state().openFiles).toEqual([]);
    });

    it('says when the browser was not allowed to read the clipboard', async () => {
        stubRefusedClipboard();

        await harness.callAsync('pasteFromClipboardAsync');

        expect(toastTexts()).toContain('Nib Studio was not allowed to read the clipboard.');
        expect(harness.state().openFiles).toEqual([]);
    });

    it('says when the clipboard holds nothing it can paste', async () => {
        stubClipboard({ 'text/html': '<b>bold</b>' });

        await harness.callAsync('pasteFromClipboardAsync');

        expect(toastTexts()).toContain('The clipboard holds no text or picture to paste.');
    });

    it('asks before closing a pasted tab, as for any unsaved file', async () => {
        const file = await pasteAsync({ 'text/plain': 'keep me' });

        await harness.callAsync('closeFileAsync', file.path);

        expect(dialogRequests()[0]).toMatchObject({ title: 'Discard unsaved changes' });
        expect(harness.state().openFiles).toHaveLength(1);
    });

    it('stays open when the workspace is forgotten, as it belongs to no folder', async () => {
        const file = await pasteAsync({ 'text/plain': 'keep me' });

        expect(await harness.callAsync('settleUnsavedBeforeWorkspaceChangeAsync')).toBe(true);
        expect((await harness.callAsync<{ openFiles: OpenFile[] }>('tabsOutsideWorkspace')).openFiles.map((open) => open.path))
            .toEqual([file.path]);
    });
});

describe('Saving a pasted tab', () => {
    it('asks for a name at the workspace root and turns the tab into that file\'s tab', async () => {
        const file = await pasteAsync({ 'text/plain': 'name,age\r\nAnn,31\r\n' });
        answerDialogs({ outcome: 'input', value: 'people.csv' });

        expect(await harness.callAsync('saveAsync', file.path)).toBe(true);

        const request = dialogRequests()[0]!;
        expect(request).toMatchObject({ title: 'Save Clipboard.csv', body: 'Will be saved at the workspace root.' });
        expect(request.kind).toMatchObject({ kind: 'input', initialValue: 'Clipboard.csv' });
        expect(textOf(harness.folder, 'people.csv')).toBe('name,age\r\nAnn,31\r\n');
        expect(harness.state().activePath).toBe('people.csv');
        expect(activeFile()).toMatchObject({ path: 'people.csv', dirty: false, originalText: 'name,age\nAnn,31\n' });
        expect(activeFile().external).toBeUndefined();
        expect(activeFile().file?.name).toBe('people.csv');
        expect(toastTexts()).toContain('people.csv saved.');
        expect(document.querySelector('.tree-row[data-path="people.csv"]')).not.toBeNull();
        expect(tabElement('people.csv')?.title).toBe('people.csv');
    });

    it('saves into the folder selected in the Explorer, suggesting a name no entry takes', async () => {
        await harness.callAsync('selectInTree', 'docs');
        const file = await pasteAsync({ 'text/plain': '{"a":1}' });
        answerDialogs({ outcome: 'input', value: 'Clipboard 2.json' });

        await harness.callAsync('saveAsync', file.path);

        const request = dialogRequests()[0]!;
        const validate = request.kind.kind === 'input' ? request.kind.validate : undefined;
        expect(request.body).toBe('Will be saved in docs/');
        expect(request.kind).toMatchObject({ initialValue: 'Clipboard 2.json' });
        expect(validate?.('clipboard.json')).toBe('A file named Clipboard.json already exists.');
        expect(validate?.('a/b.json')).toBe('Name cannot contain slashes.');
        expect(textOf(harness.folder, 'docs/Clipboard 2.json')).toBe('{"a":1}');
        expect(harness.state().activePath).toBe('docs/Clipboard 2.json');
    });

    it('saves a picture\'s bytes, and the tab becomes the picture file\'s', async () => {
        const file = await pasteAsync({ 'image/png': PNG });
        answerDialogs({ outcome: 'input', value: 'Clipboard.png' });

        expect(await harness.callAsync('saveAsync', file.path)).toBe(true);

        expect(bytesOf(harness.folder, 'Clipboard.png')).toEqual([...PNG]);
        expect(activeFile()).toMatchObject({ path: 'Clipboard.png', dirty: false });
        expect(activeFile().external).toBeUndefined();
    });

    it('asks the same on Ctrl+S, in a table too, where there is no Save button', async () => {
        await pasteAsync({ 'text/plain': 'a\tb\n1\t2\n' });

        pressSave();
        await settleAsync();

        expect(dialogRequests()[0]).toMatchObject({ title: 'Save Clipboard.tsv' });
    });

    it('offers Save… in the context menu of a pasted tab only', async () => {
        await harness.callAsync('openFileAsync', 'notes.txt');
        const file = await pasteAsync({ 'image/png': PNG });
        const labels = (path: string): string[] => {
            void harness.callAsync('showTabContextMenu', new MouseEvent('contextmenu'), path);

            return menuItems().map((item) => item.textContent ?? '');
        };

        expect(labels(file.path)[0]).toBe('Save…');
        expect(labels('notes.txt')).not.toContain('Save…');
    });

    it('leaves out the tab commands for a file on disk, which a paste isn\'t yet', async () => {
        const file = await pasteAsync({ 'text/plain': '{"a":1}' });
        void harness.callAsync('showTabContextMenu', new MouseEvent('contextmenu'), file.path);
        const labels = menuItems().map((item) => item.textContent ?? '');

        expect(labels).toEqual(expect.arrayContaining(['Save…', '  Compare with clipboard', 'Copy name to clipboard', 'Format JSON']));
        expect(labels).not.toContain('Reveal in Explorer');
        expect(labels).not.toContain('Copy path to clipboard');
        expect(labels).not.toContain('Convert JSON to YAML');
    });

    it('copies a pasted tab\'s text as it is now from Copy content to clipboard and the toolbar', async () => {
        const file = await pasteAsync({ 'text/plain': '{"a":1}' });
        await harness.callAsync('markChange', file.path, '{"a":2}');
        const copied: string[] = [];
        const writeText = async (text: string): Promise<void> => {
            copied.push(text);
        };
        vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

        void harness.callAsync('showTabContextMenu', new MouseEvent('contextmenu'), file.path);
        menuItems().find((item) => item.textContent === 'Copy content to clipboard')!.click();
        await settleAsync();
        [...document.querySelectorAll<HTMLButtonElement>('.editor-toolbar .copy-action')].find((button) => button.textContent === 'Copy raw')!.click();
        await settleAsync();

        expect(copied).toEqual(['{"a":2}', '{"a":2}']);
    });

    it('copies a pasted table as shown, and gives a pasted picture none of the copy buttons', async () => {
        const table = await pasteAsync({ 'text/plain': 'name\tage\nAda\t36\nAlan\t41\n' });
        const clipboard = stubFileClipboard();

        try {
            await settleAsync();
            harness.root.querySelector<HTMLElement>('.table-view th[data-column-id="col-1"]')!.click();
            harness.root.querySelector<HTMLElement>('.table-view th[data-column-id="col-1"]')!.click();
            [...harness.root.querySelectorAll<HTMLButtonElement>('.editor-toolbar .copy-action')]
                .find((button) => button.textContent === 'Copy formatted')!.click();
            await settleAsync();

            expect(table.path).toMatch(/Clipboard\.tsv$/);
            expect(clipboard.last().get('text/plain')).toBe('name\tage\nAlan\t41\nAda\t36');
            expect(clipboard.last().get('text/html')).toContain('<td>Alan</td>');
            expect(toastTexts()).toContain('2 rows copied.');

            await pasteAsync({ 'image/png': PNG });

            expect(harness.root.querySelector('.copy-action, .copy-menu-button')).toBeNull();
        }
        finally {
            clipboard.restore();
        }
    });

    it('numbers the next paste after a saved paste still open, so no two tabs share a name', async () => {
        const first = await pasteAsync({ 'text/plain': '{"a":1}' });
        answerDialogs({ outcome: 'input', value: 'Clipboard.json' });
        await harness.callAsync('saveAsync', first.path);

        const second = await pasteAsync({ 'text/plain': '{"b":2}' });

        expect(tabElement(second.path)?.querySelector('.tab-name')?.textContent).toBe('Clipboard 2.json');
    });

    it('keeps the tab as it is when the name is not given', async () => {
        const file = await pasteAsync({ 'text/plain': 'draft' });

        expect(await harness.callAsync('saveAsync', file.path)).toBe(false);

        expect(activeFile()).toMatchObject({ path: file.path, dirty: true, external: { handle: null, pasted: true } });
        expect(harness.folder.children.has('Clipboard.txt')).toBe(false);
    });

    it('with no workspace open, asks where to save it in the browser\'s save dialog', async () => {
        harness.store.update({ workspace: null, tree: null });
        const saved = new FakeDirectoryHandle('downloads').addFile('Clipboard.json', '');
        const picker = vi.fn(async () => saved);
        vi.stubGlobal('showSaveFilePicker', picker);
        const file = await pasteAsync({ 'text/plain': '{"a":1}' });
        answerDialogs({ outcome: 'yes' });

        expect(await harness.callAsync('saveAsync', file.path)).toBe(true);

        expect(dialogRequests()[0]).toMatchObject({
            title: 'Save as',
            body: 'No workspace is open, so choose where to save Clipboard.json.',
        });
        expect(picker).toHaveBeenCalledWith({ suggestedName: 'Clipboard.json' });
        expect(saved.text).toBe('{"a":1}');
        expect(activeFile()).toMatchObject({ dirty: false, external: { handle: saved } });
        expect(activeFile().external?.pasted).toBeUndefined();
    });
});
