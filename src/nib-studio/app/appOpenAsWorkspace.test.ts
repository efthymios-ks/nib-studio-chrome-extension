import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asRoot, FakeDirectoryHandle, FakeFileHandle, textOf } from '../../common/fs/testing/fakeFileSystem.js';
import { WORKSPACE_CONFIG_PATH } from '../../common/fs/workspaceConfig.js';
import {
    addWorkspaceAsync,
    getActiveWorkspaceAsync,
    listWorkspacesAsync,
    type WorkspaceRecord,
} from '../../common/fs/workspaceRegistry.js';
import { createAppHarness, markChange, openPaths, treeRow, type AppHarness } from '../testing/appHarness.js';
import { clickDialogButton, settleAsync, toastTexts } from '../testing/testHelpers.js';
import type { Command, CommandContext } from './commands.js';
import type { DroppedFile } from './droppedItems.js';

// The registry runs for real over an in-memory IndexedDB.
const storage = vi.hoisted(() => new Map<IDBValidKey, unknown>());

vi.mock('idb-keyval', () => ({
    get: async (key: IDBValidKey) => storage.get(key),
    set: async (key: IDBValidKey, value: unknown) => {
        storage.set(key, value);
    },
    del: async (key: IDBValidKey) => {
        storage.delete(key);
    },
    entries: async () => [...storage.entries()],
}));

const REPORTS_CONFIG = `reports/${WORKSPACE_CONFIG_PATH}`;

let harness: AppHarness;
let parent: WorkspaceRecord;

function reportsFolder(): FakeDirectoryHandle {
    return harness.folder.find('reports') as FakeDirectoryHandle;
}

function openTreeMenu(target: HTMLElement): void {
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
}

// The open menu's labels from top to bottom, without shortcuts, with each divider between groups as '---'.
function menuEntries(): string[] {
    return [...document.querySelectorAll<HTMLElement>('.context-menu[data-open="true"] > *')]
        .map((node) => (node.classList.contains('context-menu-separator') ? '---' : node.firstElementChild?.textContent ?? ''));
}

function menuItem(label: string): HTMLElement | undefined {
    return [...document.querySelectorAll<HTMLElement>('.context-menu[data-open="true"] .context-menu-item')]
        .find((item) => item.textContent === label);
}

function treePaths(): string[] {
    return [...document.querySelectorAll<HTMLElement>('.tree-row')].map((row) => row.dataset['path'] ?? '');
}

function dirtyPaths(): string[] {
    return harness.state().openFiles.filter((file) => file.dirty).map((file) => file.path);
}

async function registeredNamesAsync(): Promise<string[]> {
    return (await listWorkspacesAsync()).map((workspace) => workspace.name);
}

async function openOutsideFileAsync(): Promise<string> {
    const desktop = new FakeDirectoryHandle('desktop');
    const handle = desktop.addFile('outside.txt', 'outside\n');
    const item: DroppedFile = {
        kind: 'file',
        name: 'outside.txt',
        handle: handle as unknown as FileSystemFileHandle,
        readAsync: async () => await handle.getFile(),
    };
    await harness.callAsync('openExternalFileAsync', item);

    return harness.state().openFiles.find((file) => file.external != null)!.path;
}

// Starts Open as workspace on reports, which waits on the Unsaved changes dialog, and answers it.
async function openReportsAnsweringAsync(answer: string): Promise<void> {
    const pending = harness.callAsync('openAsWorkspaceAsync', 'reports');
    await settleAsync();
    clickDialogButton(answer);
    await pending;
}

beforeEach(async () => {
    storage.clear();
    harness = createAppHarness({
        'README.md': '# Parent\n',
        'notes.txt': 'notes\n',
        'archive/old.txt': 'old\n',
        'reports/summary.txt': 'summary\n',
        'reports/2026/q1.txt': 'quarter one\n',
        [WORKSPACE_CONFIG_PATH]: JSON.stringify({ openFiles: ['README.md'], activePath: 'README.md', expandedPaths: ['reports'] }),
    });
    parent = await addWorkspaceAsync(asRoot(harness.folder));
    harness.store.update({ workspaces: await listWorkspacesAsync() });
    await harness.callAsync('activateWorkspaceAsync', parent);
});

afterEach(() => {
    harness.app.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
    // The context menu is made once per page, so it stays for the next test.
    document.body.replaceChildren(...document.querySelectorAll('.context-menu'));
});

describe('Open as workspace in the Explorer menu', () => {
    it('heads the menu of a folder, in a group of its own', () => {
        openTreeMenu(treeRow('reports'));

        expect(menuEntries().slice(0, 3)).toEqual(['Open as workspace', '---', 'New file']);
    });

    it('is left out for a file', () => {
        openTreeMenu(treeRow('notes.txt'));

        expect(menuEntries()).not.toContain('Open as workspace');
        expect(menuEntries()).toContain('Rename');
    });

    it('is left out while several items are selected, folders only included', () => {
        treeRow('archive').click();
        treeRow('reports').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));

        openTreeMenu(treeRow('reports'));

        expect(menuEntries()).not.toContain('Open as workspace');
        expect(menuEntries()).toContain('Delete');
    });

    it('is left out over the empty area, even with a folder selected', () => {
        treeRow('archive').click();

        openTreeMenu(document.querySelector<HTMLElement>('.tree')!);

        expect(menuEntries()).not.toContain('Open as workspace');
        expect(menuEntries()).toContain('New file');
    });

    it('is left out while no workspace is open', async () => {
        const registry = await harness.callAsync<ReadonlyArray<Command>>('buildCommandRegistry');
        const command = registry.find((candidate) => candidate.id === 'open-as-workspace')!;
        const context: CommandContext = {
            ...await harness.callAsync<CommandContext>('makeCommandContext', 'tree'),
            selectedPaths: ['reports'],
            rowPath: 'reports',
        };

        expect(command.enabledWhen(context)).toBe(true);
        expect(command.enabledWhen({ ...context, workspaceOpen: false })).toBe(false);
    });
});

describe('Open as workspace', () => {
    it('makes the folder the workspace, remembered under its own name, and keeps the old one in the switcher', async () => {
        openTreeMenu(treeRow('reports'));
        menuItem('Open as workspace')!.click();
        await settleAsync();

        const workspace = harness.state().workspace!;
        expect(workspace.name).toBe('reports');
        expect(workspace.handle).toBe(asRoot(reportsFolder()));
        expect(document.querySelector('.workspace-name')?.textContent).toBe('reports');
        expect(treePaths()).toEqual(['2026', 'summary.txt']);
        expect(await registeredNamesAsync()).toEqual(['reports', 'workspace']);
        expect((await getActiveWorkspaceAsync())?.id).toBe(workspace.id);

        document.querySelector<HTMLElement>('.workspace-switch')!.click();

        expect(menuEntries().slice(0, 2)).toEqual(['reports  (active)', 'workspace']);
    });

    it('neither remembers a folder nor offers it after a reload when its access is refused', async () => {
        reportsFolder().permission = 'denied';

        await harness.callAsync('openAsWorkspaceAsync', 'reports');

        expect(toastTexts()).toContain('Nib Studio was not allowed to open reports, so workspace stays open.');
        expect(harness.state().workspace?.id).toBe(parent.id);
        expect(await registeredNamesAsync()).toEqual(['workspace']);
        expect((await getActiveWorkspaceAsync())?.id).toBe(parent.id);
    });

    it('reuses the folder\'s entry when it is opened again', async () => {
        await harness.callAsync('openAsWorkspaceAsync', 'reports');
        const first = harness.state().workspace!.id;
        await harness.callAsync('switchWorkspaceAsync', parent.id);
        expect(harness.state().workspace?.id).toBe(parent.id);

        await harness.callAsync('openAsWorkspaceAsync', 'reports');

        expect(harness.state().workspace?.id).toBe(first);
        expect(await registeredNamesAsync()).toEqual(['reports', 'workspace']);
    });

    describe('with a folder handle remembered from an earlier session', () => {
        let remembered: FakeDirectoryHandle;
        let requestPermission: ReturnType<typeof vi.fn>;

        // The same folder as the tree's, as the registry hands it back: a handle of its own, the same entry on disk,
        // and access that has to be asked for again.
        beforeEach(async () => {
            const folder = reportsFolder();
            remembered = Object.create(folder) as FakeDirectoryHandle;
            requestPermission = vi.fn(async () => 'granted' as PermissionState);
            Object.assign(remembered, {
                isSameEntry: async (other: unknown) => other === folder || other === remembered,
                queryPermission: async () => 'prompt' as PermissionState,
                requestPermission,
            });
            storage.set('nib-studio/workspace/reports-earlier', { handle: remembered, displayName: 'reports', addedAt: 1 });
            harness.store.update({ workspaces: await listWorkspacesAsync() });
        });

        it('opens it through the remembered entry once access is granted again', async () => {
            await harness.callAsync('openAsWorkspaceAsync', 'reports');

            expect(requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
            expect(harness.state().workspace).toMatchObject({ id: 'reports-earlier', name: 'reports' });
            expect(harness.state().workspace?.handle).toBe(remembered);
            expect(treePaths()).toEqual(['2026', 'summary.txt']);
            expect(await registeredNamesAsync()).toEqual(['reports', 'workspace']);
        });

        it('keeps the workspace as it is, and the one saved as active, when access is refused', async () => {
            requestPermission.mockResolvedValue('denied');

            await harness.callAsync('openAsWorkspaceAsync', 'reports');

            expect(toastTexts()).toContain('Nib Studio was not allowed to open reports, so workspace stays open.');
            expect(harness.state().workspace?.id).toBe(parent.id);
            expect(openPaths(harness)).toEqual(['README.md']);
            expect((await getActiveWorkspaceAsync())?.id).toBe(parent.id);
        });
    });

    it('closes the old workspace\'s tabs and opens the folder\'s saved ones, keeping outside tabs and compares with no workspace side', async () => {
        harness.folder.addFile(REPORTS_CONFIG, JSON.stringify({ openFiles: ['2026/q1.txt'], activePath: '2026/q1.txt', expandedPaths: ['2026'] }));
        await harness.callAsync('openFileAsync', 'reports/summary.txt', { preview: false });
        await harness.callAsync('compareTwoSelectedAsync', 'notes.txt', 'archive/old.txt');
        const scratch = harness.app.newCompare('text');
        const outside = await openOutsideFileAsync();

        await harness.callAsync('openAsWorkspaceAsync', 'reports');

        expect(openPaths(harness)).toEqual([outside, '2026/q1.txt']);
        expect(harness.state().activePath).toBe('2026/q1.txt');
        expect(harness.state().diffTabs.map((tab) => tab.id)).toEqual([scratch.id]);
        expect(treePaths()).toEqual(['2026', '2026/q1.txt', WORKSPACE_CONFIG_PATH, 'summary.txt']);
    });

    describe('with unsaved changes', () => {
        let outside: string;

        beforeEach(async () => {
            outside = await openOutsideFileAsync();
            markChange(harness, 'README.md', '# Parent edited\n');
            markChange(harness, outside, 'outside edited\n');
        });

        it('lists the unsaved workspace files, and not the outside one, in the Unsaved changes dialog', async () => {
            const pending = harness.callAsync('openAsWorkspaceAsync', 'reports');
            await settleAsync();

            expect(document.querySelector('.modal')?.textContent).toContain('Unsaved changes');
            expect([...document.querySelectorAll('.dialog-paths-path')].map((path) => path.textContent)).toEqual(['README.md']);
            expect([...document.querySelectorAll('.modal-footer button')].map((button) => button.textContent)).toEqual(['Cancel', 'Discard', 'Save all']);

            clickDialogButton('Cancel');
            await pending;
        });

        it('saves them on Save all, then opens the folder with the outside tab and its edits kept', async () => {
            await openReportsAnsweringAsync('Save all');

            expect(textOf(harness.folder, 'README.md')).toBe('# Parent edited\n');
            expect(harness.state().workspace?.name).toBe('reports');
            expect(openPaths(harness)).toEqual([outside]);
            expect(dirtyPaths()).toEqual([outside]);
        });

        it('opens the folder without saving on Discard', async () => {
            await openReportsAnsweringAsync('Discard');

            expect(textOf(harness.folder, 'README.md')).toBe('# Parent\n');
            expect(harness.state().workspace?.name).toBe('reports');
            expect(openPaths(harness)).toEqual([outside]);
        });

        it('keeps the workspace, its edits and the registry on Cancel', async () => {
            await openReportsAnsweringAsync('Cancel');

            expect(harness.state().workspace?.id).toBe(parent.id);
            expect(dirtyPaths()).toEqual(['README.md', outside]);
            expect(textOf(harness.folder, 'README.md')).toBe('# Parent\n');
            expect(await registeredNamesAsync()).toEqual(['workspace']);
            expect((await getActiveWorkspaceAsync())?.id).toBe(parent.id);
        });
    });

    it('writes the configuration file in the folder on the next change, and leaves the old workspace\'s file alone', async () => {
        vi.useFakeTimers();
        await harness.callAsync('openFileAsync', 'notes.txt', { preview: false });
        await vi.advanceTimersByTimeAsync(1000);
        const parentConfig = harness.folder.find(WORKSPACE_CONFIG_PATH) as FakeFileHandle;
        const parentText = parentConfig.text;
        const parentWrites = parentConfig.writeCount;
        expect(JSON.parse(parentText)).toMatchObject({ openFiles: ['README.md', 'notes.txt'] });

        await harness.callAsync('openAsWorkspaceAsync', 'reports');
        await harness.callAsync('openFileAsync', 'summary.txt', { preview: false });
        await vi.advanceTimersByTimeAsync(1000);

        expect(JSON.parse(textOf(harness.folder, REPORTS_CONFIG))).toMatchObject({ openFiles: ['summary.txt'], activePath: 'summary.txt' });
        expect(parentConfig.text).toBe(parentText);
        expect(parentConfig.writeCount).toBe(parentWrites);
    });

    it('says why when the folder is gone from disk', async () => {
        harness.folder.children.delete('reports');

        await harness.callAsync('openAsWorkspaceAsync', 'reports');

        expect(harness.state().workspace?.id).toBe(parent.id);
        expect(toastTexts()).toContain('reports not found.');
        expect(await registeredNamesAsync()).toEqual(['workspace']);
    });
});
