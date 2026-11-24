import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppHarness, markChange, openHarnessWorkspaceAsync, treeRow, type AppHarness } from '../testing/appHarness.js';
import { blurEditor, ignoreSelectionChange, waitForFrameAsync } from '../testing/testHelpers.js';
import { setFilesSurfaceView } from '../views/filesSurface.js';

let harness: AppHarness;

beforeEach(() => {
    document.addEventListener('selectionchange', ignoreSelectionChange, true);
    // Without a worker, as here, the index runs on the page.
    vi.stubGlobal('Worker', undefined);
    setFilesSurfaceView('editor');
    harness = createAppHarness({
        'README.md': '# Read me\n\nAnna writes the onboarding guide.\n',
        'notes/plans/Warehouse Plan.txt': 'Line one.\nLine two.\nThe warehouse inventory is counted twice a year.\n',
        'MyName.txt': 'A file named on purpose.\n',
    });
});

afterEach(() => {
    blurEditor();
    harness.app.dispose();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    document.removeEventListener('selectionchange', ignoreSelectionChange, true);
});

function lookupInput(): HTMLInputElement {
    return document.querySelector('.lookup-input') as HTMLInputElement;
}

function rowNames(): string[] {
    return [...document.querySelectorAll('.lookup-row .lookup-row-name')].map((name) => name.textContent ?? '');
}

async function lookUpAsync(query: string, first: string): Promise<void> {
    lookupInput().focus();
    lookupInput().value = query;
    lookupInput().dispatchEvent(new Event('input', { bubbles: true }));
    await waitForFrameAsync();
    await vi.waitFor(() => {
        // The results refresh as contents are read, so the query is searched again until the file shows.
        lookupInput().dispatchEvent(new Event('input', { bubbles: true }));
        expect(rowNames()[0]).toBe(first);
    }, { timeout: 5000, interval: 50 });
}

function press(key: string, init: KeyboardEventInit = {}): void {
    lookupInput().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

function editorSelection(): string {
    const content = document.querySelector<HTMLElement>('.editor-shell .cm-content');
    const view = content == null ? null : EditorView.findFromDOM(content);
    const main = view?.state.selection.main;

    return view == null || main == null ? '' : view.state.sliceDoc(main.from, main.to);
}

describe('App Lookup', () => {
    it('shows the box at the top of the Explorer, above the tree, only while a workspace is open', async () => {
        const box = document.querySelector<HTMLElement>('.lookup-box');

        expect(box?.hidden).toBe(true);
        expect(box?.nextElementSibling?.classList.contains('tree')).toBe(true);
        expect(box?.previousElementSibling?.classList.contains('sidebar-header')).toBe(true);

        await openHarnessWorkspaceAsync(harness);

        expect(box?.hidden).toBe(false);
    });

    it('opens a file found by name in a permanent tab', async () => {
        await openHarnessWorkspaceAsync(harness);
        await lookUpAsync('my name', 'MyName.txt');
        press('Enter');

        await vi.waitFor(() => expect(harness.state().activePath).toBe('MyName.txt'));
        expect(harness.state().openFiles.find((file) => file.path === 'MyName.txt')?.preview).toBe(false);
        expect(document.querySelector('.lookup-panel')).toBeNull();
        expect(lookupInput().value).toBe('my name');
    });

    it('opens a text file found by its content in Editor with the match selected, revealed in the tree', async () => {
        await openHarnessWorkspaceAsync(harness);
        await lookUpAsync('warehouse inventory', 'Warehouse Plan.txt');
        press('Enter');

        await vi.waitFor(() => expect(editorSelection()).toBe('warehouse inventory'));
        expect(harness.state().activePath).toBe('notes/plans/Warehouse Plan.txt');
        expect(harness.state().expandedPaths.has('notes/plans')).toBe(true);
    });

    it('opens a Markdown file found by its content in Editor rather than Preview, with the match selected', async () => {
        await openHarnessWorkspaceAsync(harness);
        await lookUpAsync('onboarding guide', 'README.md');
        press('Enter');

        await vi.waitFor(() => expect(editorSelection()).toBe('onboarding guide'));
        expect(document.querySelector<HTMLElement>('.view-tab[data-active="true"]')?.dataset['view']).toBe('editor');
    });

    it('searches the unsaved text of an open file', async () => {
        await openHarnessWorkspaceAsync(harness);
        await harness.callAsync('openFileAsync', 'MyName.txt');
        markChange(harness, 'MyName.txt', 'A pineapple typed but not saved.\n');
        blurEditor();
        await lookUpAsync('pineapple', 'MyName.txt');

        expect(document.querySelector('.lookup-preview-text')?.textContent).toContain('pineapple typed');
    });

    it('reveals the selected file in the Explorer on Ctrl+E, with the tree focused', async () => {
        await openHarnessWorkspaceAsync(harness);
        await lookUpAsync('warehouse plan', 'Warehouse Plan.txt');
        press('e', { ctrlKey: true });

        await vi.waitFor(() => expect(treeRow('notes/plans/Warehouse Plan.txt').dataset['selected']).toBe('true'));
        expect(document.activeElement).toBe(document.querySelector('.tree'));
        expect(document.querySelector('.lookup-panel')).toBeNull();
    });

    it('leaves for the tree on a second Escape', async () => {
        await openHarnessWorkspaceAsync(harness);
        await lookUpAsync('my name', 'MyName.txt');
        press('Escape');

        expect(lookupInput().value).toBe('');
        expect(document.activeElement).toBe(lookupInput());

        press('Escape');

        expect(document.activeElement).toBe(document.querySelector('.tree'));
    });
});
