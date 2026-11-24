import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKSPACE_CONFIG_PATH } from '../../common/fs/workspaceConfig.js';
import { asRoot, FakeDirectoryHandle, FakeFileHandle, textOf } from '../../common/fs/testing/fakeFileSystem.js';
import {
    createAppHarness,
    markChange,
    openHarnessWorkspaceAsync,
    openPaths,
    tabElement,
    treeRow,
    type AppHarness,
} from '../testing/appHarness.js';
import { clickDialogButton, settleAsync, stubMatchMedia } from '../testing/testHelpers.js';
import { NARROW_LAYOUT_QUERY } from './explorerDrawer.js';

function createHarness(): AppHarness {
    return createAppHarness({ 'a.txt': 'alpha\n', 'b.txt': 'bravo\n', 'c.txt': 'charlie\n' });
}

let harness: AppHarness;

afterEach(() => {
    harness.app.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    delete document.documentElement.dataset['theme'];
});

describe('App shell', () => {
    it('labels the header with no workspace before one is opened', () => {
        harness = createHarness();
        (harness.app as unknown as { renderAll: () => void }).renderAll();

        expect(document.querySelector('.workspace-name')?.textContent).toBe('No workspace');
        expect(document.querySelectorAll('.tab')).toHaveLength(0);
    });

    it('shows the workspace name and its files in the explorer', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);

        expect(document.querySelector('.workspace-name')?.textContent).toBe('workspace');
        expect([...document.querySelectorAll<HTMLElement>('.tree-row[data-kind="file"]')].map((row) => row.dataset['path']))
            .toEqual(expect.arrayContaining(['a.txt', 'b.txt', 'c.txt']));
    });

    it('toggles the theme from the header button', () => {
        harness = createHarness();
        document.querySelector<HTMLButtonElement>('.theme-toggle')!.click();

        expect(harness.state().theme).toBe('dark');
        expect(document.documentElement.dataset['theme']).toBe('dark');

        document.querySelector<HTMLButtonElement>('.theme-toggle')!.click();

        expect(harness.state().theme).toBe('light');
    });

    it('switches to the hash surface from the surface tabs', () => {
        harness = createHarness();
        document.querySelector<HTMLButtonElement>('.app-tab[data-surface="hash"]')!.click();

        expect(harness.state().activeSurface).toBe('hash');
        expect(document.querySelector<HTMLElement>('.app-tab[data-surface="hash"]')?.dataset['active']).toBe('true');
    });
});

describe('App opening files', () => {
    it('opens a single-clicked file in a preview tab', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);

        treeRow('a.txt').click();
        await settleAsync();

        expect(openPaths(harness)).toEqual(['a.txt']);
        expect(harness.state().openFiles[0]?.preview).toBe(true);
        expect(harness.state().openFiles[0]?.text).toBe('alpha\n');
        expect(harness.state().activePath).toBe('a.txt');
        expect(tabElement('a.txt')?.dataset['preview']).toBe('true');
        expect(tabElement('a.txt')?.dataset['active']).toBe('true');
    });

    it('replaces the preview tab when another file is single-clicked', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);

        treeRow('a.txt').click();
        await settleAsync();
        treeRow('b.txt').click();
        await settleAsync();

        expect(openPaths(harness)).toEqual(['b.txt']);
        expect(harness.state().activePath).toBe('b.txt');
    });

    it('opens a double-clicked file as a permanent tab that a later preview does not replace', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);

        treeRow('a.txt').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await settleAsync();
        treeRow('b.txt').click();
        await settleAsync();

        expect(openPaths(harness)).toEqual(['a.txt', 'b.txt']);
        expect(harness.state().openFiles.map((file) => file.preview)).toEqual([false, true]);
        expect(tabElement('a.txt')?.dataset['preview']).toBeUndefined();
    });

    it('promotes a preview tab to permanent when its tab is double-clicked', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'a.txt', { preview: true });

        tabElement('a.txt')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

        expect(harness.state().openFiles[0]?.preview).toBe(false);
    });

    it('promotes a preview tab when the same file is opened permanently', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'a.txt', { preview: true });
        await harness.callAsync('openFileAsync', 'a.txt');

        expect(harness.state().openFiles).toHaveLength(1);
        expect(harness.state().openFiles[0]?.preview).toBe(false);
    });

    it('activates an already open file instead of opening it twice', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'a.txt');
        await harness.callAsync('openFileAsync', 'b.txt');

        tabElement('a.txt')!.click();

        expect(openPaths(harness)).toEqual(['a.txt', 'b.txt']);
        expect(harness.state().activePath).toBe('a.txt');
        expect(harness.state().selectedPath).toBe('a.txt');
    });

    it('does nothing without a workspace', async () => {
        harness = createHarness();
        await harness.callAsync('openFileAsync', 'a.txt');

        expect(openPaths(harness)).toEqual([]);
    });

    it('shows a toast and opens no tab when the file is missing', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'missing.txt');

        expect(openPaths(harness)).toEqual([]);
        expect(document.body.textContent).toContain('missing.txt');
    });
});

describe('App narrow layout', () => {
    async function openDrawerAsync(): Promise<void> {
        stubMatchMedia(NARROW_LAYOUT_QUERY, true);
        harness = createHarness();
        harness.folder.addDirectory('docs');
        await openHarnessWorkspaceAsync(harness);
        document.querySelector<HTMLElement>('.split-resizer')!.click();
    }

    it('closes the Explorer drawer when a file is picked', async () => {
        await openDrawerAsync();
        expect(document.body.dataset['explorerDrawer']).toBe('open');

        treeRow('a.txt').click();
        await settleAsync();

        expect(document.body.dataset['explorerDrawer']).toBeUndefined();
        expect(harness.state().activePath).toBe('a.txt');
    });

    it('closes the Explorer drawer when a file is opened with a double-click', async () => {
        await openDrawerAsync();

        treeRow('b.txt').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await settleAsync();

        expect(document.body.dataset['explorerDrawer']).toBeUndefined();
    });

    it('keeps the Explorer drawer open while browsing folders', async () => {
        await openDrawerAsync();

        treeRow('docs').click();
        await settleAsync();

        expect(document.body.dataset['explorerDrawer']).toBe('open');
    });
});

describe('App editing and saving', () => {
    it('marks an edited file dirty, promotes its preview tab, and clears dirty when reverted', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'a.txt', { preview: true });

        markChange(harness, 'a.txt', 'changed\n');

        expect(harness.state().openFiles[0]?.dirty).toBe(true);
        expect(harness.state().openFiles[0]?.preview).toBe(false);
        expect(tabElement('a.txt')?.dataset['dirty']).toBe('true');

        markChange(harness, 'a.txt', 'alpha\n');

        expect(harness.state().openFiles[0]?.dirty).toBe(false);
    });

    it('writes the text to disk on save and clears the dirty flag', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'a.txt');
        markChange(harness, 'a.txt', 'saved text\n');

        await harness.callAsync('saveAsync', 'a.txt');

        expect(textOf(harness.folder, 'a.txt')).toBe('saved text\n');
        expect(harness.state().openFiles[0]?.dirty).toBe(false);
        expect(harness.state().openFiles[0]?.originalText).toBe('saved text\n');
    });

    it('never writes a large table back to disk', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'a.txt');
        harness.store.update({ openFiles: harness.state().openFiles.map((file) => ({ ...file, large: true, text: '' })) });

        await harness.callAsync('saveAsync', 'a.txt');

        expect(textOf(harness.folder, 'a.txt')).toBe('alpha\n');
    });
});

describe('App closing tabs', () => {
    async function openThreeAsync(): Promise<void> {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'a.txt');
        await harness.callAsync('openFileAsync', 'b.txt');
        await harness.callAsync('openFileAsync', 'c.txt');
    }

    it('closes a tab from its close button and activates the tab to its right', async () => {
        await openThreeAsync();
        harness.store.update({ activePath: 'b.txt' });

        tabElement('b.txt')!.querySelector<HTMLButtonElement>('.tab-close')!.click();
        await settleAsync();

        expect(openPaths(harness)).toEqual(['a.txt', 'c.txt']);
        expect(harness.state().activePath).toBe('c.txt');
    });

    it('activates the tab to the left when the last tab closes', async () => {
        await openThreeAsync();

        await harness.callAsync('closeFileAsync', 'c.txt');

        expect(harness.state().activePath).toBe('b.txt');
    });

    it('keeps the active tab when an inactive tab closes', async () => {
        await openThreeAsync();
        harness.store.update({ activePath: 'a.txt' });

        await harness.callAsync('closeFileAsync', 'c.txt');

        expect(harness.state().activePath).toBe('a.txt');
    });

    it('asks before closing a dirty tab and keeps it when cancelled', async () => {
        await openThreeAsync();
        markChange(harness, 'b.txt', 'edited');

        const pending = harness.callAsync('closeFileAsync', 'b.txt');
        await settleAsync();
        expect(document.querySelector('.modal')?.textContent).toContain('Discard unsaved changes in b.txt?');
        clickDialogButton('Cancel');
        await pending;

        expect(openPaths(harness)).toContain('b.txt');
    });

    it('closes a dirty tab once the discard is confirmed', async () => {
        await openThreeAsync();
        markChange(harness, 'b.txt', 'edited');

        const pending = harness.callAsync('closeFileAsync', 'b.txt');
        await settleAsync();
        clickDialogButton('Discard');
        await pending;

        expect(openPaths(harness)).toEqual(['a.txt', 'c.txt']);
    });

    it('closes the other tabs and activates the kept one', async () => {
        await openThreeAsync();

        await harness.callAsync('closeOthersAsync', 'b.txt');

        expect(openPaths(harness)).toEqual(['b.txt']);
        expect(harness.state().activePath).toBe('b.txt');
    });

    it('closes the tabs to the right and moves activation onto the kept tab', async () => {
        await openThreeAsync();

        await harness.callAsync('closeToRightAsync', 'a.txt');

        expect(openPaths(harness)).toEqual(['a.txt']);
        expect(harness.state().activePath).toBe('a.txt');
    });

    it('closes every tab, diff tabs included', async () => {
        await openThreeAsync();
        harness.app.newCompare('text');

        await harness.callAsync('closeAllAsync');

        expect(harness.state().openFiles).toEqual([]);
        expect(harness.state().diffTabs).toEqual([]);
        expect(harness.state().activePath).toBeNull();
    });
});

describe('App compare entry points', () => {
    it('opens an empty compare of the chosen kind as the active tab', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        harness.store.update({ activeSurface: 'hash' });

        const tab = harness.app.newCompare('json');

        expect(tab.diffKind).toBe('json');
        expect(tab.scratch).toBeDefined();
        expect(harness.state().activePath).toBe(tab.id);
        expect(harness.state().activeSurface).toBe('files');
        expect(document.querySelector('.tab[data-kind="diff"]')).not.toBeNull();
    });

    it('opens a diff of two given sides', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);

        const tab = harness.app.openDiff(
            { label: 'left', source: 'paste', text: 'one' },
            { label: 'right', source: 'paste', text: 'two' },
        );

        expect(harness.state().diffTabs).toEqual([tab]);
        expect(harness.state().activePath).toBe(tab.id);
    });

    it('opens the new-compare menu from the tab bar and creates the picked kind', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'a.txt');

        document.querySelector<HTMLButtonElement>('[data-action="new-compare"]')!.click();
        const items = [...document.querySelectorAll<HTMLElement>('.context-menu [role="menuitem"], .context-menu button')];
        expect(items.length).toBeGreaterThan(0);
        items[0]!.click();

        expect(harness.state().diffTabs).toHaveLength(1);
        expect(harness.state().activePath).toBe(harness.state().diffTabs[0]?.id);
    });
});

describe('App workspace configuration', () => {
    it('writes the configuration once, after changes settle', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'a.txt');
        await settleAsync();
        harness.folder.children.delete(WORKSPACE_CONFIG_PATH);
        vi.useFakeTimers();

        await harness.callAsync('openFileAsync', 'b.txt');
        harness.store.update({ activePath: 'a.txt' });
        await vi.advanceTimersByTimeAsync(399);

        expect(harness.folder.find(WORKSPACE_CONFIG_PATH)).toBeNull();

        await vi.advanceTimersByTimeAsync(1);

        const config = harness.folder.find(WORKSPACE_CONFIG_PATH) as FakeFileHandle;
        expect(config.writeCount).toBe(1);
        expect(JSON.parse(config.text)).toMatchObject({
            openFiles: ['a.txt', 'b.txt'],
            activePath: 'a.txt',
            activeSurface: 'files',
        });
    });

    it('shows the configuration file in the tree once the studio first writes it, and reads the tree for it only that once', async () => {
        vi.useFakeTimers();
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        const refreshTree = vi.spyOn(harness.app as unknown as { refreshTreeAsync: () => Promise<void> }, 'refreshTreeAsync');
        expect(document.querySelector(`.tree-row[data-path="${WORKSPACE_CONFIG_PATH}"]`)).toBeNull();

        await vi.advanceTimersByTimeAsync(1000);

        expect(treeRow(WORKSPACE_CONFIG_PATH)).toBeDefined();
        expect(refreshTree).toHaveBeenCalledTimes(1);

        await harness.callAsync('openFileAsync', 'a.txt');
        await vi.advanceTimersByTimeAsync(1000);

        expect(JSON.parse(textOf(harness.folder, WORKSPACE_CONFIG_PATH))).toMatchObject({ openFiles: ['a.txt'] });
        expect(refreshTree).toHaveBeenCalledTimes(1);
    });

    it('leaves the tree alone when the configuration file is there already', async () => {
        vi.useFakeTimers();
        harness = createHarness();
        const config = harness.folder.addFile(WORKSPACE_CONFIG_PATH, '{}');
        await openHarnessWorkspaceAsync(harness);
        const refreshTree = vi.spyOn(harness.app as unknown as { refreshTreeAsync: () => Promise<void> }, 'refreshTreeAsync');

        await vi.advanceTimersByTimeAsync(1000);

        expect(config.writeCount).toBe(1);
        expect(refreshTree).not.toHaveBeenCalled();
    });

    it('restarts the debounce on every change', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        vi.useFakeTimers();
        await vi.advanceTimersByTimeAsync(1000);
        const before = (harness.folder.find(WORKSPACE_CONFIG_PATH) as FakeFileHandle | null)?.writeCount ?? 0;

        harness.store.update({ selectedPath: 'a.txt' });
        await vi.advanceTimersByTimeAsync(300);
        harness.store.update({ selectedPath: 'b.txt' });
        await vi.advanceTimersByTimeAsync(300);

        expect((harness.folder.find(WORKSPACE_CONFIG_PATH) as FakeFileHandle | null)?.writeCount ?? 0).toBe(before);

        await vi.advanceTimersByTimeAsync(100);

        expect((harness.folder.find(WORKSPACE_CONFIG_PATH) as FakeFileHandle).writeCount).toBe(before + 1);
    });

    it('restores open files, the active file and expanded folders when a workspace is activated', async () => {
        harness = createHarness();
        harness.folder.addFile('docs/readme.md', '# Readme\n');
        harness.folder.addFile(WORKSPACE_CONFIG_PATH, JSON.stringify({
            openFiles: ['a.txt', 'docs/readme.md'],
            activePath: 'a.txt',
            expandedPaths: ['docs'],
            activeSurface: 'files',
        }));

        await harness.callAsync('activateWorkspaceAsync', { id: 'w2', handle: asRoot(harness.folder), name: 'workspace' });

        expect(openPaths(harness)).toEqual(['a.txt', 'docs/readme.md']);
        expect(harness.state().activePath).toBe('a.txt');
        expect([...harness.state().expandedPaths]).toEqual(['docs']);
        expect(document.querySelector('.tree-row[data-path="docs/readme.md"]')).not.toBeNull();
    });

    it('does not rewrite the configuration while restoring it', async () => {
        harness = createHarness();
        const config = harness.folder.addFile(WORKSPACE_CONFIG_PATH, JSON.stringify({ openFiles: ['a.txt'] }));
        vi.useFakeTimers();

        const pending = harness.callAsync('activateWorkspaceAsync', { id: 'w2', handle: asRoot(harness.folder), name: 'workspace' });
        await vi.advanceTimersByTimeAsync(0);
        await pending;
        await vi.advanceTimersByTimeAsync(1000);

        expect(config.writeCount).toBe(0);
    });

    it('keeps scratch compares of pasted text when switching workspace but drops the open files', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'a.txt');
        const scratch = harness.app.newCompare('text');
        const other = new FakeDirectoryHandle('other');
        other.addFile('z.txt', 'zulu');

        await harness.callAsync('activateWorkspaceAsync', { id: 'w2', handle: asRoot(other), name: 'other' });

        expect(harness.state().workspace?.name).toBe('other');
        expect(openPaths(harness)).toEqual([]);
        expect(harness.state().diffTabs.map((tab) => tab.id)).toEqual([scratch.id]);
    });

    it('keeps every compare without a workspace file side when switching workspace, and closes the others', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        const outside = harness.app.openDiff(
            { label: 'notes.txt', path: 'notes.txt', source: 'disk', text: 'from disk\n' },
            { label: 'Clipboard', source: 'clipboard', text: 'from the clipboard\n' },
        );
        harness.app.openDiff(
            { label: 'a.txt', path: 'a.txt', source: 'file', text: 'alpha\n' },
            { label: 'Clipboard', source: 'clipboard', text: 'from the clipboard\n' },
        );
        const other = new FakeDirectoryHandle('other');
        other.addFile('z.txt', 'zulu');

        await harness.callAsync('activateWorkspaceAsync', { id: 'w2', handle: asRoot(other), name: 'other' });

        expect(harness.state().diffTabs.map((tab) => tab.id)).toEqual([outside.id]);
    });
});
