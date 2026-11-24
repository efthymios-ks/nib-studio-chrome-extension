import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asRoot, textOf } from '../../common/fs/testing/fakeFileSystem.js';
import { WORKSPACE_CONFIG_PATH } from '../../common/fs/workspaceConfig.js';
import { createAppHarness, type AppHarness } from '../testing/appHarness.js';
import { flushAsync, toastTexts } from '../testing/testHelpers.js';

function createHarness(): AppHarness {
    const harness = createAppHarness({ 'a.json': '{"a":1}', 'b.json': '{"a":2}', 'notes.txt': 'one\ntwo\n' });
    harness.store.update({ workspace: { id: 'w1', handle: asRoot(harness.folder), name: 'workspace' } });

    return harness;
}

describe('diff tab exports', () => {
    let harness: AppHarness;
    let downloads: Array<{ readonly name: string; readonly blob: Blob }>;

    beforeEach(() => {
        harness = createHarness();
        downloads = [];
        const blobs: Blob[] = [];
        vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
            blobs.push(blob as Blob);

            return `blob:download-${blobs.length}`;
        });
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            downloads.push({ name: this.download, blob: blobs[blobs.length - 1]! });
        });
    });

    afterEach(() => {
        harness.app.dispose();
        // The context menu is made once per page, so it stays for the next test.
        document.body.replaceChildren(...document.querySelectorAll('.context-menu'));
        vi.restoreAllMocks();
    });

    function openTabMenu(): HTMLElement[] {
        document.querySelector('.tab[data-active="true"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

        return [...document.querySelectorAll<HTMLElement>('.context-menu[data-open="true"] .context-menu-item')];
    }

    function menuItem(label: string): HTMLElement {
        return openTabMenu().find((item) => item.textContent?.trim() === label)!;
    }

    it('offers Export JSON and Export HTML on a diff tab, after Swap sides and Reveal in Explorer', async () => {
        await harness.callAsync('compareTwoSelectedAsync', 'a.json', 'b.json');

        expect(openTabMenu().slice(0, 4).map((item) => item.textContent)).toEqual(['Swap sides', 'Reveal in Explorer', 'Export JSON', 'Export HTML']);
    });

    it('lists the new compare kinds under a New compare header that can\'t be picked', async () => {
        await harness.callAsync('compareTwoSelectedAsync', 'a.json', 'b.json');
        const items = openTabMenu();
        const header = items.find((item) => item.textContent === 'New compare');

        expect(header?.dataset['kind']).toBe('header');
        expect(header?.getAttribute('role')).toBe('presentation');
        expect(items[items.indexOf(header!) + 1]?.textContent?.startsWith('  ')).toBe(true);
    });

    it('downloads the diff as JSON and as a page, named after both sides, and writes nothing into the workspace', async () => {
        await harness.callAsync('compareTwoSelectedAsync', 'a.json', 'b.json');
        const files = [...harness.folder.children.keys()];

        menuItem('Export JSON').click();
        await flushAsync();
        menuItem('Export HTML').click();
        await flushAsync();

        expect(downloads.map((download) => download.name)).toEqual(['a-vs-b.diff.json', 'a-vs-b.diff.html']);
        expect(JSON.parse(await downloads[0]!.blob.text())).toMatchObject({ kind: 'json', original: { name: 'a.json', path: 'a.json' }, changes: [{ id: 'a' }] });
        expect(await downloads[1]!.blob.text()).toContain('<title>a.json ↔ b.json · JSON diff</title>');
        expect([...harness.folder.children.keys()]).toEqual(files);
        expect([...document.querySelectorAll('.toast')].map((toast) => toast.textContent)).toContain('Downloaded a-vs-b.diff.html.');
    });

    it('leaves the exports out of the menu while a side is missing', () => {
        harness.app.newCompare('text');

        expect(menuItem('Export JSON')).toBeUndefined();
        expect(menuItem('Export HTML')).toBeUndefined();
    });

    it('says there is nothing to export yet while a side does not parse', async () => {
        harness.folder.addFile('broken.json', '{"a":');
        await harness.callAsync('compareTwoSelectedAsync', 'a.json', 'broken.json');

        expect(menuItem('Export JSON').dataset['disabled']).toBeUndefined();
        menuItem('Export JSON').click();
        await flushAsync();

        expect(downloads).toEqual([]);
        expect([...document.querySelectorAll('.toast')].map((toast) => toast.textContent)).toContain('This compare has no diff to export yet.');
    });
});

describe('compare entry points open diff tabs', () => {
    // A NUL and bytes that aren't UTF-8, as at the start of a program or an image.
    const BINARY = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x00, 0x00, 0xff, 0xfe, 0x00, 0x10]);
    let harness: AppHarness;

    beforeEach(async () => {
        harness = createHarness();
        await harness.callAsync('openFileAsync', 'a.json');
    });

    afterEach(() => {
        harness.app.dispose();
        document.body.replaceChildren();
        vi.unstubAllGlobals();
    });

    function expectFileTabUntouched(): void {
        const files = harness.state().openFiles;
        expect(files.map((file) => file.path)).toEqual(['a.json']);
        expect(files[0]?.text).toBe('{"a":1}');
        expect(files[0]?.dirty).toBe(false);
    }

    it('compares two selected files in a new diff tab, first as the original', async () => {
        await harness.callAsync('compareTwoSelectedAsync', 'a.json', 'b.json');

        const [tab] = harness.state().diffTabs;
        expect(tab?.diffKind).toBe('json');
        expect(tab?.original?.path).toBe('a.json');
        expect(tab?.modified?.path).toBe('b.json');
        expect(harness.state().activePath).toBe(tab?.id);
        expectFileTabUntouched();
    });

    it('compares with the clipboard', async () => {
        vi.stubGlobal('navigator', { ...navigator, clipboard: { readText: async () => '{"a":3}' } });

        await harness.callAsync('compareWithClipboardAsync', 'a.json');

        const [tab] = harness.state().diffTabs;
        expect(tab?.modified?.source).toBe('clipboard');
        expect(tab?.modified?.text).toBe('{"a":3}');
        expectFileTabUntouched();
    });

    it('compares with a file picked from disk', async () => {
        const picked = new File(['{"a":4}'], 'other.json');
        vi.stubGlobal('showOpenFilePicker', async () => [{ getFile: async () => picked }]);

        await harness.callAsync('compareWithPickedAsync', 'a.json');

        const [tab] = harness.state().diffTabs;
        expect(tab?.modified?.source).toBe('disk');
        expect(tab?.modified?.label).toBe('other.json');
        expectFileTabUntouched();
    });

    it('refuses a file of unknown type that is not text before reading the clipboard', async () => {
        harness.folder.addFile('firmware', BINARY);
        const readText = vi.fn(async () => 'text');
        vi.stubGlobal('navigator', { ...navigator, clipboard: { readText } });

        await harness.callAsync('compareWithClipboardAsync', 'firmware');

        expect(readText).not.toHaveBeenCalled();
        expect(harness.state().diffTabs).toEqual([]);
        expect(toastTexts()).toContain('firmware can\'t be compared: it isn\'t text.');
    });

    it('refuses a file of unknown type that is not text before opening the file picker', async () => {
        harness.folder.addFile('firmware', BINARY);
        const picker = vi.fn(async () => []);
        vi.stubGlobal('showOpenFilePicker', picker);

        await harness.callAsync('compareWithPickedAsync', 'firmware');

        expect(picker).not.toHaveBeenCalled();
        expect(harness.state().diffTabs).toEqual([]);
        expect(toastTexts()).toContain('firmware can\'t be compared: it isn\'t text.');
    });

    it('compares a file of unknown type whose bytes are text', async () => {
        harness.folder.addFile('README', 'plain words\n');
        vi.stubGlobal('navigator', { ...navigator, clipboard: { readText: async () => 'other words\n' } });

        await harness.callAsync('compareWithClipboardAsync', 'README');

        expect(harness.state().diffTabs[0]?.original?.text).toBe('plain words\n');
    });

    it('refuses a picked file that is not text, without reading it as text', async () => {
        const picked = new File([BINARY], 'memory-dump');
        const readAsText = vi.spyOn(picked, 'text');
        vi.stubGlobal('showOpenFilePicker', async () => [{ getFile: async () => picked }]);

        await harness.callAsync('compareWithPickedAsync', 'a.json');

        expect(readAsText).not.toHaveBeenCalled();
        expect(harness.state().diffTabs).toEqual([]);
        expect(toastTexts()).toContain('memory-dump can\'t be compared: it isn\'t text.');
    });

    it('refuses a picked file that opens only as a preview', async () => {
        const picked = new File([BINARY], 'photo.png');
        vi.stubGlobal('showOpenFilePicker', async () => [{ getFile: async () => picked }]);

        await harness.callAsync('compareWithPickedAsync', 'a.json');

        expect(harness.state().diffTabs).toEqual([]);
        expect(toastTexts()).toContain('photo.png can\'t be compared: it opens only as a preview.');
    });

    it('compares with another open tab using its unsaved text', async () => {
        await harness.callAsync('openFileAsync', 'b.json');
        (harness.app as unknown as { markChange: (path: string, text: string) => void }).markChange('b.json', '{"a":9}');
        harness.store.update({ activePath: 'a.json' });

        await harness.callAsync('compareWithOpenTabAsync', 'a.json', 'b.json');

        const [tab] = harness.state().diffTabs;
        expect(tab?.modified?.source).toBe('open-tab');
        expect(tab?.modified?.text).toBe('{"a":9}');
        expect(harness.state().openFiles.map((file) => file.path)).toEqual(['a.json', 'b.json']);
    });

    it('asks for the other side first from the file toolbar, then opens the diff with both sides', async () => {
        const anchor = document.createElement('button');
        document.body.append(anchor);
        const pending = harness.callAsync('compareWithChooserAsync', 'a.json', anchor);
        await flushAsync();

        const item = document.querySelector<HTMLButtonElement>('.compare-chooser [data-list="workspace"] [data-path="b.json"]');
        expect(item).not.toBeNull();
        expect(document.querySelector('.compare-chooser [data-path="notes.txt"]')).toBeNull();
        item!.click();
        await pending;

        const [tab] = harness.state().diffTabs;
        expect(tab?.original?.path).toBe('a.json');
        expect(tab?.modified?.path).toBe('b.json');
        expect(document.querySelector('.compare-chooser')).toBeNull();
        expectFileTabUntouched();
    });

    it('opens nothing when the chooser is dismissed', async () => {
        const anchor = document.createElement('button');
        document.body.append(anchor);
        const pending = harness.callAsync('compareWithChooserAsync', 'a.json', anchor);
        await flushAsync();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await pending;

        expect(harness.state().diffTabs).toHaveLength(0);
        expect(harness.state().activePath).toBe('a.json');
    });

    it('opens a pasted-text diff from the chooser', async () => {
        const anchor = document.createElement('button');
        document.body.append(anchor);
        const pending = harness.callAsync('compareWithChooserAsync', 'a.json', anchor);
        await flushAsync();
        document.querySelector<HTMLButtonElement>('.compare-chooser [data-action="paste"]')!.click();
        document.querySelector<HTMLTextAreaElement>('.compare-chooser-paste')!.value = '{"a":5}';
        document.querySelector<HTMLButtonElement>('.compare-chooser [data-action="compare-pasted"]')!.click();
        await pending;

        const [tab] = harness.state().diffTabs;
        expect(tab?.modified?.source).toBe('paste');
        expect(tab?.modified?.label).toBe('Pasted text');
    });

    it('focuses the existing diff tab when the same pair is compared again', async () => {
        await harness.callAsync('compareTwoSelectedAsync', 'a.json', 'b.json');
        harness.store.update({ activePath: 'a.json' });
        await harness.callAsync('compareTwoSelectedAsync', 'b.json', 'a.json');

        expect(harness.state().diffTabs).toHaveLength(1);
        expect(harness.state().activePath).toBe(harness.state().diffTabs[0]?.id);
    });

    it('renders the diff tab with a title naming both sides and a diff glyph, never as a preview', async () => {
        await harness.callAsync('compareTwoSelectedAsync', 'a.json', 'b.json');

        const tab = document.querySelector<HTMLElement>('.tab[data-kind="diff"]');
        expect(tab?.querySelector('.tab-name')?.textContent).toBe('a.json ↔ b.json');
        expect(tab?.querySelector('.tab-icon')?.textContent).toBe('⇄');
        expect(tab?.getAttribute('title')).toContain('Original: a.json');
        expect(tab?.getAttribute('title')).toContain('Modified: b.json');
        expect(tab?.dataset['preview']).toBeUndefined();
    });

    it('swaps the sides from the tab and keeps the tab', async () => {
        await harness.callAsync('compareTwoSelectedAsync', 'a.json', 'b.json');
        const id = harness.state().diffTabs[0]!.id;
        (harness.app as unknown as { swapDiffSides: (tabId: string) => void }).swapDiffSides(id);

        const [tab] = harness.state().diffTabs;
        expect(tab?.id).toBe(id);
        expect(tab?.original?.path).toBe('b.json');
        expect(document.querySelector('.tab[data-kind="diff"] .tab-name')?.textContent).toBe('b.json ↔ a.json');
    });

    it('closes a diff tab and falls back to a neighbouring tab', async () => {
        await harness.callAsync('compareTwoSelectedAsync', 'a.json', 'b.json');
        await harness.callAsync('closeFileAsync', harness.state().diffTabs[0]!.id);

        expect(harness.state().diffTabs).toHaveLength(0);
        expect(harness.state().activePath).toBe('a.json');
    });

    it('keeps the diff view state when leaving the tab and coming back', async () => {
        await harness.callAsync('compareTwoSelectedAsync', 'a.json', 'b.json');
        const tab = harness.state().diffTabs[0]!;
        const sortToggle = document.querySelector<HTMLInputElement>('[data-action="sort-keys"] input')!;
        sortToggle.checked = false;
        sortToggle.dispatchEvent(new Event('change'));

        harness.store.update({ activePath: 'a.json' });
        expect(document.querySelector('.diff-tab-pane')).toBeNull();
        harness.store.update({ activeSurface: 'hash' });
        harness.store.update({ activeSurface: 'files', activePath: tab.id });

        expect(document.querySelector<HTMLInputElement>('[data-action="sort-keys"] input')?.checked).toBe(false);
        expect(harness.state().diffTabs[0]?.state).toBe(tab.state);
    });

    it('persists diff tabs between workspace files, but not clipboard diffs', async () => {
        vi.stubGlobal('navigator', { ...navigator, clipboard: { readText: async () => 'pasted' } });
        await harness.callAsync('compareTwoSelectedAsync', 'a.json', 'b.json');
        await harness.callAsync('compareWithClipboardAsync', 'a.json');
        await harness.callAsync('flushConfigAsync');

        const config = JSON.parse(textOf(harness.folder, WORKSPACE_CONFIG_PATH)) as {
            openFiles: string[];
            diffTabs: Array<{ original: string; modified: string }>;
        };
        expect(config.openFiles).toEqual(['a.json']);
        expect(config.diffTabs).toEqual([{ original: 'a.json', modified: 'b.json', position: 1 }]);
    });

    it('reopens persisted diff tabs by reading both files again', async () => {
        await harness.callAsync('restoreDiffTabsAsync', [{ original: 'a.json', modified: 'notes.txt', position: 0 }], 0);

        const [tab] = harness.state().diffTabs;
        expect(tab?.modified?.text).toBe('one\ntwo\n');
        expect(harness.state().tabOrder[0]).toBe(tab?.id);
        expect(harness.state().activePath).toBe(tab?.id);
    });
});
