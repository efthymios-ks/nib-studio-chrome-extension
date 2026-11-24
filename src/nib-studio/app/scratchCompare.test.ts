import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asRoot } from '../../common/fs/testing/fakeFileSystem.js';
import { createAppHarness, type AppHarness } from '../testing/appHarness.js';
import { flushAsync } from '../testing/testHelpers.js';
import { createScratchDiffTab, diffTabTitle, persistableDiffTabs, workspaceFileSide } from './diffTabs.js';
import type { DiffTab } from './store.js';

interface Harness extends AppHarness {
    readonly tab: () => DiffTab;
}

function createHarness(): Harness {
    const harness = createAppHarness({ 'a.json': '{"a":1}', 'b.json': '{"a":2}' });
    harness.store.update({ workspace: { id: 'w1', handle: asRoot(harness.folder), name: 'workspace' } });

    return {
        ...harness,
        tab: () => harness.state().diffTabs.find((candidate) => candidate.id === harness.state().activePath)!,
    };
}

function header(root: HTMLElement, side: 'original' | 'modified'): HTMLElement {
    return root.querySelector<HTMLElement>(`.diff-side-header[data-side="${side}"]`)!;
}

function clickSideAction(root: HTMLElement, side: 'original' | 'modified', action: string): void {
    header(root, side).querySelector<HTMLButtonElement>(`[data-side-action="${action}"]`)!.click();
}

function stubClipboard(text: string): void {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { readText: async () => text } });
}

describe('on-the-fly compares', () => {
    let harness: Harness;

    beforeEach(() => {
        harness = createHarness();
    });

    afterEach(() => {
        harness.app.dispose();
        document.body.replaceChildren();
        vi.unstubAllGlobals();
    });

    it('opens an empty compare of the kind chosen from the tab bar', () => {
        harness.root.querySelector<HTMLButtonElement>('.tab-new')!.click();
        const items = [...document.querySelectorAll<HTMLElement>('.context-menu[data-open="true"] .context-menu-item')];
        expect(items.map((item) => item.textContent)).toEqual([
            'Compare text',
            'Compare JSON',
            'Compare YAML',
            'Compare XML',
            'Compare Markdown',
            'Compare tables (CSV/TSV)',
        ]);

        items[1]!.click();

        const tab = harness.tab();
        expect(tab.diffKind).toBe('json');
        expect(tab.scratch).toEqual({ number: 1 });
        expect(tab.original).toBeNull();
        expect(tab.modified).toBeNull();
        expect(harness.root.querySelector('.tab[data-active="true"] .tab-name')?.textContent).toBe('JSON compare');
    });

    it('numbers further compares of the same kind', () => {
        harness.app.newCompare('text');
        harness.app.newCompare('text');

        expect(harness.state().diffTabs.map((tab) => diffTabTitle(tab))).toEqual(['Text compare', 'Text compare 2']);
    });

    it('replaces a side with the clipboard each time Paste is clicked, recomputing the diff', async () => {
        harness.app.newCompare('json');
        stubClipboard('{"a":1}');
        clickSideAction(harness.root, 'original', 'paste');
        await flushAsync();
        stubClipboard('{"a":2}');
        clickSideAction(harness.root, 'modified', 'paste');
        await flushAsync();

        expect(harness.tab().original?.source).toBe('paste');
        expect(header(harness.root, 'original').querySelector('.diff-side-name')?.textContent).toBe('Pasted text');
        expect(header(harness.root, 'original').querySelector('.diff-side-path')?.textContent).toMatch(/^Pasted at \d\d:\d\d$/);
        expect(harness.tab().state.json.cache?.document.changes).toHaveLength(1);

        stubClipboard('{"a":1}');
        clickSideAction(harness.root, 'modified', 'paste');
        await flushAsync();

        expect(harness.tab().modified?.text).toBe('{"a":1}');
        expect(harness.tab().state.json.cache?.document.changes).toHaveLength(0);
    });

    it('replaces the hovered side on Ctrl+V', () => {
        harness.app.newCompare('text');
        harness.store.update({ diffTabs: harness.state().diffTabs.map((tab) => ({ ...tab, original: { label: 'x', source: 'paste' as const, text: 'one' } })) });
        header(harness.root, 'original').dispatchEvent(new Event('pointerover', { bubbles: true }));
        const event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: { files: [], getData: () => 'two' } });

        document.body.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(harness.tab().original?.text).toBe('two');
        expect(harness.tab().modified).toBeNull();
    });

    it('fills the first empty side on Ctrl+V while nothing has focus, wherever a stale caret aims the paste', () => {
        harness.app.newCompare('text');
        const about = document.createElement('button');
        document.body.append(about);
        const event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: { files: [], getData: () => 'pasted line' } });

        about.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(harness.tab().original?.text).toBe('pasted line');
    });

    it('fills a side on Ctrl+V with the focus anywhere in the compare, such as on its toolbar', () => {
        harness.app.newCompare('text');
        const toolbarButton = harness.root.querySelector<HTMLButtonElement>('.diff-tab-pane .editor-toolbar button')!;
        toolbarButton.focus();
        const event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: { files: [], getData: () => 'pasted line' } });

        toolbarButton.dispatchEvent(event);

        expect(harness.tab().original?.text).toBe('pasted line');
    });

    it('applies text typed in the side editor', () => {
        harness.app.newCompare('text');
        clickSideAction(harness.root, 'modified', 'edit');
        const editor = EditorView.findFromDOM(harness.root.querySelector<HTMLElement>('.diff-side-editor-host .cm-editor')!)!;
        editor.dispatch({ changes: { from: 0, insert: 'typed\n' } });

        harness.root.querySelector<HTMLButtonElement>('[data-action="apply-edit"]')!.click();

        expect(harness.tab().modified?.text).toBe('typed\n');
        expect(harness.tab().modified?.edited).toBe(true);
        expect(harness.root.querySelector('.diff-side-editor-host')).toBeNull();
        expect(header(harness.root, 'modified').querySelector('.diff-side-name')?.textContent).toBe('Edited text');
    });

    it('replaces a side with a chosen workspace file', async () => {
        harness.app.newCompare('json');
        clickSideAction(harness.root, 'original', 'choose');
        await flushAsync();
        document.querySelector<HTMLButtonElement>('.compare-chooser [data-path="b.json"]')!.click();
        await flushAsync();

        expect(harness.tab().original?.path).toBe('b.json');
        expect(harness.tab().original?.text).toBe('{"a":2}');
    });

    it('re-reads both sides as another kind and keeps invalid text with its error', () => {
        harness.app.newCompare('text');
        const tabId = harness.tab().id;
        harness.store.update({
            diffTabs: harness.state().diffTabs.map((tab) => ({
                ...tab,
                original: { label: 'x', source: 'paste' as const, text: '{"a":1}' },
                modified: { label: 'y', source: 'paste' as const, text: '{"a":' },
            })),
        });

        harness.root.querySelector<HTMLButtonElement>('.diff-kind-picker [data-kind="json"]')!.click();

        expect(harness.tab().id).toBe(tabId);
        expect(harness.tab().diffKind).toBe('json');
        const error = harness.root.querySelector('.split-pane[data-pane="modified"] .diff-side-error');
        expect(error?.textContent).toMatch(/Not valid JSON.*line 1, column \d+/);
        expect(harness.root.querySelector('.split-pane[data-pane="modified"] .diff-side-text')?.textContent).toBe('{"a":');
        expect(harness.root.querySelector('.split-pane[data-pane="original"] .diff-side-error')).toBeNull();
    });

    it('keeps texts, kind and an unapplied edit when switching tabs and back', async () => {
        harness.app.newCompare('text');
        const tabId = harness.tab().id;
        stubClipboard('left');
        clickSideAction(harness.root, 'original', 'paste');
        await flushAsync();
        clickSideAction(harness.root, 'modified', 'edit');
        const editor = EditorView.findFromDOM(harness.root.querySelector<HTMLElement>('.diff-side-editor-host .cm-editor')!)!;
        editor.dispatch({ changes: { from: 0, insert: 'draft' } });

        await (harness.app as unknown as { openFileAsync: (path: string) => Promise<void> }).openFileAsync('a.json');
        expect(harness.root.querySelector('.diff-side-editor-host')).toBeNull();
        harness.store.update({ activePath: tabId });

        expect(harness.tab().original?.text).toBe('left');
        const restored = EditorView.findFromDOM(harness.root.querySelector<HTMLElement>('.diff-side-editor-host .cm-editor')!)!;
        expect(restored.state.doc.toString()).toBe('draft');
    });

    it('offers Paste and Choose file on the sides of a file compare too', async () => {
        await (harness.app as unknown as { compareTwoSelectedAsync: (a: string, b: string) => Promise<void> }).compareTwoSelectedAsync('a.json', 'b.json');
        stubClipboard('{"a":3}');
        clickSideAction(harness.root, 'modified', 'paste');
        await flushAsync();

        expect(harness.tab().original?.path).toBe('a.json');
        expect(harness.tab().modified?.source).toBe('paste');
        expect(persistableDiffTabs(harness.state())).toEqual([]);
    });
});

describe('scratch compares are session-only', () => {
    it('never persists a new compare, even with two workspace files', () => {
        const tab = {
            ...createScratchDiffTab([], 'json'),
            original: workspaceFileSide('a.json', '{}', null),
            modified: workspaceFileSide('b.json', '{}', null),
        };

        expect(persistableDiffTabs({ diffTabs: [tab], tabOrder: [tab.id] })).toEqual([]);
    });
});
