import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asRoot, FakeDirectoryHandle, FakeFileHandle } from '../../common/fs/testing/fakeFileSystem.js';
import { WORKSPACE_CONFIG_PATH } from '../../common/fs/workspaceConfig.js';
import { addWorkspaceAsync, removeWorkspaceAsync, setActiveWorkspaceAsync } from '../../common/fs/workspaceRegistry.js';
import type { WorkspaceRecord } from '../../common/fs/workspaceRegistry.js';
import { createAppHarness, markChange, openHarnessWorkspaceAsync, type AppHarness } from '../testing/appHarness.js';
import { showDialogAsync, type DialogRequest, type DialogResult } from './dialog.js';
import type { DroppedFile, DroppedFolder } from './droppedItems.js';
import { toastTexts } from '../testing/testHelpers.js';

vi.mock('./dialog.js', () => ({
    showDialogAsync: vi.fn(),
}));

vi.mock('../../common/fs/workspaceRegistry.js', () => ({
    addWorkspaceAsync: vi.fn(),
    findWorkspaceAsync: vi.fn(async () => null),
    getActiveWorkspaceAsync: vi.fn(async () => null),
    listWorkspacesAsync: vi.fn(async () => []),
    removeWorkspaceAsync: vi.fn(async () => {}),
    setActiveWorkspaceAsync: vi.fn(async () => {}),
}));

const SAVE_ALL: DialogResult = { outcome: 'button', id: 'save' };
const DISCARD: DialogResult = { outcome: 'button', id: 'discard' };
const CANCEL: DialogResult = { outcome: 'button', id: 'cancel' };
const YES: DialogResult = { outcome: 'yes' };

let harness: AppHarness;
let other: FakeDirectoryHandle;
let otherRecord: WorkspaceRecord;

function answerDialogs(...answers: DialogResult[]): void {
    for (const answer of answers) {
        vi.mocked(showDialogAsync).mockResolvedValueOnce(answer);
    }
}

function dialogRequests(): DialogRequest[] {
    return vi.mocked(showDialogAsync).mock.calls.map(([request]) => request);
}

function unsavedPrompt(): DialogRequest | undefined {
    return dialogRequests().find((request) => request.title === 'Unsaved changes');
}

function disk(path: string): string {
    return (harness.folder.find(path) as FakeFileHandle).text;
}

function dirtyPaths(): string[] {
    return harness.state().openFiles.filter((file) => file.dirty).map((file) => file.path);
}

async function editTwoFilesAsync(): Promise<void> {
    await harness.callAsync('openFileAsync', 'a.txt', { preview: false });
    await harness.callAsync('openFileAsync', 'docs/c.txt', { preview: false });
    await harness.callAsync('openFileAsync', 'b.txt', { preview: false });
    markChange(harness, 'a.txt', 'alpha edited\n');
    markChange(harness, 'docs/c.txt', 'charlie edited\n');
}

async function openOutsideFileAsync(): Promise<string> {
    const desktop = new FakeDirectoryHandle('desktop');
    const handle = desktop.addFile('notes.txt', 'notes\n');
    const item: DroppedFile = {
        kind: 'file',
        name: 'notes.txt',
        handle: handle as unknown as FileSystemFileHandle,
        readAsync: async () => await handle.getFile(),
    };
    await harness.callAsync('openExternalFileAsync', item);
    const path = harness.state().openFiles.find((file) => file.external != null)!.path;
    markChange(harness, path, 'notes edited\n');

    return path;
}

beforeEach(async () => {
    vi.mocked(showDialogAsync).mockReset();
    vi.mocked(showDialogAsync).mockResolvedValue({ outcome: 'cancel' });
    vi.mocked(addWorkspaceAsync).mockReset();
    vi.mocked(removeWorkspaceAsync).mockClear();
    vi.mocked(setActiveWorkspaceAsync).mockClear();
    harness = createAppHarness({ 'a.txt': 'alpha\n', 'b.txt': 'bravo\n', 'docs/c.txt': 'charlie\n' });
    await openHarnessWorkspaceAsync(harness);
    other = new FakeDirectoryHandle('other');
    other.addFile('z.txt', 'zulu\n');
    otherRecord = { id: 'w2', name: 'other', handle: asRoot(other) };
    vi.mocked(addWorkspaceAsync).mockResolvedValue(otherRecord);
    harness.store.update({
        workspaces: [{ id: 'w1', name: 'workspace', handle: asRoot(harness.folder) }, otherRecord],
    });
});

afterEach(() => {
    harness.app.dispose();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
});

describe('App unsaved edits before Open folder…', () => {
    beforeEach(() => {
        vi.stubGlobal('showDirectoryPicker', vi.fn(async () => other));
    });

    it('lists every unsaved workspace file by its path in the workspace with Save all, Discard and Cancel', async () => {
        await editTwoFilesAsync();

        await harness.callAsync('pickWorkspaceAsync');

        expect(unsavedPrompt()).toMatchObject({
            body: '2 files have unsaved changes. Save them before leaving the workspace?',
            paths: [{ label: 'Unsaved', path: 'a.txt' }, { label: 'Unsaved', path: 'docs/c.txt' }],
            kind: {
                kind: 'buttons',
                buttons: [
                    { id: 'cancel', label: 'Cancel' },
                    { id: 'discard', label: 'Discard', tone: 'danger' },
                    { id: 'save', label: 'Save all', tone: 'primary', primary: true },
                ],
            },
        });
    });

    it('saves every unsaved file, then opens the folder', async () => {
        await editTwoFilesAsync();
        answerDialogs(SAVE_ALL);

        await harness.callAsync('pickWorkspaceAsync');

        expect(disk('a.txt')).toBe('alpha edited\n');
        expect(disk('docs/c.txt')).toBe('charlie edited\n');
        expect(disk('b.txt')).toBe('bravo\n');
        expect(harness.state().workspace?.id).toBe('w2');
    });

    it('opens the folder without saving on Discard', async () => {
        await editTwoFilesAsync();
        answerDialogs(DISCARD);

        await harness.callAsync('pickWorkspaceAsync');

        expect(disk('a.txt')).toBe('alpha\n');
        expect(harness.state().workspace?.id).toBe('w2');
        expect(harness.state().openFiles).toEqual([]);
    });

    it.each([
        ['Cancel', CANCEL],
        ['closing the dialog', { outcome: 'cancel' } as DialogResult],
    ])('keeps the workspace and its edits on %s, without registering the folder', async (_label, answer) => {
        await editTwoFilesAsync();
        answerDialogs(answer);

        await harness.callAsync('pickWorkspaceAsync');

        expect(addWorkspaceAsync).not.toHaveBeenCalled();
        expect(harness.state().workspace?.id).toBe('w1');
        expect(dirtyPaths()).toEqual(['a.txt', 'docs/c.txt']);
        expect(disk('a.txt')).toBe('alpha\n');
    });

    it('asks nothing when no workspace file has unsaved edits', async () => {
        await harness.callAsync('openFileAsync', 'a.txt', { preview: false });

        await harness.callAsync('pickWorkspaceAsync');

        expect(showDialogAsync).not.toHaveBeenCalled();
        expect(harness.state().workspace?.id).toBe('w2');
    });

    it('keeps everything when the open workspace folder is picked again', async () => {
        vi.stubGlobal('showDirectoryPicker', vi.fn(async () => harness.folder));
        await editTwoFilesAsync();

        await harness.callAsync('pickWorkspaceAsync');

        expect(showDialogAsync).not.toHaveBeenCalled();
        expect(addWorkspaceAsync).not.toHaveBeenCalled();
        expect(dirtyPaths()).toEqual(['a.txt', 'docs/c.txt']);
        expect(toastTexts()).toContain('workspace is already the open workspace.');
    });

    it('stops at a file that fails to save and leaves the workspace open', async () => {
        await editTwoFilesAsync();
        (harness.folder.find('a.txt') as FakeFileHandle).createWritable = async () => {
            throw new Error('Disk full.');
        };
        answerDialogs(SAVE_ALL);

        await harness.callAsync('pickWorkspaceAsync');

        expect(harness.state().workspace?.id).toBe('w1');
        expect(addWorkspaceAsync).not.toHaveBeenCalled();
        expect(disk('docs/c.txt')).toBe('charlie\n');
        expect(dirtyPaths()).toEqual(['a.txt', 'docs/c.txt']);
        expect(toastTexts()).toEqual(expect.arrayContaining(['Disk full.', 'a.txt was not saved, so the workspace stays as it is.']));
    });

    it('leaves an unsaved file from outside the workspace out of the prompt and keeps it open with its edits', async () => {
        await editTwoFilesAsync();
        const outside = await openOutsideFileAsync();
        answerDialogs(DISCARD);

        await harness.callAsync('pickWorkspaceAsync');

        expect(unsavedPrompt()?.paths?.map((entry) => entry.path)).toEqual(['a.txt', 'docs/c.txt']);
        expect(harness.state().workspace?.id).toBe('w2');
        expect(dirtyPaths()).toEqual([outside]);
    });

    it('asks nothing when only a file from outside the workspace has unsaved edits', async () => {
        await openOutsideFileAsync();

        await harness.callAsync('pickWorkspaceAsync');

        expect(showDialogAsync).not.toHaveBeenCalled();
        expect(harness.state().workspace?.id).toBe('w2');
    });
});

describe('App refused folder access', () => {
    it('warns and keeps the workspace when Chrome blocks folder access in the picker', async () => {
        vi.stubGlobal('showDirectoryPicker', vi.fn(async () => {
            throw new DOMException('Access to the folder was blocked.', 'NotAllowedError');
        }));

        await harness.callAsync('pickWorkspaceAsync');

        expect(toastTexts()).toEqual(['Nib Studio was not allowed to open the folder, so workspace stays open.']);
        expect(document.querySelector('.toast')?.getAttribute('data-tone')).toBe('warn');
        expect(addWorkspaceAsync).not.toHaveBeenCalled();
        expect(setActiveWorkspaceAsync).not.toHaveBeenCalled();
        expect(harness.state().workspace?.id).toBe('w1');
    });

    it('stays silent on a cancelled picker, which Chrome also reports for a prompt refused inside it', async () => {
        vi.stubGlobal('showDirectoryPicker', vi.fn(async () => {
            throw new DOMException('The user aborted a request.', 'AbortError');
        }));

        await harness.callAsync('pickWorkspaceAsync');

        expect(toastTexts()).toEqual([]);
        expect(addWorkspaceAsync).not.toHaveBeenCalled();
        expect(harness.state().workspace?.id).toBe('w1');
    });

    it('warns, and neither remembers nor activates the folder, when write access to a picked folder is refused', async () => {
        other.permission = 'denied';
        vi.stubGlobal('showDirectoryPicker', vi.fn(async () => other));
        await harness.callAsync('openFileAsync', 'a.txt', { preview: false });

        await harness.callAsync('pickWorkspaceAsync');

        expect(other.permissionRequests).toEqual(['readwrite']);
        expect(toastTexts()).toEqual(['Nib Studio was not allowed to open other, so workspace stays open.']);
        expect(addWorkspaceAsync).not.toHaveBeenCalled();
        expect(setActiveWorkspaceAsync).not.toHaveBeenCalled();
        expect(harness.state().workspace?.id).toBe('w1');
        expect(harness.state().openFiles.map((file) => file.path)).toEqual(['a.txt']);
        expect(dialogRequests()).toEqual([]);
    });

    it('asks nothing about unsaved files before access is granted', async () => {
        other.permission = 'denied';
        vi.stubGlobal('showDirectoryPicker', vi.fn(async () => other));
        await editTwoFilesAsync();

        await harness.callAsync('pickWorkspaceAsync');

        expect(unsavedPrompt()).toBeUndefined();
        expect(dirtyPaths()).toEqual(['a.txt', 'docs/c.txt']);
    });

    it('keeps the workspace, and the one saved as active, when switching to a folder whose access is refused', async () => {
        other.permission = 'denied';

        await harness.callAsync('switchWorkspaceAsync', 'w2');

        expect(toastTexts()).toEqual(['Nib Studio was not allowed to open other, so workspace stays open.']);
        expect(setActiveWorkspaceAsync).not.toHaveBeenCalled();
        expect(harness.state().workspace?.id).toBe('w1');
    });

    it('neither remembers nor activates a dropped folder whose access is refused', async () => {
        other.permission = 'denied';
        answerDialogs(YES);

        await harness.callAsync('offerFolderAsWorkspaceAsync', {
            kind: 'directory',
            name: 'other',
            handle: asRoot(other),
            listAsync: async () => [],
        } satisfies DroppedFolder);

        expect(addWorkspaceAsync).not.toHaveBeenCalled();
        expect(setActiveWorkspaceAsync).not.toHaveBeenCalled();
        expect(harness.state().workspace?.id).toBe('w1');
    });
});

describe('App unsaved edits before switching to a remembered workspace', () => {
    it('saves every unsaved file, then switches', async () => {
        await editTwoFilesAsync();
        answerDialogs(SAVE_ALL);

        await harness.callAsync('switchWorkspaceAsync', 'w2');

        expect(disk('a.txt')).toBe('alpha edited\n');
        expect(disk('docs/c.txt')).toBe('charlie edited\n');
        expect(setActiveWorkspaceAsync).toHaveBeenCalledWith('w2');
        expect(harness.state().workspace?.id).toBe('w2');
    });

    it('switches without saving on Discard', async () => {
        await editTwoFilesAsync();
        answerDialogs(DISCARD);

        await harness.callAsync('switchWorkspaceAsync', 'w2');

        expect(disk('a.txt')).toBe('alpha\n');
        expect(harness.state().workspace?.id).toBe('w2');
    });

    it('stays on Cancel', async () => {
        await editTwoFilesAsync();
        answerDialogs(CANCEL);

        await harness.callAsync('switchWorkspaceAsync', 'w2');

        expect(setActiveWorkspaceAsync).not.toHaveBeenCalled();
        expect(harness.state().workspace?.id).toBe('w1');
        expect(dirtyPaths()).toEqual(['a.txt', 'docs/c.txt']);
    });
});

describe('App unsaved edits before a dropped folder becomes the workspace', () => {
    function droppedOther(): DroppedFolder {
        return { kind: 'directory', name: 'other', handle: asRoot(other), listAsync: async () => [] };
    }

    it('asks after Open, then saves every unsaved file and switches', async () => {
        await editTwoFilesAsync();
        answerDialogs(YES, SAVE_ALL);

        await harness.callAsync('offerFolderAsWorkspaceAsync', droppedOther());

        expect(dialogRequests().map((request) => request.title)).toEqual(['Open folder', 'Unsaved changes']);
        expect(disk('a.txt')).toBe('alpha edited\n');
        expect(harness.state().workspace?.id).toBe('w2');
    });

    it('switches without saving on Discard', async () => {
        await editTwoFilesAsync();
        answerDialogs(YES, DISCARD);

        await harness.callAsync('offerFolderAsWorkspaceAsync', droppedOther());

        expect(disk('a.txt')).toBe('alpha\n');
        expect(harness.state().workspace?.id).toBe('w2');
    });

    it('stays on Cancel', async () => {
        await editTwoFilesAsync();
        answerDialogs(YES, CANCEL);

        await harness.callAsync('offerFolderAsWorkspaceAsync', droppedOther());

        expect(addWorkspaceAsync).not.toHaveBeenCalled();
        expect(harness.state().workspace?.id).toBe('w1');
        expect(dirtyPaths()).toEqual(['a.txt', 'docs/c.txt']);
    });
});

describe('App unsaved edits before forgetting the open workspace', () => {
    it('asks after the Forget confirmation, then saves every unsaved file and closes the workspace', async () => {
        await editTwoFilesAsync();
        answerDialogs(YES, SAVE_ALL);

        await harness.callAsync('forgetWorkspaceAsync', 'w1');

        expect(dialogRequests().map((request) => request.title)).toEqual(['Forget workspace', 'Unsaved changes']);
        expect(disk('a.txt')).toBe('alpha edited\n');
        expect(disk('docs/c.txt')).toBe('charlie edited\n');
        expect(removeWorkspaceAsync).toHaveBeenCalledWith('w1');
        expect(harness.state().workspace).toBeNull();
    });

    it('forgets without saving on Discard', async () => {
        await editTwoFilesAsync();
        answerDialogs(YES, DISCARD);

        await harness.callAsync('forgetWorkspaceAsync', 'w1');

        expect(disk('a.txt')).toBe('alpha\n');
        expect(harness.state().workspace).toBeNull();
    });

    it('keeps files from outside the workspace and compares with no workspace file side, and closes the rest', async () => {
        const outsidePath = await openOutsideFileAsync();
        const scratch = harness.app.newCompare('text');
        const outsideCompare = harness.app.openDiff(
            { label: 'notes.txt', path: 'notes.txt', source: 'disk', text: 'from disk\n' },
            { label: 'Clipboard', source: 'clipboard', text: 'from the clipboard\n' },
        );
        harness.app.openDiff(
            { label: 'a.txt', path: 'a.txt', source: 'file', text: 'alpha\n' },
            { label: 'Clipboard', source: 'clipboard', text: 'from the clipboard\n' },
        );
        await harness.callAsync('openFileAsync', 'b.txt', { preview: false });
        answerDialogs(YES);

        await harness.callAsync('forgetWorkspaceAsync', 'w1');

        expect(harness.state().workspace).toBeNull();
        expect(harness.state().openFiles.map((file) => file.path)).toEqual([outsidePath]);
        expect(harness.state().diffTabs.map((tab) => tab.id)).toEqual([scratch.id, outsideCompare.id]);
        expect(harness.state().tabOrder).toEqual([outsidePath, scratch.id, outsideCompare.id]);
        expect(harness.state().activePath).toBe(outsidePath);
    });

    it('keeps the workspace remembered and open on Cancel', async () => {
        await editTwoFilesAsync();
        answerDialogs(YES, CANCEL);

        await harness.callAsync('forgetWorkspaceAsync', 'w1');

        expect(removeWorkspaceAsync).not.toHaveBeenCalled();
        expect(harness.state().workspace?.id).toBe('w1');
        expect(dirtyPaths()).toEqual(['a.txt', 'docs/c.txt']);
    });

    it('asks nothing about unsaved files when forgetting another workspace', async () => {
        await editTwoFilesAsync();
        answerDialogs(YES);

        await harness.callAsync('forgetWorkspaceAsync', 'w2');

        expect(unsavedPrompt()).toBeUndefined();
        expect(removeWorkspaceAsync).toHaveBeenCalledWith('w2');
        expect(harness.state().workspace?.id).toBe('w1');
        expect(dirtyPaths()).toEqual(['a.txt', 'docs/c.txt']);
    });
});

describe('App active tab after a workspace change', () => {
    const WORKSPACE_CHANGES: ReadonlyArray<[string, () => Promise<void>]> = [
        ['Open folder…', async () => {
            vi.stubGlobal('showDirectoryPicker', vi.fn(async () => other));
            await harness.callAsync('pickWorkspaceAsync');
        }],
        ['the switcher', async () => {
            await harness.callAsync('switchWorkspaceAsync', 'w2');
        }],
        ['a dropped folder', async () => {
            answerDialogs(YES);
            const dropped: DroppedFolder = { kind: 'directory', name: 'other', handle: asRoot(other), listAsync: async () => [] };
            await harness.callAsync('offerFolderAsWorkspaceAsync', dropped);
        }],
        ['Open as workspace', async () => {
            await harness.callAsync('openAsWorkspaceAsync', 'docs');
        }],
    ];

    function placeholderTitle(): string | null {
        return document.querySelector('.editor-placeholder h2')?.textContent ?? null;
    }

    // A workspace file, a file from outside the workspace, then a compare of pasted text, which ends up the active tab.
    async function openKeptAndWorkspaceTabsAsync(): Promise<{ outside: string; scratch: string }> {
        await harness.callAsync('openFileAsync', 'a.txt', { preview: false });
        const outside = await openOutsideFileAsync();
        const scratch = harness.app.newCompare('text').id;

        return { outside, scratch };
    }

    it.each(WORKSPACE_CHANGES)('makes the first kept tab active after %s when the new workspace restores none', async (_label, changeAsync) => {
        const { outside, scratch } = await openKeptAndWorkspaceTabsAsync();
        expect(harness.state().activePath).toBe(scratch);

        await changeAsync();

        expect(harness.state().workspace?.id).toBe('w2');
        expect(harness.state().tabOrder).toEqual([outside, scratch]);
        expect(harness.state().activePath).toBe(outside);
        expect(document.querySelector<HTMLElement>(`.tab[data-path="${outside}"]`)?.dataset['active']).toBe('true');
        expect(placeholderTitle()).toBeNull();
    });

    it.each(WORKSPACE_CHANGES)('keeps the new workspace\'s own active tab after %s', async (_label, changeAsync) => {
        other.addFile(WORKSPACE_CONFIG_PATH, JSON.stringify({ openFiles: ['z.txt'], activePath: 'z.txt' }));
        const { outside, scratch } = await openKeptAndWorkspaceTabsAsync();

        await changeAsync();

        expect(harness.state().tabOrder).toEqual(expect.arrayContaining([outside, scratch, 'z.txt']));
        expect(harness.state().activePath).toBe('z.txt');
    });

    it('shows No file open when no tab is kept', async () => {
        await harness.callAsync('openFileAsync', 'a.txt', { preview: false });

        await harness.callAsync('switchWorkspaceAsync', 'w2');

        expect(harness.state().tabOrder).toEqual([]);
        expect(harness.state().activePath).toBeNull();
        expect(placeholderTitle()).toBe('No file open');
    });
});
