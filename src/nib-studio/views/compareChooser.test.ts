import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { filterWorkspaceFiles, showCompareChooserAsync, type CompareChoice, type CompareChooserOptions } from './compareChooser.js';
import { externalTabPath } from '../app/store.js';
import { settleAsync } from '../testing/testHelpers.js';

const WORKSPACE_FILES = ['docs/b.json', 'a.json', 'docs/item10.json', 'docs/item2.json'];

function popover(): HTMLElement {
    return document.querySelector<HTMLElement>('.compare-chooser')!;
}

function workspacePaths(): string[] {
    return [...popover().querySelectorAll<HTMLElement>('[data-list="workspace"] .compare-chooser-item')].map((item) => item.dataset['path'] ?? '');
}

describe('filterWorkspaceFiles', () => {
    it('keeps paths containing the query, case-insensitively, in natural order', () => {
        expect(filterWorkspaceFiles(WORKSPACE_FILES, '  ITEM ')).toEqual(['docs/item2.json', 'docs/item10.json']);
    });

    it('returns every path sorted for an empty query', () => {
        expect(filterWorkspaceFiles(WORKSPACE_FILES, '')).toEqual(['a.json', 'docs/b.json', 'docs/item2.json', 'docs/item10.json']);
    });
});

describe('showCompareChooserAsync', () => {
    let anchor: HTMLButtonElement;

    beforeEach(() => {
        anchor = document.createElement('button');
        document.body.append(anchor);
    });

    afterEach(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        document.body.innerHTML = '';
    });

    function open(overrides: Partial<CompareChooserOptions> = {}): Promise<CompareChoice | null> {
        return showCompareChooserAsync({
            anchor,
            openTabs: [],
            listWorkspaceFilesAsync: async () => WORKSPACE_FILES,
            clipboardAvailable: true,
            ...overrides,
        });
    }

    it('opens a labelled dialog with the search field focused', async () => {
        void open({ title: 'Compare a.json with' });
        await settleAsync();

        expect(popover().getAttribute('role')).toBe('dialog');
        expect(popover().getAttribute('aria-label')).toBe('Compare a.json with');
        expect(popover().querySelector('.compare-chooser-title')?.textContent).toBe('Compare a.json with');
        expect(document.activeElement).toBe(popover().querySelector('.compare-chooser-search'));
    });

    it('lists open tabs only when there are some and resolves with the chosen one', async () => {
        const pending = open({ openTabs: ['docs/other.json'] });
        const item = popover().querySelector<HTMLButtonElement>('[data-section="open-tabs"] .compare-chooser-item')!;

        expect(item.querySelector('.compare-chooser-name')?.textContent).toBe('other.json');
        item.click();

        expect(await pending).toEqual({ source: 'open-tab', path: 'docs/other.json' });
        expect(document.querySelector('.compare-chooser')).toBeNull();
        expect(document.activeElement).toBe(anchor);
    });

    it('shows the tab of a file from outside the workspace by its name', async () => {
        void open({ openTabs: [externalTabPath(1, 'notes.json')] });
        const item = popover().querySelector<HTMLButtonElement>('[data-section="open-tabs"] .compare-chooser-item')!;

        expect(item.querySelector('.compare-chooser-path')?.textContent).toBe('notes.json');
        expect(item.title).toBe('notes.json');
    });

    it('omits the open tab section when no tabs compare', async () => {
        void open();

        expect(popover().querySelector('[data-section="open-tabs"]')).toBeNull();
    });

    it('shows Loading until the workspace files arrive, then the sorted list', async () => {
        let release: (files: string[]) => void = () => {};
        void open({ listWorkspaceFilesAsync: () => new Promise((resolve) => {
            release = resolve;
        }) });

        expect(popover().querySelector('.compare-chooser-empty')?.textContent).toBe('Loading…');
        release(WORKSPACE_FILES);
        await settleAsync();

        expect(workspacePaths()).toEqual(['a.json', 'docs/b.json', 'docs/item2.json', 'docs/item10.json']);
    });

    it('filters as the user types and picks the first match on Enter', async () => {
        const pending = open();
        await settleAsync();
        const search = popover().querySelector<HTMLInputElement>('.compare-chooser-search')!;

        search.value = 'item';
        search.dispatchEvent(new Event('input'));
        expect(workspacePaths()).toEqual(['docs/item2.json', 'docs/item10.json']);
        search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

        expect(await pending).toEqual({ source: 'file', path: 'docs/item2.json' });
    });

    it('says No match or No comparable files when the list is empty', async () => {
        void open();
        await settleAsync();
        const search = popover().querySelector<HTMLInputElement>('.compare-chooser-search')!;
        search.value = 'zzz';
        search.dispatchEvent(new Event('input'));

        expect(popover().querySelector('.compare-chooser-empty')?.textContent).toBe('No match.');

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        void open({ listWorkspaceFilesAsync: async () => [] });
        await settleAsync();

        expect(popover().querySelector('.compare-chooser-empty')?.textContent).toBe('No comparable files.');
    });

    it('resolves with disk and clipboard choices', async () => {
        const diskPending = open();
        popover().querySelector<HTMLButtonElement>('[data-action="disk"]')!.click();
        expect(await diskPending).toEqual({ source: 'disk' });

        const clipboardPending = open();
        popover().querySelector<HTMLButtonElement>('[data-action="clipboard"]')!.click();
        expect(await clipboardPending).toEqual({ source: 'clipboard' });
    });

    it('leaves out Clipboard when the clipboard cannot be read', async () => {
        void open({ clipboardAvailable: false });

        expect(popover().querySelector('[data-action="clipboard"]')).toBeNull();
        expect(popover().querySelector('[data-action="disk"]')).not.toBeNull();
    });

    it('reveals the paste box and only compares non-empty text', async () => {
        const pending = open();
        const box = popover().querySelector<HTMLElement>('.compare-chooser-paste-box')!;
        const area = box.querySelector<HTMLTextAreaElement>('textarea')!;
        const confirm = box.querySelector<HTMLButtonElement>('[data-action="compare-pasted"]')!;

        expect(box.hidden).toBe(true);
        popover().querySelector<HTMLButtonElement>('[data-action="paste"]')!.click();
        expect(box.hidden).toBe(false);
        expect(document.activeElement).toBe(area);
        confirm.click();
        expect(document.querySelector('.compare-chooser')).not.toBeNull();
        area.value = '{"a":1}';
        confirm.click();

        expect(await pending).toEqual({ source: 'paste', text: '{"a":1}' });
    });

    it('resolves null on Escape', async () => {
        const pending = open();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        expect(await pending).toBeNull();
        expect(document.querySelector('.compare-chooser')).toBeNull();
    });

    it('resolves null on a pointer down outside but not on the anchor or inside', async () => {
        const pending = open();
        anchor.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        popover().dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(document.querySelector('.compare-chooser')).not.toBeNull();

        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));

        expect(await pending).toBeNull();
    });

    it('gives the focus back to the element that had it before it opened', async () => {
        const editor = document.createElement('textarea');
        document.body.append(editor);
        editor.focus();
        const pending = open();

        popover().querySelector<HTMLButtonElement>('[data-action="clipboard"]')!.click();
        await pending;

        expect(document.activeElement).toBe(editor);
    });

    it('gives the focus to the anchor when the element that had it is gone', async () => {
        const editor = document.createElement('textarea');
        document.body.append(editor);
        editor.focus();
        const pending = open();
        editor.remove();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await pending;

        expect(document.activeElement).toBe(anchor);
    });

    it('leaves no caret behind in the page where it was', async () => {
        const pending = open();
        const title = popover().querySelector('.compare-chooser-title')!;
        window.getSelection()!.collapse(title.firstChild, 2);

        popover().querySelector<HTMLButtonElement>('[data-action="clipboard"]')!.click();
        await pending;

        expect(window.getSelection()!.rangeCount).toBe(0);
    });

    it('closes an open chooser when another one opens', async () => {
        const first = open();
        const second = open();

        expect(await first).toBeNull();
        expect(document.querySelectorAll('.compare-chooser')).toHaveLength(1);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(await second).toBeNull();
    });
});
