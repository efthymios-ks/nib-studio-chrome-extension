import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asRoot, bytesOf, FakeDirectoryHandle, FakeFileHandle, textOf } from '../../common/fs/testing/fakeFileSystem.js';
import {
    createAppHarness,
    markChange,
    openHarnessWorkspaceAsync,
    openPaths,
    treeRow,
    type AppHarness,
} from '../testing/appHarness.js';
import { settleAsync, toastTexts } from '../testing/testHelpers.js';
import { showDialogAsync, type DialogRequest, type DialogResult } from './dialog.js';

vi.mock('./dialog.js', () => ({
    showDialogAsync: vi.fn(),
}));

const BINARY = new Uint8Array([0, 255, 128, 10, 13, 0xc3, 0x28, 7]);

let harness: AppHarness;

function createHarness(): AppHarness {
    return createAppHarness({
        'a.txt': 'alpha\n',
        'b.txt': 'bravo\n',
        'image.bin': BINARY,
        'docs/readme.md': '# Readme\n',
        'docs/a.txt': 'docs alpha\n',
    });
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

function activeView(): string | undefined {
    return document.querySelector<HTMLElement>('[data-view][data-active="true"]')?.dataset['view'];
}

beforeEach(() => {
    vi.mocked(showDialogAsync).mockReset();
    vi.mocked(showDialogAsync).mockResolvedValue({ outcome: 'cancel' });
    harness = createHarness();
});

afterEach(() => {
    harness.app.dispose();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
});

describe('App choosing the view of an opened file', () => {
    it('opens a Markdown file in Preview, and keeps the view when its tab comes back', async () => {
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'a.txt');
        await harness.callAsync('openFileAsync', 'docs/readme.md');

        expect(activeView()).toBe('preview');

        document.querySelector<HTMLElement>('[data-view="editor"]')!.click();
        await harness.callAsync('openFileAsync', 'a.txt');
        await harness.callAsync('openFileAsync', 'docs/readme.md');

        expect(activeView()).toBe('editor');
    });
});

describe('App creating entries', () => {
    it('creates an empty file at the root and opens it', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'input', value: 'notes.md' });

        await harness.callAsync('newFileAsync', '');

        expect(textOf(harness.folder, 'notes.md')).toBe('');
        expect(openPaths(harness)).toEqual(['notes.md']);
        expect(harness.state().activePath).toBe('notes.md');
        expect(toastTexts()).toContain('notes.md created.');
        expect(activeView()).toBe('editor');
    });

    it('creates a file inside a folder', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'input', value: 'guide.md' });

        await harness.callAsync('newFileAsync', 'docs');

        expect(harness.folder.find('docs/guide.md')).toBeInstanceOf(FakeFileHandle);
        expect(dialogRequests()[0]?.body).toBe('Will be created in docs/');
    });

    it('rejects names with slashes or reserved names', async () => {
        await openHarnessWorkspaceAsync(harness);

        await harness.callAsync('newFileAsync', '');

        const kind = dialogRequests()[0]?.kind;
        const validate = kind?.kind === 'input' ? kind.validate : undefined;
        expect(validate?.('a/b.md')).toBe('Name cannot contain slashes.');
        expect(validate?.('a\\b.md')).toBe('Name cannot contain slashes.');
        expect(validate?.('..')).toBe('Reserved name.');
        expect(validate?.('fine.md')).toBeNull();
    });

    it('refuses a name an entry of the folder already takes, ignoring case, and keeps the dialog open', async () => {
        await openHarnessWorkspaceAsync(harness);

        await harness.callAsync('newFileAsync', '');
        await harness.callAsync('newFileAsync', 'docs');
        await harness.callAsync('newFolderAsync', '');

        const [atRoot, inDocs, folderAtRoot] = dialogRequests().map((request) => request.kind.kind === 'input' ? request.kind.validate : undefined);
        expect(atRoot?.('a.txt')).toBe('A file named a.txt already exists.');
        expect(atRoot?.('B.TXT')).toBe('A file named b.txt already exists.');
        expect(atRoot?.('docs')).toBe('A folder named docs already exists.');
        expect(atRoot?.('c.txt')).toBeNull();
        expect(inDocs?.('readme.md')).toBe('A file named readme.md already exists.');
        expect(inDocs?.('b.txt')).toBeNull();
        expect(folderAtRoot?.('docs')).toBe('A folder named docs already exists.');
    });

    it('gives the keyboard to the new file\'s editor, ready to type in', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'input', value: 'notes.md' });

        await harness.callAsync('newFileAsync', '');

        expect(document.activeElement?.closest('.cm-editor')).not.toBeNull();
    });

    it('creates nothing when the name prompt is cancelled', async () => {
        await openHarnessWorkspaceAsync(harness);

        await harness.callAsync('newFileAsync', '');
        await harness.callAsync('newFolderAsync', '');

        expect([...harness.folder.children.keys()].sort()).toEqual(['a.txt', 'b.txt', 'docs', 'image.bin']);
        expect(openPaths(harness)).toEqual([]);
    });

    it('creates a folder and expands its parent so it shows', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'input', value: 'drafts' });

        await harness.callAsync('newFolderAsync', 'docs');

        expect(harness.folder.find('docs/drafts')).toBeInstanceOf(FakeDirectoryHandle);
        expect(harness.state().expandedPaths.has('docs')).toBe(true);
        expect(treeRow('docs/drafts').dataset['kind']).toBe('directory');
    });

    it('asks for a workspace before creating anything', async () => {
        await harness.callAsync('newFileAsync', '');

        expect(showDialogAsync).not.toHaveBeenCalled();
        expect(toastTexts()).toContain('Pick a workspace folder first.');
    });
});

describe('App renaming entries', () => {
    it('renames a file on disk and moves its open tab to the new path', async () => {
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'a.txt');
        answerDialogs({ outcome: 'input', value: 'renamed.txt' });

        await harness.callAsync('renameAsync', 'a.txt');

        expect(harness.folder.find('a.txt')).toBeNull();
        expect(textOf(harness.folder, 'renamed.txt')).toBe('alpha\n');
        expect(openPaths(harness)).toEqual(['renamed.txt']);
        expect(harness.state().activePath).toBe('renamed.txt');
        expect(harness.state().openFiles[0]?.text).toBe('alpha\n');
        expect(toastTexts()).toContain('Renamed to renamed.txt.');
    });

    it('keeps unsaved edits in the tab that follows a rename', async () => {
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'a.txt');
        markChange(harness, 'a.txt', 'edited\n');
        answerDialogs({ outcome: 'input', value: 'renamed.txt' });

        await harness.callAsync('renameAsync', 'a.txt');

        expect(harness.state().openFiles[0]).toMatchObject({ path: 'renamed.txt', text: 'edited\n', dirty: true });
    });

    it('renames a folder and moves the tabs of the files inside it', async () => {
        await openHarnessWorkspaceAsync(harness);
        harness.store.update({ expandedPaths: new Set(['docs']) });
        await harness.callAsync('openFileAsync', 'docs/readme.md');
        await harness.callAsync('openFileAsync', 'b.txt');
        answerDialogs({ outcome: 'input', value: 'notes' });

        await harness.callAsync('renameAsync', 'docs');

        expect(harness.folder.find('docs')).toBeNull();
        expect(textOf(harness.folder, 'notes/readme.md')).toBe('# Readme\n');
        expect(textOf(harness.folder, 'notes/a.txt')).toBe('docs alpha\n');
        expect(openPaths(harness)).toEqual(['notes/readme.md', 'b.txt']);
        expect([...harness.state().expandedPaths]).toEqual(['notes']);
    });

    it('uses the native move when the browser offers it', async () => {
        const file = harness.folder.find('a.txt') as FakeFileHandle;
        file.enableNativeMove();
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'input', value: 'moved.txt' });

        await harness.callAsync('renameAsync', 'a.txt');

        expect(harness.folder.find('moved.txt')).toBe(file);
    });

    it('refuses a name another entry of the folder takes inside the dialog, ignoring case', async () => {
        await openHarnessWorkspaceAsync(harness);

        await harness.callAsync('renameAsync', 'a.txt');

        const kind = dialogRequests()[0]?.kind;
        const validate = kind?.kind === 'input' ? kind.validate : undefined;
        expect(validate?.('b.txt')).toBe('A file named b.txt already exists.');
        expect(validate?.('B.TXT')).toBe('A file named b.txt already exists.');
        expect(validate?.('DOCS')).toBe('A folder named docs already exists.');
        expect(validate?.('a.txt')).toBe('Pick a different name.');
        expect(validate?.('A.txt')).toBeNull();
        expect(validate?.('c.txt')).toBeNull();
        expect(textOf(harness.folder, 'a.txt')).toBe('alpha\n');
        expect(toastTexts()).toEqual([]);
    });

    it('renames to a change of case only', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'input', value: 'A.txt' });

        await harness.callAsync('renameAsync', 'a.txt');

        expect(textOf(harness.folder, 'A.txt')).toBe('alpha\n');
        expect(toastTexts()).toContain('Renamed to A.txt.');
    });
});

describe('App duplicating entries', () => {
    it('refuses a name an entry of the folder already takes, since copying onto it would replace it', async () => {
        await openHarnessWorkspaceAsync(harness);

        await harness.callAsync('duplicateAsync', 'a.txt');

        const kind = dialogRequests()[0]?.kind;
        const validate = kind?.kind === 'input' ? kind.validate : undefined;
        expect(validate?.('b.txt')).toBe('A file named b.txt already exists.');
        expect(validate?.('a-copy.txt')).toBeNull();
        expect(textOf(harness.folder, 'b.txt')).toBe('bravo\n');
    });
});

describe('App deleting entries', () => {
    it('deletes a file once confirmed and closes its tab', async () => {
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'a.txt');
        await harness.callAsync('openFileAsync', 'b.txt');
        answerDialogs({ outcome: 'yes' });

        await harness.callAsync('deletePathsAsync', ['b.txt']);

        expect(harness.folder.find('b.txt')).toBeNull();
        expect(openPaths(harness)).toEqual(['a.txt']);
        expect(harness.state().activePath).toBeNull();
        expect(toastTexts()).toContain('1 item deleted.');
    });

    it('closes the tabs of every file inside a deleted folder', async () => {
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'docs/readme.md');
        await harness.callAsync('openFileAsync', 'a.txt');
        answerDialogs({ outcome: 'yes' });

        await harness.callAsync('deletePathsAsync', ['docs']);

        expect(harness.folder.find('docs')).toBeNull();
        expect(openPaths(harness)).toEqual(['a.txt']);
        expect(harness.state().activePath).toBe('a.txt');
    });

    it('deletes several entries with one confirmation', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'yes' });

        await harness.callAsync('deletePathsAsync', ['a.txt', 'b.txt']);

        expect(dialogRequests()).toHaveLength(1);
        expect(dialogRequests()[0]?.body).toBe('Delete 2 items?');
        expect(harness.folder.find('a.txt')).toBeNull();
        expect(harness.folder.find('b.txt')).toBeNull();
    });

    it('focuses the next row in the tree, or the one before at the end', async () => {
        await openHarnessWorkspaceAsync(harness);
        const tree = document.querySelector<HTMLElement>('.tree')!;
        answerDialogs({ outcome: 'yes' }, { outcome: 'yes' });

        await harness.callAsync('deletePathsAsync', ['a.txt']);

        expect(document.activeElement).toBe(tree);
        expect(treeRow('b.txt').dataset['focused']).toBe('true');

        await harness.callAsync('deletePathsAsync', ['image.bin']);

        expect(document.activeElement).toBe(tree);
        expect(treeRow('b.txt').dataset['focused']).toBe('true');
    });

    it('keeps everything when the delete is cancelled', async () => {
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'a.txt');

        await harness.callAsync('deletePathsAsync', ['a.txt']);

        expect(textOf(harness.folder, 'a.txt')).toBe('alpha\n');
        expect(openPaths(harness)).toEqual(['a.txt']);
    });
});

describe('App moving and copying entries', () => {
    it('moves a binary file into a folder byte for byte and its tab follows', async () => {
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'image.bin');
        answerDialogs({ outcome: 'yes' });

        await harness.callAsync('promptMoveOrCopyAsync', ['image.bin'], 'docs');

        expect(harness.folder.find('image.bin')).toBeNull();
        expect(bytesOf(harness.folder, 'docs/image.bin')).toEqual([...BINARY]);
        expect(openPaths(harness)).toEqual(['docs/image.bin']);
        expect(dialogRequests()[0]).toMatchObject({ title: 'Move or copy', body: 'Move or copy the item into the target folder?' });
    });

    it('copies a binary file into a folder and leaves the original', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'no' });

        await harness.callAsync('promptMoveOrCopyAsync', ['image.bin'], 'docs');

        expect(bytesOf(harness.folder, 'image.bin')).toEqual([...BINARY]);
        expect(bytesOf(harness.folder, 'docs/image.bin')).toEqual([...BINARY]);
        expect(toastTexts()).toContain('1 item copied.');
    });

    it('copies a folder with everything inside it', async () => {
        harness.folder.addDirectory('archive');
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'no' });

        await harness.callAsync('promptMoveOrCopyAsync', ['docs'], 'archive');

        expect(textOf(harness.folder, 'archive/docs/readme.md')).toBe('# Readme\n');
        expect(textOf(harness.folder, 'docs/readme.md')).toBe('# Readme\n');
    });

    it('gives a copy a free name when the target folder already has one, even while collapsed', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'no' });

        await harness.callAsync('promptMoveOrCopyAsync', ['a.txt'], 'docs');

        expect(textOf(harness.folder, 'docs/a.txt')).toBe('docs alpha\n');
        expect(textOf(harness.folder, 'docs/a-copy.txt')).toBe('alpha\n');
    });

    it('does nothing when the move-or-copy prompt is dismissed', async () => {
        await openHarnessWorkspaceAsync(harness);

        await harness.callAsync('promptMoveOrCopyAsync', ['a.txt'], 'docs');

        expect(textOf(harness.folder, 'a.txt')).toBe('alpha\n');
        expect(harness.folder.find('docs/a-copy.txt')).toBeNull();
    });

    it('asks nothing, and moves or copies nothing, for an entry already in the target folder', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'yes' });

        await harness.callAsync('promptMoveOrCopyAsync', ['docs/a.txt'], 'docs');

        expect(textOf(harness.folder, 'docs/a.txt')).toBe('docs alpha\n');
        expect(harness.folder.find('docs/a-copy.txt')).toBeNull();
        expect(dialogRequests()).toEqual([]);
        expect(toastTexts()).toEqual([]);
    });
});

describe('App name collisions on move', () => {
    it('asks about a name the collapsed target folder already has', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'yes' });

        await harness.callAsync('promptMoveOrCopyAsync', ['a.txt'], 'docs');

        expect(dialogRequests()[1]).toMatchObject({
            title: 'Name already exists',
            body: 'An item named "a.txt" already exists in docs/.',
        });
        expect(textOf(harness.folder, 'a.txt')).toBe('alpha\n');
        expect(textOf(harness.folder, 'docs/a.txt')).toBe('docs alpha\n');
    });

    it('replaces the existing entry when Replace is picked', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'yes' }, { outcome: 'button', id: 'replace' });

        await harness.callAsync('promptMoveOrCopyAsync', ['a.txt'], 'docs');

        expect(harness.folder.find('a.txt')).toBeNull();
        expect(textOf(harness.folder, 'docs/a.txt')).toBe('alpha\n');
    });

    it('keeps both entries under a free name when Keep both is picked', async () => {
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'a.txt');
        answerDialogs({ outcome: 'yes' }, { outcome: 'button', id: 'keep-both' });

        await harness.callAsync('promptMoveOrCopyAsync', ['a.txt'], 'docs');

        expect(harness.folder.find('a.txt')).toBeNull();
        expect(textOf(harness.folder, 'docs/a.txt')).toBe('docs alpha\n');
        expect(textOf(harness.folder, 'docs/a-copy.txt')).toBe('alpha\n');
        expect(openPaths(harness)).toEqual(['docs/a-copy.txt']);
    });

    it('leaves the colliding entry alone but moves the rest when Skip is picked', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'yes' }, { outcome: 'button', id: 'skip' });

        await harness.callAsync('promptMoveOrCopyAsync', ['a.txt', 'b.txt'], 'docs');

        expect(textOf(harness.folder, 'a.txt')).toBe('alpha\n');
        expect(textOf(harness.folder, 'docs/a.txt')).toBe('docs alpha\n');
        expect(harness.folder.find('b.txt')).toBeNull();
        expect(textOf(harness.folder, 'docs/b.txt')).toBe('bravo\n');
    });

    it('moves nothing when the collision prompt is cancelled', async () => {
        await openHarnessWorkspaceAsync(harness);
        answerDialogs({ outcome: 'yes' }, { outcome: 'cancel' });

        await harness.callAsync('promptMoveOrCopyAsync', ['a.txt', 'b.txt'], 'docs');

        expect(textOf(harness.folder, 'a.txt')).toBe('alpha\n');
        expect(textOf(harness.folder, 'b.txt')).toBe('bravo\n');
    });
});

describe('App directory watcher', () => {
    type ObserverRecord = { type: string; relativePathComponents: string[] };

    class FakeObserver {
        static latest: FakeObserver | null = null;

        disconnected = false;

        constructor(readonly callback: (records: ReadonlyArray<ObserverRecord>) => void) {
            FakeObserver.latest = this;
        }

        async observe(): Promise<void> {}

        disconnect(): void {
            this.disconnected = true;
        }
    }

    async function activateAsync(): Promise<void> {
        await harness.callAsync('activateWorkspaceAsync', { id: 'w1', handle: asRoot(harness.folder), name: 'workspace' });
        await harness.callAsync('openFileAsync', 'a.txt');
        await harness.callAsync('openFileAsync', 'b.txt');
    }

    function changeOnDisk(path: string, text: string): void {
        (harness.folder.find(path) as FakeFileHandle).data = new TextEncoder().encode(text);
        FakeObserver.latest!.callback([{ type: 'modified', relativePathComponents: path.split('/') }]);
    }

    async function waitForRefreshAsync(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 200));
        await settleAsync();
    }

    beforeEach(() => {
        FakeObserver.latest = null;
        vi.stubGlobal('FileSystemObserver', FakeObserver);
    });

    it('reloads an unchanged open file when it changes on disk', async () => {
        await activateAsync();

        changeOnDisk('a.txt', 'alpha from disk\n');
        await waitForRefreshAsync();

        expect(harness.state().openFiles[0]).toMatchObject({ path: 'a.txt', text: 'alpha from disk\n', originalText: 'alpha from disk\n', dirty: false });
    });

    it('keeps the edits of a dirty file and warns that it changed on disk', async () => {
        await activateAsync();
        markChange(harness, 'b.txt', 'my edits\n');

        changeOnDisk('b.txt', 'bravo from disk\n');
        await waitForRefreshAsync();

        expect(harness.state().openFiles[1]).toMatchObject({ path: 'b.txt', text: 'my edits\n', originalText: 'bravo\n', dirty: true });
        expect(toastTexts()).toContain('b.txt changed on disk; local edits kept.');
    });

    it('does not reload a file whose line endings alone changed on disk, and saves it with the new ending', async () => {
        await activateAsync();
        const before = harness.state().openFiles[0];

        changeOnDisk('a.txt', 'alpha\r\n');
        await waitForRefreshAsync();

        expect(harness.state().openFiles[0]).toMatchObject({ text: before?.text, originalText: before?.originalText, dirty: false, lineEnding: '\r\n' });

        markChange(harness, 'a.txt', 'alpha\nmore\n');
        await harness.callAsync('saveAsync', 'a.txt');

        expect(textOf(harness.folder, 'a.txt')).toBe('alpha\r\nmore\r\n');
    });

    it('reloads a real change on disk and saves the file with the line ending it has now', async () => {
        await activateAsync();

        changeOnDisk('a.txt', 'alpha\r\nfrom disk\r\n');
        await waitForRefreshAsync();

        expect(harness.state().openFiles[0]).toMatchObject({ text: 'alpha\nfrom disk\n', dirty: false, lineEnding: '\r\n' });

        markChange(harness, 'a.txt', 'alpha\nfrom disk\nedited\n');
        await harness.callAsync('saveAsync', 'a.txt');

        expect(textOf(harness.folder, 'a.txt')).toBe('alpha\r\nfrom disk\r\nedited\r\n');
    });

    it('shows files created on disk in the explorer', async () => {
        await activateAsync();

        harness.folder.addFile('fresh.txt', 'new');
        FakeObserver.latest!.callback([{ type: 'appeared', relativePathComponents: ['fresh.txt'] }]);
        await waitForRefreshAsync();

        expect(treeRow('fresh.txt')).toBeDefined();
    });

    it('stops watching when the app is disposed', async () => {
        await activateAsync();

        harness.app.dispose();

        expect(FakeObserver.latest?.disconnected).toBe(true);
    });
});
