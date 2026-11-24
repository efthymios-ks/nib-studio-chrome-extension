import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDirectoryHandle } from '../../common/fs/testing/fakeFileSystem.js';
import {
    createAppHarness,
    openHarnessWorkspaceAsync,
    tabElement,
    treeRow,
    type AppHarness,
} from '../testing/appHarness.js';
import { settleAsync, stubMatchMedia } from '../testing/testHelpers.js';
import type { Command, CommandContext } from './commands.js';
import type { DroppedFile } from './droppedItems.js';
import { NARROW_LAYOUT_QUERY } from './explorerDrawer.js';

const LAYOUT_KEY = 'nib-studio/explorer-layout';
const NESTED = 'docs/guides/setup.md';

let harness: AppHarness;
let scrolled: string[];

function createHarness(): AppHarness {
    return createAppHarness({
        'README.md': '# Read me\n',
        [NESTED]: '# Set up\n',
        'docs/notes.txt': 'notes\n',
        'data/orders.json': '{"orders":[]}',
    });
}

function openTabMenu(path: string): void {
    tabElement(path)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
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

// Opens the nested file in a tab, then folds every folder away, so the file's row is gone from the tree.
async function openNestedThenCollapseAsync(): Promise<void> {
    await harness.callAsync('openFileAsync', NESTED, { preview: false });
    await harness.callAsync('openFileAsync', 'README.md', { preview: false });
    await harness.callAsync('collapseAllAsync');
    harness.store.update({ selectedPath: null });
    (document.activeElement as HTMLElement | null)?.blur();
}

async function revealFromTabAsync(path: string): Promise<void> {
    openTabMenu(path);
    menuItem('Reveal in Explorer')!.click();
    await settleAsync();
}

beforeEach(() => {
    localStorage.clear();
    scrolled = [];
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
        scrolled.push(this.dataset['path'] ?? '');
    });
});

afterEach(() => {
    harness.app.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    // The context menu is made once per page, so it stays for the next test.
    document.body.replaceChildren(...document.querySelectorAll('.context-menu'));
    delete document.body.dataset['explorerCollapsed'];
    delete document.body.dataset['explorerDrawer'];
});

describe('Reveal in Explorer on a file tab', () => {
    it('heads the tab menu of a workspace file, in a group of its own, and is not in the tree menu', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'README.md', { preview: false });

        openTabMenu('README.md');

        expect(menuEntries().slice(0, 3)).toEqual(['Reveal in Explorer', '---', 'Compare with…']);

        treeRow('README.md').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

        expect(menuItem('Reveal in Explorer')).toBeUndefined();
    });

    it('is left out of the menu of a tab of a file from outside the workspace', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        const outside = await openOutsideFileAsync();

        openTabMenu(outside);

        expect(menuEntries()).not.toContain('Reveal in Explorer');
        expect(menuEntries()).toContain('Copy name to clipboard');
    });

    it('is left out while no workspace is open', async () => {
        harness = createHarness();
        const outside = await openOutsideFileAsync();

        openTabMenu(outside);

        expect(menuEntries()).not.toContain('Reveal in Explorer');

        const registry = await harness.callAsync<ReadonlyArray<Command>>('buildCommandRegistry');
        const reveal = registry.find((command) => command.id === 'reveal-in-explorer')!;
        const context = await harness.callAsync<CommandContext>('makeCommandContext', 'tab', 'README.md');

        expect(reveal.enabledWhen(context)).toBe(false);
        expect(reveal.enabledWhen({ ...context, workspaceOpen: true })).toBe(true);
    });

    it('expands the file\'s folders, then selects, focuses and scrolls to its row', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await openNestedThenCollapseAsync();
        expect(document.querySelector(`.tree-row[data-path="${NESTED}"]`)).toBeNull();

        await revealFromTabAsync(NESTED);

        expect([...harness.state().expandedPaths].sort()).toEqual(['docs', 'docs/guides']);
        expect(treeRow(NESTED).dataset['selected']).toBe('true');
        expect(treeRow(NESTED).dataset['focused']).toBe('true');
        expect(document.querySelectorAll('.tree-row[data-selected="true"]')).toHaveLength(1);
        expect(harness.state().selectedPath).toBe(NESTED);
        expect(document.activeElement).toBe(document.querySelector('.tree'));
        expect(scrolled.at(-1)).toBe(NESTED);
    });

    it('reveals the tab it was opened on without switching to it', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await openNestedThenCollapseAsync();
        expect(harness.state().activePath).toBe('README.md');

        await revealFromTabAsync(NESTED);

        expect(harness.state().activePath).toBe('README.md');
        expect(treeRow(NESTED).dataset['selected']).toBe('true');
    });

    it('lets the keyboard carry on from the revealed row', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await openNestedThenCollapseAsync();
        await revealFromTabAsync(NESTED);

        document.querySelector('.tree')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
        await settleAsync();

        expect(treeRow('docs/guides').dataset['focused']).toBe('true');
    });

    it('brings a hidden Explorer back', async () => {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify({ width: 300, collapsed: true }));
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await openNestedThenCollapseAsync();
        expect(document.body.dataset['explorerCollapsed']).toBe('true');

        await revealFromTabAsync(NESTED);

        expect(document.body.dataset['explorerCollapsed']).toBeUndefined();
        expect(document.documentElement.style.getPropertyValue('--explorer-width')).toBe('300px');
        expect(treeRow(NESTED).dataset['selected']).toBe('true');
    });

    it('slides the Explorer drawer in on a narrow screen', async () => {
        stubMatchMedia(NARROW_LAYOUT_QUERY, true);
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await openNestedThenCollapseAsync();
        expect(document.body.dataset['explorerDrawer']).toBeUndefined();

        await revealFromTabAsync(NESTED);

        expect(document.body.dataset['explorerDrawer']).toBe('open');
        expect(treeRow(NESTED).dataset['selected']).toBe('true');
        expect(document.activeElement).toBe(document.querySelector('.tree'));
        expect(scrolled.at(-1)).toBe(NESTED);
    });
});

describe('Reveal in Explorer on a diff tab', () => {
    it('selects, focuses and shows the modified file the same way', async () => {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify({ width: 260, collapsed: true }));
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('compareTwoSelectedAsync', 'docs/notes.txt', NESTED);
        await harness.callAsync('collapseAllAsync');
        const diffId = harness.state().diffTabs[0]!.id;

        openTabMenu(diffId);

        expect(menuEntries().slice(0, 2)).toEqual(['Swap sides', 'Reveal in Explorer']);

        menuItem('Reveal in Explorer')!.click();
        await settleAsync();

        expect(treeRow(NESTED).dataset['selected']).toBe('true');
        expect(treeRow(NESTED).dataset['focused']).toBe('true');
        expect(document.activeElement).toBe(document.querySelector('.tree'));
        expect(document.body.dataset['explorerCollapsed']).toBeUndefined();
    });
});
