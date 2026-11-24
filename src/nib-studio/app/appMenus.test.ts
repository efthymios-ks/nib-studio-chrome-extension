import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDirectoryHandle } from '../../common/fs/testing/fakeFileSystem.js';
import { createAppHarness, openHarnessWorkspaceAsync, tabElement, type AppHarness } from '../testing/appHarness.js';
import { settleAsync } from '../testing/testHelpers.js';
import { EMPTY_SELECTION } from '../explorer/selection.js';
import type { CommandContext } from './commands.js';
import type { DroppedFile } from './droppedItems.js';

const NESTED = 'docs/guides/setup.md';
const LICENCE = 'docs/guides/LICENCE';
const BLOB = 'docs/guides/blob';
const DIAGRAM = 'docs/guides/diagram.png';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BINARY = new Uint8Array([0, 255, 128, 10, 13, 0xc3, 0x28, 7]);

let harness: AppHarness;
let copied: string[];

function createHarness(): AppHarness {
    return createAppHarness({
        'README.md': '# Read me\n',
        [NESTED]: '# Set up\n',
        [LICENCE]: 'Permission is granted.\n',
        [BLOB]: BINARY,
        [DIAGRAM]: PNG,
    });
}

function openTabMenu(path: string): void {
    tabElement(path)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
}

function menuLabels(): string[] {
    return [...document.querySelectorAll<HTMLElement>('.context-menu[data-open="true"] .context-menu-item')]
        .map((item) => item.firstElementChild?.textContent ?? item.textContent ?? '');
}

function menuItem(label: string): HTMLElement | undefined {
    return [...document.querySelectorAll<HTMLElement>('.context-menu[data-open="true"] .context-menu-item')]
        .find((item) => item.textContent === label);
}

// Opens the files in tabs, then folds every folder away, so no row of theirs is left in the tree.
async function openThenCollapseAsync(...paths: string[]): Promise<void> {
    for (const path of paths) {
        await harness.callAsync('openFileAsync', path, { preview: false });
    }

    await harness.callAsync('collapseAllAsync');
}

async function openOutsideFileAsync(): Promise<string> {
    const desktop = new FakeDirectoryHandle('desktop');
    const handle = desktop.addFile('outside.txt', 'from outside\n');
    const item: DroppedFile = {
        kind: 'file',
        name: 'outside.txt',
        handle: handle as unknown as FileSystemFileHandle,
        readAsync: async () => await handle.getFile(),
    };
    await harness.callAsync('openExternalFileAsync', item);

    return harness.state().openFiles.find((file) => file.external != null)!.path;
}

beforeEach(() => {
    localStorage.clear();
    copied = [];
    vi.stubGlobal('navigator', {
        ...navigator,
        clipboard: {
            readText: async () => '',
            writeText: async (text: string) => {
                copied.push(text);
            },
        },
    });
});

afterEach(() => {
    harness.app.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    // The context menu is made once per page, so it stays for the next test.
    document.body.replaceChildren(...document.querySelectorAll('.context-menu'));
});

describe('The tab menu of a file in a collapsed folder', () => {
    it('offers Compare with… and Copy content to clipboard, as the tab of a file whose row shows does', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await openThenCollapseAsync('README.md', NESTED);
        expect(document.querySelector(`.tree-row[data-path="${NESTED}"]`)).toBeNull();

        openTabMenu(NESTED);

        expect(menuLabels()).toEqual(expect.arrayContaining([
            'Compare with…',
            '  Compare with clipboard',
            '  Compare with a file…',
            '  Compare with open tab: README.md',
            'Copy content to clipboard',
        ]));
    });

    it('copies the file\'s content from its tab', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await openThenCollapseAsync(NESTED);

        openTabMenu(NESTED);
        menuItem('Copy content to clipboard')!.click();
        await settleAsync();

        expect(copied).toEqual(['# Set up\n']);
    });

    it('offers both for a file of unknown type that opened as text', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await openThenCollapseAsync(LICENCE);

        openTabMenu(LICENCE);

        expect(menuLabels()).toEqual(expect.arrayContaining(['Compare with…', 'Copy content to clipboard']));
    });

    it('leaves both out for a file of unknown type that isn\'t text, and for a preview', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await openThenCollapseAsync(BLOB, DIAGRAM);

        for (const path of [BLOB, DIAGRAM]) {
            openTabMenu(path);

            expect(menuLabels()).not.toContain('Compare with…');
            expect(menuLabels()).not.toContain('Copy content to clipboard');
            expect(menuLabels()).toContain('Copy name to clipboard');
        }
    });
});

describe('The tab menu of a file from outside the workspace', () => {
    it('offers Compare with… and Copy content to clipboard, which copies the file\'s content', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        const outside = await openOutsideFileAsync();

        openTabMenu(outside);

        expect(menuLabels()).toEqual(expect.arrayContaining(['Compare with…', 'Copy content to clipboard']));

        menuItem('Copy content to clipboard')!.click();
        await settleAsync();

        expect(copied).toEqual(['from outside\n']);
    });

    it('copies the file\'s content while no workspace is open', async () => {
        harness = createHarness();
        const outside = await openOutsideFileAsync();

        openTabMenu(outside);
        menuItem('Copy content to clipboard')!.click();
        await settleAsync();

        expect(copied).toEqual(['from outside\n']);
    });
});

describe('The command context', () => {
    it('sees an open file as a file, whose text-ness comes from its tab, while its row is folded away', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await openThenCollapseAsync(NESTED, LICENCE, BLOB, DIAGRAM);

        const context = await harness.callAsync<CommandContext>('makeCommandContext', 'tree');

        expect([NESTED, LICENCE, BLOB, DIAGRAM].map((path) => context.isFile(path))).toEqual([true, true, true, true]);
        expect([NESTED, LICENCE, BLOB, DIAGRAM].map((path) => context.isText(path))).toEqual([true, true, false, false]);
        expect(context.isDirectory('docs/guides')).toBe(false);
    });

    it('still knows a file by its type, and a folder by its row, while the row shows', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);

        const context = await harness.callAsync<CommandContext>('makeCommandContext', 'tree');

        expect(context.isFile('README.md')).toBe(true);
        expect(context.isText('README.md')).toBe(true);
        expect(context.isFile('docs')).toBe(false);
        expect(context.isDirectory('docs')).toBe(true);
    });
});

describe('The menu of the empty area under the tree', () => {
    it('offers only New file, New folder and Refresh while a tab is active and nothing is selected', async () => {
        harness = createHarness();
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'README.md', { preview: false });
        await harness.callAsync('setSelection', EMPTY_SELECTION);
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });

        await harness.callAsync('showTreeContextMenu', event, null);

        expect(menuLabels()).toEqual(['New file', 'New folder', 'Refresh']);
    });
});
