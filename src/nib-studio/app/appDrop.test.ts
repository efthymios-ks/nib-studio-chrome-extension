import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bytesOf, FakeDirectoryHandle, FakeFileHandle, textOf } from '../../common/fs/testing/fakeFileSystem.js';
import { addWorkspaceAsync } from '../../common/fs/workspaceRegistry.js';
import { WORKSPACE_CONFIG_PATH } from '../../common/fs/workspaceConfig.js';
import { INTERNAL_MIME } from '../explorer/dragDrop.js';
import {
    createAppHarness,
    markChange,
    openHarnessWorkspaceAsync,
    openPaths,
    tabElement,
    treeRow,
    type AppHarness,
} from '../testing/appHarness.js';
import {
    dragEvent,
    dropFixtures,
    fakeDataTransfer,
    type DroppedFixture,
    type FakeDataTransferOptions,
} from '../testing/fakeDataTransfer.js';
import { settleAsync, toastTexts } from '../testing/testHelpers.js';
import { showDialogAsync, type DialogRequest, type DialogResult } from './dialog.js';
import { isExternalPath, type OpenFile } from './store.js';

vi.mock('./dialog.js', () => ({
    showDialogAsync: vi.fn(),
}));

vi.mock('../../common/fs/workspaceRegistry.js', () => ({
    addWorkspaceAsync: vi.fn(),
    findWorkspaceAsync: vi.fn(async () => null),
    getActiveWorkspaceAsync: vi.fn(async () => null),
    listWorkspacesAsync: vi.fn(async () => []),
    removeWorkspaceAsync: vi.fn(),
    setActiveWorkspaceAsync: vi.fn(),
}));

const BINARY = new Uint8Array([0, 255, 128, 10, 13, 0xc3, 0x28, 7]);

let harness: AppHarness;
let desktop: FakeDirectoryHandle;

function photosWorkspace(photos: FakeDirectoryHandle): { id: string; name: string; handle: FileSystemDirectoryHandle } {
    return { id: 'w2', name: 'photos', handle: photos as unknown as FileSystemDirectoryHandle };
}

function createDesktop(): FakeDirectoryHandle {
    const folder = new FakeDirectoryHandle('desktop');
    folder.addFile('notes.txt', 'notes from the desktop\n');
    folder.addFile('a.txt', 'desktop alpha\n');
    folder.addFile('photo.bin', BINARY);
    folder.addFile('photos/x.png', BINARY);
    folder.addFile('photos/raw/y.raw', 'raw');
    folder.addFile('docs/readme.md', '# Desktop readme\n');
    folder.addFile('docs/new.md', 'new\n');

    return folder;
}

function onDesktop(path: string): FakeFileHandle | FakeDirectoryHandle {
    const entry = desktop.find(path);

    if (entry == null) {
        throw new Error(`No ${path} on the desktop`);
    }

    return entry;
}

function main(): HTMLElement {
    return document.querySelector<HTMLElement>('#studio-main')!;
}

function tree(): HTMLElement {
    return document.querySelector<HTMLElement>('.tree')!;
}

function sidebar(): HTMLElement {
    return document.querySelector<HTMLElement>('.sidebar')!;
}

async function dropAsync(
    target: EventTarget,
    dropped: ReadonlyArray<DroppedFixture>,
    options: FakeDataTransferOptions = {},
): Promise<Event> {
    const transfer = fakeDataTransfer(dropped, options);
    target.dispatchEvent(dragEvent('dragenter', transfer.transfer));
    target.dispatchEvent(dragEvent('dragover', transfer.transfer));
    const event = dragEvent('drop', transfer.transfer);
    target.dispatchEvent(event);
    transfer.end();
    await settleAsync();

    return event;
}

// Queues the answers the stubbed dialogs give, in order; later dialogs cancel.
function answerDialogs(...answers: DialogResult[]): void {
    for (const answer of answers) {
        vi.mocked(showDialogAsync).mockResolvedValueOnce(answer);
    }
}

function dialogRequests(): DialogRequest[] {
    return vi.mocked(showDialogAsync).mock.calls.map(([request]) => request);
}

function openFile(index = 0): OpenFile {
    const file = harness.state().openFiles[index];

    if (file == null) {
        throw new Error(`No open file at ${index}`);
    }

    return file;
}

function hints(): Record<string, string | undefined> {
    return {
        open: main().dataset['dropHint'],
        importHint: sidebar().dataset['dropHint'],
    };
}

const CLEARED = { open: undefined, importHint: undefined };

beforeEach(() => {
    vi.mocked(showDialogAsync).mockReset();
    vi.mocked(showDialogAsync).mockResolvedValue({ outcome: 'cancel' });
    vi.mocked(addWorkspaceAsync).mockReset();
    harness = createAppHarness({
        'a.txt': 'alpha\n',
        'b.txt': 'bravo\n',
        'docs/readme.md': '# Readme\n',
        'docs/a.txt': 'docs alpha\n',
    });
    desktop = createDesktop();
});

afterEach(() => {
    harness.app.dispose();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
});

describe('App opening files dropped from the computer', () => {
    it('opens a file from outside the workspace in a tab of its own, without importing it', async () => {
        await openHarnessWorkspaceAsync(harness);

        await dropAsync(main(), [onDesktop('notes.txt')]);

        const file = openFile();
        expect(isExternalPath(file.path)).toBe(true);
        expect(file).toMatchObject({ text: 'notes from the desktop\n', preview: false, dirty: false });
        expect(file.external?.handle).toBe(onDesktop('notes.txt'));
        expect(harness.state().activePath).toBe(file.path);
        expect(harness.folder.find('notes.txt')).toBeNull();
        expect(showDialogAsync).not.toHaveBeenCalled();
        expect(toastTexts()).toContain('Opened notes.txt from outside the workspace.');
    });

    it('shows the file name with an outside-the-workspace marker and tooltip on its tab', async () => {
        await openHarnessWorkspaceAsync(harness);

        await dropAsync(main(), [onDesktop('notes.txt')]);

        const tab = tabElement(openFile().path)!;
        expect(tab.querySelector('.tab-name')?.textContent).toBe('notes.txt');
        expect(tab.dataset['external']).toBe('true');
        expect(tab.querySelector('.tab-external')?.getAttribute('aria-label')).toBe('Outside the workspace');
        expect(tab.title).toBe('notes.txt, outside the workspace. Save writes back to this file.');
    });

    it('saves an outside file back to its own file after asking for write access, never into the workspace', async () => {
        await openHarnessWorkspaceAsync(harness);
        const original = onDesktop('notes.txt') as FakeFileHandle;
        original.permission = 'prompt';
        await dropAsync(main(), [original]);
        const path = openFile().path;
        markChange(harness, path, 'edited\n');

        await harness.callAsync('saveAsync', path);

        expect(original.text).toBe('edited\n');
        expect(original.permissionRequests).toEqual(['readwrite']);
        expect(openFile()).toMatchObject({ path, dirty: false, originalText: 'edited\n' });
        expect([...harness.folder.children.keys()].sort()).toEqual(['a.txt', 'b.txt', 'docs']);
        expect(toastTexts()).toContain('notes.txt saved.');
    });

    it('keeps the Windows line endings of an outside file, clean until edited and again once undone', async () => {
        await openHarnessWorkspaceAsync(harness);
        const original = desktop.addFile('windows.txt', 'from windows\r\nsecond line\r\n');
        await dropAsync(main(), [original]);
        const path = openFile().path;

        expect(openFile()).toMatchObject({ dirty: false, lineEnding: '\r\n' });

        markChange(harness, path, 'edited\nsecond line\n');

        expect(openFile().dirty).toBe(true);

        markChange(harness, path, 'from windows\nsecond line\n');

        expect(openFile().dirty).toBe(false);

        markChange(harness, path, 'edited\nsecond line\n');
        await harness.callAsync('saveAsync', path);

        expect(original.text).toBe('edited\r\nsecond line\r\n');
        expect(openFile().dirty).toBe(false);
    });

    it('names an outside file by its name when asking to discard its edits', async () => {
        await openHarnessWorkspaceAsync(harness);
        await dropAsync(main(), [onDesktop('notes.txt')]);
        const path = openFile().path;
        markChange(harness, path, 'edited\n');
        await harness.callAsync('openFileAsync', 'a.txt');

        await harness.callAsync('closeFileAsync', path);
        await harness.callAsync('closeOthersAsync', 'a.txt');

        expect(dialogRequests().map((request) => request.paths)).toEqual([
            [{ label: 'File', path: 'notes.txt' }],
            [{ label: 'Unsaved', path: 'notes.txt' }],
        ]);
    });

    it('keeps the edits unsaved when write access is refused', async () => {
        await openHarnessWorkspaceAsync(harness);
        const original = onDesktop('notes.txt') as FakeFileHandle;
        original.permission = 'denied';
        await dropAsync(main(), [original]);
        const path = openFile().path;
        markChange(harness, path, 'edited\n');

        await harness.callAsync('saveAsync', path);

        expect(original.text).toBe('notes from the desktop\n');
        expect(openFile().dirty).toBe(true);
        expect(toastTexts()).toContain('Nib Studio was not allowed to save notes.txt.');
    });

    it('keeps a dropped file apart from the workspace file with the same name', async () => {
        await openHarnessWorkspaceAsync(harness);

        await dropAsync(main(), [onDesktop('a.txt')]);
        await harness.callAsync('openFileAsync', 'a.txt');
        const external = openFile(0);
        markChange(harness, external.path, 'desktop edit\n');
        await harness.callAsync('saveAsync', external.path);

        expect(openFile(0)).toMatchObject({ text: 'desktop edit\n', external: { handle: onDesktop('a.txt') } });
        expect(openFile(1)).toMatchObject({ path: 'a.txt', text: 'alpha\n' });
        expect(textOf(harness.folder, 'a.txt')).toBe('alpha\n');
        expect(textOf(desktop, 'a.txt')).toBe('desktop edit\n');
    });

    it('opens a dropped file that lives in the workspace as that workspace file, revealed in the tree', async () => {
        await openHarnessWorkspaceAsync(harness);

        await dropAsync(main(), [harness.folder.find('docs/readme.md')!]);

        expect(openPaths(harness)).toEqual(['docs/readme.md']);
        expect(openFile()).toMatchObject({ preview: false, text: '# Readme\n' });
        expect(openFile().external).toBeUndefined();
        expect(harness.state().expandedPaths.has('docs')).toBe(true);
        expect(treeRow('docs/readme.md')).toBeDefined();
    });

    it('activates the tab of an outside file dropped again instead of opening it twice', async () => {
        await openHarnessWorkspaceAsync(harness);

        await dropAsync(main(), [onDesktop('notes.txt')]);
        await dropAsync(main(), [onDesktop('a.txt')]);
        await dropAsync(main(), [onDesktop('notes.txt')]);

        expect(harness.state().openFiles).toHaveLength(2);
        expect(harness.state().activePath).toBe(openFile(0).path);
    });

    it('opens every file dropped at once', async () => {
        await openHarnessWorkspaceAsync(harness);

        await dropAsync(main(), [onDesktop('notes.txt'), harness.folder.find('b.txt')!, onDesktop('photo.bin')]);

        expect(harness.state().openFiles.map((file) => [isExternalPath(file.path), file.path.split('/').pop()])).toEqual([
            [true, 'notes.txt'],
            [false, 'b.txt'],
            [true, 'photo.bin'],
        ]);
    });

    it('opens files dropped on the header or the status bar instead of importing them', async () => {
        await openHarnessWorkspaceAsync(harness);

        await dropAsync(document.querySelector('.app-header')!, [onDesktop('notes.txt')]);
        await dropAsync(document.querySelector('.status-bar')!, [onDesktop('a.txt')]);

        expect(harness.state().openFiles.every((file) => file.external != null)).toBe(true);
        expect(harness.state().openFiles).toHaveLength(2);
        expect(harness.folder.find('notes.txt')).toBeNull();
        expect(showDialogAsync).not.toHaveBeenCalled();
    });

    it('opens and saves an outside file with no workspace open', async () => {
        await dropAsync(main(), [onDesktop('notes.txt')]);
        const path = openFile().path;
        markChange(harness, path, 'no workspace\n');

        await harness.callAsync('saveAsync', path);

        expect(tabElement(path)).not.toBeNull();
        expect(textOf(desktop, 'notes.txt')).toBe('no workspace\n');
    });

    it('opens files dropped on the tree when no workspace is open', async () => {
        await dropAsync(tree(), [onDesktop('notes.txt')]);

        expect(openFile().external).toBeDefined();
        expect(showDialogAsync).not.toHaveBeenCalled();
    });

    it('leaves outside files out of the workspace configuration', async () => {
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'b.txt');
        await dropAsync(main(), [onDesktop('notes.txt')]);

        await harness.callAsync('flushConfigAsync');

        const config = JSON.parse(textOf(harness.folder, WORKSPACE_CONFIG_PATH)) as {
            openFiles: string[];
            activePath: string | null;
        };
        expect(config.openFiles).toEqual(['b.txt']);
        expect(config.activePath).toBeNull();
    });

    it('opens a large outside CSV as a streamed table', async () => {
        await openHarnessWorkspaceAsync(harness);
        const rows = 'a,b\n'.repeat(600_000);
        desktop.addFile('big.csv', rows);

        await dropAsync(main(), [onDesktop('big.csv')]);

        expect(openFile()).toMatchObject({ large: true, text: '' });
        expect(openFile().file?.size).toBe(rows.length);
    });

    it('does not paste a file dropped on the open editor into it', async () => {
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'a.txt');
        const content = document.querySelector('.cm-content');
        expect(content).not.toBeNull();
        // CodeMirror skips its own drop handling, which pastes the file's text, for a drop already handled.
        const handledBeforeEditor: boolean[] = [];
        content!.addEventListener('drop', (event) => handledBeforeEditor.push(event.defaultPrevented));

        await dropAsync(content!, [onDesktop('notes.txt')]);

        expect(handledBeforeEditor).toEqual([true]);
        expect(openFile(0)).toMatchObject({ path: 'a.txt', text: 'alpha\n', dirty: false });
        expect(openFile(1).external).toBeDefined();
    });
});

describe('App outside files without a handle', () => {
    it('opens a dropped file the browser gives no handle for', async () => {
        await openHarnessWorkspaceAsync(harness);

        await dropAsync(main(), [onDesktop('notes.txt')], { handles: false });

        expect(openFile()).toMatchObject({ text: 'notes from the desktop\n', external: { handle: null } });
        expect(tabElement(openFile().path)?.title).toBe('notes.txt, outside the workspace. Save asks where to save it.');
    });

    it('saves through Save as to the picked file, which later saves go to as well', async () => {
        await openHarnessWorkspaceAsync(harness);
        const saved = new FakeDirectoryHandle('downloads').addFile('notes copy.txt', '');
        const picker = vi.fn(async () => saved);
        vi.stubGlobal('showSaveFilePicker', picker);
        await dropAsync(main(), [onDesktop('notes.txt')], { handles: false });
        const path = openFile().path;
        markChange(harness, path, 'saved as\n');
        answerDialogs({ outcome: 'yes' });

        await harness.callAsync('saveAsync', path);

        expect(dialogRequests()[0]).toMatchObject({ title: 'Save as' });
        expect(picker).toHaveBeenCalledWith({ suggestedName: 'notes.txt' });
        expect(saved.text).toBe('saved as\n');
        expect(openFile()).toMatchObject({ dirty: false, external: { handle: saved } });
        expect(openFile().path.endsWith('/notes copy.txt')).toBe(true);
        expect(textOf(desktop, 'notes.txt')).toBe('notes from the desktop\n');
        expect([...harness.folder.children.keys()].sort()).toEqual(['a.txt', 'b.txt', 'docs']);

        markChange(harness, openFile().path, 'second save\n');
        await harness.callAsync('saveAsync', openFile().path);

        expect(saved.text).toBe('second save\n');
        expect(picker).toHaveBeenCalledOnce();
    });

    it('keeps the Windows line endings of a file saved through Save as', async () => {
        await openHarnessWorkspaceAsync(harness);
        const saved = new FakeDirectoryHandle('downloads').addFile('windows.txt', '');
        vi.stubGlobal('showSaveFilePicker', vi.fn(async () => saved));
        await dropAsync(main(), [desktop.addFile('windows.txt', 'one\r\ntwo\r\n')], { handles: false });
        const path = openFile().path;
        markChange(harness, path, 'one\ntwo\nthree\n');
        answerDialogs({ outcome: 'yes' });

        await harness.callAsync('saveAsync', path);

        expect(saved.text).toBe('one\r\ntwo\r\nthree\r\n');
        expect(openFile().dirty).toBe(false);
    });

    it('writes nothing anywhere when Save as is declined', async () => {
        await openHarnessWorkspaceAsync(harness);
        const picker = vi.fn();
        vi.stubGlobal('showSaveFilePicker', picker);
        await dropAsync(main(), [onDesktop('notes.txt')], { handles: false });
        const path = openFile().path;
        markChange(harness, path, 'edited\n');

        await harness.callAsync('saveAsync', path);

        expect(picker).not.toHaveBeenCalled();
        expect(openFile().dirty).toBe(true);
        expect([...harness.folder.children.keys()].sort()).toEqual(['a.txt', 'b.txt', 'docs']);
    });

    it('reads a dropped folder through its entry and imports it into the tree', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'yes' });

        await dropAsync(tree(), [onDesktop('photos')], { handles: false });

        expect(bytesOf(harness.folder, 'photos/x.png')).toEqual([...BINARY]);
        expect(textOf(harness.folder, 'photos/raw/y.raw')).toBe('raw');
    });

    it('explains that a dropped folder without a handle cannot become the workspace', async () => {
        await openHarnessWorkspaceAsync(harness);

        await dropAsync(main(), [onDesktop('photos')], { handles: false });

        expect(showDialogAsync).not.toHaveBeenCalled();
        expect(toastTexts()).toContain('photos can\'t be opened from a drop here. Use Open folder… in the workspace menu.');
    });
});

describe('App folders dropped outside the tree', () => {
    it('asks to open a folder dropped on the editor as a workspace and switches to it', async () => {
        await openHarnessWorkspaceAsync(harness);
        const photos = onDesktop('photos') as FakeDirectoryHandle;
        vi.mocked(addWorkspaceAsync).mockResolvedValue(photosWorkspace(photos));
        answerDialogs({ outcome: 'yes' });

        await dropAsync(main(), [photos]);

        expect(dialogRequests()[0]).toMatchObject({ title: 'Open folder', body: 'Open photos as a workspace?' });
        expect(addWorkspaceAsync).toHaveBeenCalledWith(photos);
        expect(harness.state().workspace).toMatchObject({ id: 'w2', name: 'photos' });
        expect(treeRow('x.png')).toBeDefined();
    });

    it('keeps the current workspace when the prompt is declined', async () => {
        await openHarnessWorkspaceAsync(harness);

        await dropAsync(main(), [onDesktop('photos')]);

        expect(addWorkspaceAsync).not.toHaveBeenCalled();
        expect(harness.state().workspace?.id).toBe('w1');
    });

    it('opens the files first, then asks about the first folder only', async () => {
        await openHarnessWorkspaceAsync(harness);
        const openAtPrompt: number[] = [];
        vi.mocked(showDialogAsync).mockImplementation(async () => {
            openAtPrompt.push(harness.state().openFiles.length);

            return { outcome: 'cancel' };
        });

        await dropAsync(main(), [onDesktop('photos'), onDesktop('notes.txt'), onDesktop('docs')]);

        expect(openAtPrompt).toEqual([1]);
        expect(dialogRequests()[0]?.body).toBe('Open photos as a workspace?');
    });

    it('keeps outside tabs open when the dropped folder becomes the workspace', async () => {
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'a.txt');
        const photos = onDesktop('photos') as FakeDirectoryHandle;
        vi.mocked(addWorkspaceAsync).mockResolvedValue(photosWorkspace(photos));
        answerDialogs({ outcome: 'yes' });

        await dropAsync(main(), [onDesktop('notes.txt'), photos]);

        expect(harness.state().workspace?.id).toBe('w2');
        expect(harness.state().openFiles.map((file) => file.external != null)).toEqual([true]);
    });
});

describe('App imports dropped on the tree', () => {
    it('imports a file dropped on a folder, bytes intact, and opens it', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'yes' });

        await dropAsync(treeRow('docs'), [onDesktop('photo.bin')]);

        expect(dialogRequests()[0]).toMatchObject({
            title: 'Import into the workspace',
            body: 'Import 1 file into docs/?',
            paths: [{ label: 'File', path: 'docs/photo.bin' }],
        });
        expect(bytesOf(harness.folder, 'docs/photo.bin')).toEqual([...BINARY]);
        expect(openPaths(harness)).toEqual(['docs/photo.bin']);
        expect(toastTexts()).toContain('1 file imported.');
    });

    it('imports into the parent folder when dropped on a file row', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'yes' });

        await dropAsync(treeRow('b.txt'), [onDesktop('notes.txt')]);

        expect(textOf(harness.folder, 'notes.txt')).toBe('notes from the desktop\n');
    });

    it('imports nothing when the import is cancelled', async () => {
        await openHarnessWorkspaceAsync(harness);

        await dropAsync(treeRow('docs'), [onDesktop('notes.txt')]);

        expect(harness.folder.find('docs/notes.txt')).toBeNull();
    });

    it('imports a whole folder into the root from the empty tree area, then opens and reveals its first file', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'yes' });

        await dropAsync(tree(), [onDesktop('photos'), onDesktop('notes.txt')]);

        expect(dialogRequests()[0]).toMatchObject({
            body: 'Import 1 file and 1 folder into the workspace root?',
            paths: [{ label: 'Folder', path: 'photos' }, { label: 'File', path: 'notes.txt' }],
        });
        expect(bytesOf(harness.folder, 'photos/x.png')).toEqual([...BINARY]);
        expect(textOf(harness.folder, 'photos/raw/y.raw')).toBe('raw');
        expect(textOf(harness.folder, 'notes.txt')).toBe('notes from the desktop\n');
        expect(openPaths(harness)).toEqual(['photos/x.png']);
        expect(harness.state().expandedPaths.has('photos')).toBe(true);
        expect(treeRow('photos/x.png')).toBeDefined();
        expect(toastTexts()).toContain('3 files and 1 folder imported.');
    });

    it('asks about each name clash, inside dropped folders too', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'yes' }, { outcome: 'button', id: 'keep-both' }, { outcome: 'button', id: 'replace' });

        await dropAsync(tree(), [onDesktop('docs'), onDesktop('a.txt')]);

        expect(dialogRequests().slice(1)).toMatchObject([
            {
                title: 'Name already exists',
                body: 'An item named "readme.md" already exists in docs/.',
                paths: [{ label: 'From', path: 'docs/readme.md' }, { label: 'To', path: 'docs/readme.md' }],
            },
            { body: 'An item named "a.txt" already exists at the workspace root.' },
        ]);
        expect(textOf(harness.folder, 'docs/readme.md')).toBe('# Readme\n');
        expect(textOf(harness.folder, 'docs/readme-copy.md')).toBe('# Desktop readme\n');
        expect(textOf(harness.folder, 'docs/new.md')).toBe('new\n');
        expect(textOf(harness.folder, 'docs/a.txt')).toBe('docs alpha\n');
        expect(textOf(harness.folder, 'a.txt')).toBe('desktop alpha\n');
        expect(toastTexts()).toContain('3 files and 1 folder imported.');
    });

    it('leaves a clashing file alone when Skip is picked', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'yes' }, { outcome: 'button', id: 'skip' });

        await dropAsync(tree(), [onDesktop('a.txt'), onDesktop('notes.txt')]);

        expect(textOf(harness.folder, 'a.txt')).toBe('alpha\n');
        expect(textOf(harness.folder, 'notes.txt')).toBe('notes from the desktop\n');
        expect(toastTexts()).toContain('1 file imported.');
    });

    it('answers every clash at once when Apply to all is ticked', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'yes' });
        vi.mocked(showDialogAsync).mockImplementationOnce(async (request) => {
            const box = request.bodyNode?.querySelector('input') ?? null;
            box!.checked = true;
            box!.dispatchEvent(new Event('change'));

            return { outcome: 'button', id: 'replace' };
        });

        await dropAsync(tree(), [onDesktop('docs'), onDesktop('a.txt')]);

        expect(dialogRequests()).toHaveLength(2);
        expect(textOf(harness.folder, 'docs/readme.md')).toBe('# Desktop readme\n');
        expect(textOf(harness.folder, 'a.txt')).toBe('desktop alpha\n');
    });

    it('imports nothing when a clash prompt is closed', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'yes' }, { outcome: 'cancel' });

        await dropAsync(tree(), [onDesktop('notes.txt'), onDesktop('a.txt')]);

        expect(harness.folder.find('notes.txt')).toBeNull();
        expect(textOf(harness.folder, 'a.txt')).toBe('alpha\n');
    });

    it('offers Move or copy for a dropped item that already lives in the workspace', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'yes' });

        await dropAsync(treeRow('docs'), [harness.folder.find('b.txt')!]);

        expect(dialogRequests()[0]).toMatchObject({
            title: 'Move or copy',
            paths: [{ label: 'From', path: 'b.txt' }, { label: 'To', path: 'docs/' }],
        });
        expect(harness.folder.find('b.txt')).toBeNull();
        expect(textOf(harness.folder, 'docs/b.txt')).toBe('bravo\n');
    });

    it('refuses to drop a workspace folder into itself', async () => {
        await openHarnessWorkspaceAsync(harness);

        await dropAsync(treeRow('docs'), [harness.folder.find('docs')!]);

        expect(showDialogAsync).not.toHaveBeenCalled();
        expect(toastTexts()).toContain('docs can\'t be dropped into itself.');
    });

    it('moves rows dragged inside the tree', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'yes' });
        const transfer = { types: [INTERNAL_MIME], dropEffect: 'none', getData: () => JSON.stringify(['b.txt']) };

        treeRow('docs').dispatchEvent(dragEvent('drop', transfer));
        await settleAsync();

        expect(dialogRequests()[0]?.title).toBe('Move or copy');
        expect(textOf(harness.folder, 'docs/b.txt')).toBe('bravo\n');
    });
});

describe('App dropping items on the folder they are already in', () => {
    // Drags the rows of `paths` inside the tree and drops them on `target`.
    async function dropRowsAsync(paths: ReadonlyArray<string>, target: HTMLElement): Promise<void> {
        const transfer = { types: [INTERNAL_MIME], dropEffect: 'none', getData: () => JSON.stringify(paths) };
        target.dispatchEvent(dragEvent('dragover', transfer));
        target.dispatchEvent(dragEvent('drop', transfer));
        await settleAsync();
    }

    async function openWithDocsExpandedAsync(): Promise<void> {
        await openHarnessWorkspaceAsync(harness);
        harness.store.update({ expandedPaths: new Set(['docs']) });
        await harness.callAsync('refreshTreeAsync');
    }

    function expectNothingHappened(): void {
        expect(showDialogAsync).not.toHaveBeenCalled();
        expect(toastTexts()).toEqual([]);
        expect(textOf(harness.folder, 'a.txt')).toBe('alpha\n');
        expect(textOf(harness.folder, 'docs/readme.md')).toBe('# Readme\n');
        expect(harness.folder.find('docs/readme-copy.md')).toBeNull();
        expect(harness.folder.find('a-copy.txt')).toBeNull();
    }

    it('does nothing for a file dropped on its own folder', async () => {
        await openWithDocsExpandedAsync();

        await dropRowsAsync(['docs/readme.md'], treeRow('docs'));

        expectNothingHappened();
    });

    it('does nothing for a file dropped on a file beside it, which stands for their folder', async () => {
        await openWithDocsExpandedAsync();

        await dropRowsAsync(['docs/readme.md'], treeRow('docs/a.txt'));

        expectNothingHappened();
    });

    it('does nothing for a file at the root dropped on the empty area below the rows', async () => {
        await openWithDocsExpandedAsync();

        await dropRowsAsync(['a.txt'], tree());

        expectNothingHappened();
    });

    it('does nothing for a file dropped on its own folder from the computer', async () => {
        await openWithDocsExpandedAsync();

        await dropAsync(treeRow('docs'), [harness.folder.find('docs/readme.md')!]);

        expectNothingHappened();
    });

    it('does nothing when every item of a selection is in the folder already', async () => {
        await openWithDocsExpandedAsync();

        await dropRowsAsync(['docs/readme.md', 'docs/a.txt'], treeRow('docs'));

        expectNothingHappened();
    });

    it('lists and moves only the items of a mixed selection that come from elsewhere', async () => {
        await openWithDocsExpandedAsync();
        answerDialogs({ outcome: 'yes' });

        await dropRowsAsync(['docs/readme.md', 'b.txt'], treeRow('docs'));

        expect(dialogRequests()).toHaveLength(1);
        expect(dialogRequests()[0]).toMatchObject({
            title: 'Move or copy',
            body: 'Move or copy the item into the target folder?',
            paths: [{ label: 'From', path: 'b.txt' }, { label: 'To', path: 'docs/' }],
        });
        expect(harness.folder.find('b.txt')).toBeNull();
        expect(textOf(harness.folder, 'docs/b.txt')).toBe('bravo\n');
        expect(textOf(harness.folder, 'docs/readme.md')).toBe('# Readme\n');
    });

    it('copies only the items of a mixed selection that come from elsewhere', async () => {
        await openWithDocsExpandedAsync();
        answerDialogs({ outcome: 'no' });

        await dropRowsAsync(['docs/readme.md', 'b.txt'], treeRow('docs'));

        expect(textOf(harness.folder, 'b.txt')).toBe('bravo\n');
        expect(textOf(harness.folder, 'docs/b.txt')).toBe('bravo\n');
        expect(harness.folder.find('docs/readme-copy.md')).toBeNull();
        expect(toastTexts()).toContain('1 item copied.');
    });
});

describe('App drop hints', () => {
    it('shows both hints while files are over the window and clears them after a drop on the editor', async () => {
        await openHarnessWorkspaceAsync(harness);
        const transfer = fakeDataTransfer([onDesktop('notes.txt')]);

        main().dispatchEvent(dragEvent('dragenter', transfer.transfer));

        expect(hints()).toEqual({ open: 'Drop to open', importHint: 'Drop on a folder to import' });

        main().dispatchEvent(dragEvent('drop', transfer.transfer));
        transfer.end();
        await settleAsync();

        expect(hints()).toEqual(CLEARED);
    });

    it('clears the hints and the folder highlight after a drop on the tree', async () => {
        await openHarnessWorkspaceAsync(harness);

        await dropAsync(treeRow('docs'), [onDesktop('notes.txt')]);

        expect(hints()).toEqual(CLEARED);
        expect(document.querySelector('[data-drop-target]')).toBeNull();
    });

    it('clears the hints after a drop on a diff drop zone, which fills that side instead of opening a tab', async () => {
        await openHarnessWorkspaceAsync(harness);
        harness.app.newCompare('text');
        await settleAsync();
        const zone = document.querySelector('.diff-target-drop-zone')!;

        await dropAsync(zone, [new File(['zone text'], 'zone.txt')]);

        expect(hints()).toEqual(CLEARED);
        expect(harness.state().openFiles).toHaveLength(0);
        expect(harness.state().diffTabs[0]?.original?.text).toBe('zone text');
    });

    it('highlights the folder under the pointer only while a workspace is open', async () => {
        const transfer = fakeDataTransfer([onDesktop('notes.txt')]).transfer;
        tree().dispatchEvent(dragEvent('dragover', transfer));

        expect(tree().dataset['dropRoot']).toBeUndefined();
        expect(sidebar().dataset['dropHint']).toBeUndefined();

        await openHarnessWorkspaceAsync(harness);
        treeRow('docs').dispatchEvent(dragEvent('dragover', transfer));

        expect(treeRow('docs').dataset['dropTarget']).toBe('true');
    });

    it('drops nothing on the page when the browser would otherwise navigate to the file', async () => {
        const over = dragEvent('dragover', fakeDataTransfer([onDesktop('notes.txt')]).transfer);
        document.querySelector('.status-bar')!.dispatchEvent(over);
        const drop = dropFixtures(document.querySelector('.status-bar')!, [onDesktop('notes.txt')]);
        await settleAsync();

        expect(over.defaultPrevented).toBe(true);
        expect(drop.defaultPrevented).toBe(true);
    });
});
