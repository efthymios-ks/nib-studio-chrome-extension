import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asRoot, FakeDirectoryHandle, FakeFileHandle } from '../../common/fs/testing/fakeFileSystem.js';
import { createAppHarness, openHarnessWorkspaceAsync, treeRow, type AppHarness } from '../testing/appHarness.js';
import { settleAsync, toastTexts } from '../testing/testHelpers.js';
import { showCompareChooserAsync } from '../views/compareChooser.js';
import { mountPreview } from '../views/previewPane.js';
import type { Command, CommandContext } from './commands.js';
import type { DroppedFile } from './droppedItems.js';
import { isExternalPath, type OpenFile } from './store.js';

vi.mock('../views/previewPane.js', () => ({
    mountPreview: vi.fn((pane: HTMLElement) => {
        const element = document.createElement('div');
        element.className = 'preview-frame';
        pane.append(element);

        return { element, update: vi.fn(), destroy: vi.fn() };
    }),
}));

vi.mock('../views/compareChooser.js', () => ({
    showCompareChooserAsync: vi.fn(async () => null),
}));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

// A gzip header, the start of a .tar.gz.
const ARCHIVE = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0, 0x03]);

// A ZIP header, the start of a .pptx or an .odt.
const OFFICE_ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0x08, 0]);

// Bytes of a file of an unknown type: a NUL among them says it isn't text.
const FIRMWARE = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0x00, 0x00]);

let harness: AppHarness;

function openFile(path: string): OpenFile {
    const file = harness.state().openFiles.find((candidate) => candidate.path === path);

    if (file == null) {
        throw new Error(`${path} is not open`);
    }

    return file;
}

beforeEach(async () => {
    vi.mocked(mountPreview).mockClear();
    vi.mocked(showCompareChooserAsync).mockClear();
    harness = createAppHarness({
        'notes.txt': 'one\ntwo\n',
        'other.txt': 'three\n',
        'media/photo.png': PNG,
        'media/song.mp3': new Uint8Array([0x49, 0x44, 0x33, 3]),
        'media/clip.mp4': new Uint8Array([0, 0, 0, 24]),
        'media/fonts/Sans.ttf': new Uint8Array([0, 1, 0, 0, 0, 0]),
        'backups/site.tar.gz': ARCHIVE,
        'talks/deck.pptx': OFFICE_ZIP,
        'talks/letter.odt': OFFICE_ZIP,
        'firmware.bin': FIRMWARE,
        'scripts/run': 'echo hello\n',
    });
    await openHarnessWorkspaceAsync(harness);
});

afterEach(() => {
    harness.app.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren(...document.querySelectorAll('.context-menu'));
});

describe('App opening previews', () => {
    it('opens images, audio, video and fonts from their File and never reads them as text', async () => {
        const readText = vi.spyOn(File.prototype, 'text');

        for (const path of ['media/photo.png', 'media/song.mp3', 'media/clip.mp4', 'media/fonts/Sans.ttf']) {
            await harness.callAsync('openFileAsync', path, { preview: false });
        }

        expect(readText).not.toHaveBeenCalled();
        expect(harness.state().openFiles.map((file) => [file.path, file.text, file.file?.size])).toEqual([
            ['media/photo.png', '', PNG.length],
            ['media/song.mp3', '', 4],
            ['media/clip.mp4', '', 4],
            ['media/fonts/Sans.ttf', '', 6],
        ]);
        expect(vi.mocked(mountPreview).mock.calls.map(([, input]) => [input.kind, input.memoryKey])).toEqual([
            ['image', 'media/photo.png'],
            ['audio', 'media/song.mp3'],
            ['video', 'media/clip.mp4'],
            ['font', 'media/fonts/Sans.ttf'],
        ]);
    });

    it('opens an archive as a preview from its File, never reading it as text and showing no text encoding', async () => {
        const readText = vi.spyOn(File.prototype, 'text');
        await harness.callAsync('openFileAsync', 'backups/site.tar.gz', { preview: false });

        expect(readText).not.toHaveBeenCalled();
        expect([openFile('backups/site.tar.gz').text, openFile('backups/site.tar.gz').file?.size]).toEqual(['', ARCHIVE.length]);
        expect(vi.mocked(mountPreview).mock.calls.at(-1)?.[1]).toMatchObject({ kind: 'archive', fileName: 'site.tar.gz', memoryKey: 'backups/site.tar.gz' });
        expect(document.querySelector('.cm-editor')).toBeNull();
        expect(document.querySelector('.status-bar, #studio-status')?.textContent).not.toContain('UTF-8');
    });

    it('never saves an archive, and Ctrl+S in it does nothing, quietly', async () => {
        await harness.callAsync('openFileAsync', 'backups/site.tar.gz');
        const handle = harness.folder.find('backups/site.tar.gz') as FakeFileHandle;
        const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });

        document.querySelector('.preview-frame')!.dispatchEvent(event);
        await settleAsync();

        expect(event.defaultPrevented).toBe(true);
        expect(await harness.callAsync('saveAsync', 'backups/site.tar.gz')).toBe(false);
        expect(handle.writeCount).toBe(0);
        expect(openFile('backups/site.tar.gz').dirty).toBe(false);
        expect(toastTexts()).toEqual([]);
    });

    it('opens an archive dropped from outside the workspace as a preview, without reading it as text', async () => {
        const readText = vi.spyOn(File.prototype, 'text');
        const desktop = new FakeDirectoryHandle('desktop');
        desktop.addFile('photos.zip', ARCHIVE);
        const handle = desktop.find('photos.zip') as FakeFileHandle;
        const dropped: DroppedFile = {
            kind: 'file',
            name: 'photos.zip',
            handle: handle as unknown as FileSystemFileHandle,
            readAsync: async () => await handle.getFile(),
        };

        await harness.callAsync('openExternalFileAsync', dropped);

        expect((harness.state().openFiles[0] as OpenFile).text).toBe('');
        expect(readText).not.toHaveBeenCalled();
        expect(vi.mocked(mountPreview).mock.calls.at(-1)?.[1]).toMatchObject({ kind: 'archive', fileName: 'photos.zip' });
    });

    it('never saves a preview, so the file on disk is untouched and nothing turns dirty', async () => {
        await harness.callAsync('openFileAsync', 'media/photo.png');
        const handle = harness.folder.find('media/photo.png') as FakeFileHandle;

        expect(await harness.callAsync('saveAsync', 'media/photo.png')).toBe(false);
        expect(handle.writeCount).toBe(0);
        expect(openFile('media/photo.png').dirty).toBe(false);
    });

    it('keeps Ctrl+S in a preview from opening the Save as dialog of the browser, quietly', async () => {
        await harness.callAsync('openFileAsync', 'media/photo.png');
        const handle = harness.folder.find('media/photo.png') as FakeFileHandle;
        const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });

        document.querySelector('.preview-frame')!.dispatchEvent(event);
        await settleAsync();

        expect(event.defaultPrevented).toBe(true);
        expect(handle.writeCount).toBe(0);
        expect(toastTexts()).toEqual([]);
    });

    it('shows no text encoding in the status bar for a preview', async () => {
        await harness.callAsync('openFileAsync', 'media/photo.png');

        expect(document.querySelector('.status-bar, #studio-status')?.textContent).not.toContain('UTF-8');

        await harness.callAsync('openFileAsync', 'notes.txt');

        expect(document.querySelector('.status-bar, #studio-status')?.textContent).toContain('UTF-8');
    });

    it('opens an image dropped from outside the workspace as a preview, without reading it as text', async () => {
        const readText = vi.spyOn(File.prototype, 'text');
        const desktop = new FakeDirectoryHandle('desktop');
        desktop.addFile('holiday.png', PNG);
        const handle = desktop.find('holiday.png') as FakeFileHandle;
        const dropped: DroppedFile = {
            kind: 'file',
            name: 'holiday.png',
            handle: handle as unknown as FileSystemFileHandle,
            readAsync: async () => await handle.getFile(),
        };

        await harness.callAsync('openExternalFileAsync', dropped);
        const file = harness.state().openFiles[0] as OpenFile;

        expect(isExternalPath(file.path)).toBe(true);
        expect(file.text).toBe('');
        expect(readText).not.toHaveBeenCalled();
        expect(vi.mocked(mountPreview).mock.calls.at(-1)?.[1]).toMatchObject({ kind: 'image', fileName: 'holiday.png' });
    });
});

describe('App opening files that have no text to show', () => {
    function statusText(): string {
        return document.querySelector('.status-bar, #studio-status')?.textContent ?? '';
    }

    it('opens presentations and OpenDocument text from their File as a message, never reading them as text', async () => {
        const readText = vi.spyOn(File.prototype, 'text');
        await harness.callAsync('openFileAsync', 'talks/deck.pptx', { preview: false });
        await harness.callAsync('openFileAsync', 'talks/letter.odt', { preview: false });

        expect(readText).not.toHaveBeenCalled();
        expect([openFile('talks/deck.pptx').text, openFile('talks/letter.odt').text]).toEqual(['', '']);
        expect(vi.mocked(mountPreview).mock.calls.map(([, input]) => [input.kind, input.fileName])).toEqual([
            ['office', 'deck.pptx'],
            ['office', 'letter.odt'],
        ]);
        expect(statusText()).toContain('OpenDocument text document');
        expect(statusText()).not.toContain('UTF-8');
    });

    it('opens a file of an unknown type whose first bytes aren\'t text as a message, without its text', async () => {
        const readText = vi.spyOn(File.prototype, 'text');
        await harness.callAsync('openFileAsync', 'firmware.bin', { preview: false });

        expect(readText).not.toHaveBeenCalled();
        expect(openFile('firmware.bin')).toMatchObject({ text: '', binary: true });
        expect(vi.mocked(mountPreview).mock.calls.at(-1)?.[1]).toMatchObject({ kind: 'binary', fileName: 'firmware.bin', memoryKey: 'firmware.bin' });
        expect(document.querySelector('.cm-editor')).toBeNull();
        expect(statusText()).toContain('Binary');
        expect(statusText()).not.toContain('UTF-8');
    });

    it('opens a file of an unknown type whose first bytes are text in the editor, as before', async () => {
        await harness.callAsync('openFileAsync', 'scripts/run', { preview: false });

        expect(openFile('scripts/run').text).toBe('echo hello\n');
        expect(openFile('scripts/run').binary).toBeUndefined();
        expect(mountPreview).not.toHaveBeenCalled();
        expect(statusText()).toContain('UTF-8');
    });

    it('keeps a known text type as text, whatever its bytes', async () => {
        harness.folder.addFile('odd.txt', new Uint8Array([0x61, 0x00, 0x62, 0x0a]));
        await harness.callAsync('openFileAsync', 'odd.txt', { preview: false });

        expect(openFile('odd.txt').text).toBe('a\u0000b\n');
        expect(mountPreview).not.toHaveBeenCalled();
    });

    it('never saves a file that isn\'t text, and Ctrl+S in it does nothing, quietly', async () => {
        await harness.callAsync('openFileAsync', 'firmware.bin');
        const handle = harness.folder.find('firmware.bin') as FakeFileHandle;

        expect(await harness.callAsync('saveAsync', 'firmware.bin')).toBe(false);
        expect(handle.writeCount).toBe(0);
        expect(toastTexts()).toEqual([]);
    });

    it('opens a file that isn\'t text dropped from outside the workspace as the same message', async () => {
        const readText = vi.spyOn(File.prototype, 'text');
        const desktop = new FakeDirectoryHandle('desktop');
        desktop.addFile('dump', FIRMWARE);
        const handle = desktop.find('dump') as FakeFileHandle;
        const dropped: DroppedFile = {
            kind: 'file',
            name: 'dump',
            handle: handle as unknown as FileSystemFileHandle,
            readAsync: async () => await handle.getFile(),
        };

        await harness.callAsync('openExternalFileAsync', dropped);

        expect(harness.state().openFiles[0]).toMatchObject({ text: '', binary: true });
        expect(readText).not.toHaveBeenCalled();
        expect(vi.mocked(mountPreview).mock.calls.at(-1)?.[1]).toMatchObject({ kind: 'binary', fileName: 'dump' });
    });
});

describe('App keeping previews out of compares', () => {
    async function commandAsync(id: string, surface: 'tree' | 'tab', path: string): Promise<{ command: Command; context: CommandContext }> {
        const registry = await harness.callAsync<ReadonlyArray<Command>>('buildCommandRegistry');
        const command = registry.find((candidate) => candidate.id === id) as Command;
        const context = await harness.callAsync<CommandContext>('makeCommandContext', surface, path);

        return { command, context: surface === 'tree' ? { ...context, selectedPaths: [path] } : context };
    }

    it('turns Compare with off for a preview file, in the tree and on its tab', async () => {
        await harness.callAsync('openFileAsync', 'media/photo.png');

        for (const surface of ['tree', 'tab'] as const) {
            const { command, context } = await commandAsync('compare-with', surface, 'media/photo.png');

            expect(command.enabledWhen?.(context)).toBe(false);
            expect(command.children?.(context)).toEqual([]);
        }

        const text = await commandAsync('compare-with', 'tree', 'notes.txt');
        expect(text.command.enabledWhen?.(text.context)).toBe(true);
    });

    it('turns Compare with off for an archive, and offers no Compare these two files for two archives', async () => {
        await harness.callAsync('openFileAsync', 'backups/site.tar.gz');

        for (const surface of ['tree', 'tab'] as const) {
            const { command, context } = await commandAsync('compare-with', surface, 'backups/site.tar.gz');

            expect(command.enabledWhen?.(context)).toBe(false);
        }

        const { command, context } = await commandAsync('compare-selected-files', 'tree', 'backups/site.tar.gz');

        expect(command.visibleWhen?.({ ...context, selectedPaths: ['backups/site.tar.gz', 'backups/site.tar.gz'] })).toBe(false);
        expect(await harness.callAsync('readDropTargetAsync', 'backups/site.tar.gz')).toBeNull();
    });

    it('does not offer an open preview as the other side', async () => {
        await harness.callAsync('openFileAsync', 'media/photo.png', { preview: false });
        await harness.callAsync('openFileAsync', 'other.txt', { preview: false });
        await harness.callAsync('openFileAsync', 'notes.txt', { preview: false });
        const { command, context } = await commandAsync('compare-with', 'tab', 'notes.txt');

        expect(command.children?.(context).map((child) => child.label)).toEqual([
            'Compare with clipboard',
            'Compare with a file…',
            'Compare with open tab: other.txt',
        ]);
    });

    it('leaves previews out of the compare chooser, open tabs and workspace files alike', async () => {
        await harness.callAsync('openFileAsync', 'media/photo.png', { preview: false });
        await harness.callAsync('openFileAsync', 'notes.txt', { preview: false });
        await harness.callAsync('chooseSideAsync', { exclude: 'notes.txt', kind: 'text', anchor: document.body, title: 'Compare with' });
        const request = vi.mocked(showCompareChooserAsync).mock.calls[0]?.[0];

        expect(request?.openTabs).toEqual([]);
        expect(await request?.listWorkspaceFilesAsync()).toEqual(['other.txt']);
    });

    it('refuses a preview file dropped on a compare side, saying why', async () => {
        const target = await harness.callAsync('readDropTargetAsync', 'media/song.mp3');

        expect(target).toBeNull();
        expect(toastTexts()).toContain('song.mp3 can\'t be compared: it opens only as a preview.');
    });

    it('turns Compare with off for a presentation and for an open file that isn\'t text', async () => {
        await harness.callAsync('openFileAsync', 'talks/deck.pptx', { preview: false });
        await harness.callAsync('openFileAsync', 'firmware.bin', { preview: false });

        for (const path of ['talks/deck.pptx', 'firmware.bin']) {
            for (const surface of ['tree', 'tab'] as const) {
                const { command, context } = await commandAsync('compare-with', surface, path);

                expect(command.enabledWhen?.(context), `${path} on the ${surface}`).toBe(false);
                expect(command.children?.(context), `${path} on the ${surface}`).toEqual([]);
            }
        }
    });

    it('does not offer an open file that isn\'t text as the other side, in the menu or the chooser', async () => {
        await harness.callAsync('openFileAsync', 'firmware.bin', { preview: false });
        await harness.callAsync('openFileAsync', 'talks/deck.pptx', { preview: false });
        await harness.callAsync('openFileAsync', 'other.txt', { preview: false });
        await harness.callAsync('openFileAsync', 'notes.txt', { preview: false });
        const { command, context } = await commandAsync('compare-with', 'tab', 'notes.txt');

        expect(command.children?.(context).map((child) => child.label)).toEqual([
            'Compare with clipboard',
            'Compare with a file…',
            'Compare with open tab: other.txt',
        ]);

        await harness.callAsync('chooseSideAsync', { exclude: 'notes.txt', kind: 'text', anchor: document.body, title: 'Compare with' });
        const request = vi.mocked(showCompareChooserAsync).mock.calls[0]?.[0];

        expect(request?.openTabs).toEqual(['other.txt']);
        expect(await request?.listWorkspaceFilesAsync()).toEqual(['other.txt']);
    });

    it('refuses a file that isn\'t text dropped on a compare side, saying why', async () => {
        const target = await harness.callAsync('readDropTargetAsync', 'firmware.bin');

        expect(target).toBeNull();
        expect(toastTexts()).toContain('firmware.bin can\'t be compared: it isn\'t text.');
        expect(await harness.callAsync('readDropTargetAsync', 'scripts/run')).toMatchObject({ kind: 'file', text: 'echo hello\n' });
    });

    it('offers no Compare these two files for two images', async () => {
        treeRow('media').click();
        await settleAsync();
        const context = await harness.callAsync<CommandContext>('makeCommandContext', 'tree');
        const registry = await harness.callAsync<ReadonlyArray<Command>>('buildCommandRegistry');
        const pair = registry.find((candidate) => candidate.id === 'compare-selected-files') as Command;

        expect(pair.visibleWhen?.({ ...context, selectedPaths: ['media/photo.png', 'media/photo.png'] })).toBe(false);
    });
});

describe('App refreshing previews', () => {
    type ObserverRecord = { type: string; relativePathComponents: string[] };

    class FakeObserver {
        static latest: FakeObserver | null = null;

        constructor(readonly callback: (records: ReadonlyArray<ObserverRecord>) => void) {
            FakeObserver.latest = this;
        }

        async observe(): Promise<void> {}

        disconnect(): void {}
    }

    it('takes a fresh snapshot of an open image that changed on disk, still without its text', async () => {
        vi.stubGlobal('FileSystemObserver', FakeObserver);
        await harness.callAsync('activateWorkspaceAsync', { id: 'w1', handle: asRoot(harness.folder), name: 'workspace' });
        await harness.callAsync('openFileAsync', 'media/photo.png');
        const before = openFile('media/photo.png').file;
        const handle = harness.folder.find('media/photo.png') as FakeFileHandle;
        handle.data = new Uint8Array([...PNG, 1, 2, 3]);
        handle.lastModified += 1;
        FakeObserver.latest?.callback([{ type: 'modified', relativePathComponents: ['media', 'photo.png'] }]);
        await new Promise((resolve) => setTimeout(resolve, 200));
        await settleAsync();

        const after = openFile('media/photo.png');
        expect(after.file).not.toBe(before);
        expect(after.file?.size).toBe(PNG.length + 3);
        expect(after.text).toBe('');
        expect(after.dirty).toBe(false);
    });

    it('takes a fresh snapshot of an open workbook that changed on disk, which its table reads', async () => {
        vi.stubGlobal('FileSystemObserver', FakeObserver);
        harness.folder.addFile('data/book.xlsx', ARCHIVE);
        await harness.callAsync('activateWorkspaceAsync', { id: 'w1', handle: asRoot(harness.folder), name: 'workspace' });
        await harness.callAsync('openFileAsync', 'data/book.xlsx');
        const before = openFile('data/book.xlsx').file;
        const handle = harness.folder.find('data/book.xlsx') as FakeFileHandle;
        handle.data = new Uint8Array([...ARCHIVE, 9]);
        handle.lastModified += 1;
        FakeObserver.latest?.callback([{ type: 'modified', relativePathComponents: ['data', 'book.xlsx'] }]);
        await new Promise((resolve) => setTimeout(resolve, 200));
        await settleAsync();

        expect(openFile('data/book.xlsx').file).not.toBe(before);
        expect(openFile('data/book.xlsx').file?.size).toBe(ARCHIVE.length + 1);
    });

    it('hands an open archive that changed on disk its fresh snapshot, still without its text', async () => {
        vi.stubGlobal('FileSystemObserver', FakeObserver);
        await harness.callAsync('activateWorkspaceAsync', { id: 'w1', handle: asRoot(harness.folder), name: 'workspace' });
        await harness.callAsync('openFileAsync', 'backups/site.tar.gz');
        const readText = vi.spyOn(File.prototype, 'text');
        const handle = harness.folder.find('backups/site.tar.gz') as FakeFileHandle;
        handle.data = new Uint8Array([...ARCHIVE, 1, 2, 3, 4]);
        handle.lastModified += 1;
        FakeObserver.latest?.callback([{ type: 'modified', relativePathComponents: ['backups', 'site.tar.gz'] }]);
        await new Promise((resolve) => setTimeout(resolve, 200));
        await settleAsync();

        const update = vi.mocked(mountPreview).mock.results.at(-1)?.value.update as ReturnType<typeof vi.fn>;
        expect(openFile('backups/site.tar.gz').file?.size).toBe(ARCHIVE.length + 4);
        expect(update.mock.calls.at(-1)?.[0]?.size).toBe(ARCHIVE.length + 4);
        expect(readText).not.toHaveBeenCalled();
    });
});
