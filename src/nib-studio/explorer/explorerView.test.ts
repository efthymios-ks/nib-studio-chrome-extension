import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { DirectoryEntry, FileEntry } from '../../common/fs/fileEntry.js';
import { renderExplorer, type ExplorerCallbacks, type ExplorerState } from './explorerView.js';
import { EMPTY_SELECTION } from './selection.js';

function file(path: string): FileEntry {
    return { name: path.split('/').pop() as string, kind: 'file', path };
}

function folder(path: string, children: FileEntry[], expanded: boolean): DirectoryEntry {
    return { name: path.split('/').pop() as string, kind: 'directory', path, children, expanded };
}

function buildTree(expanded: boolean): DirectoryEntry {
    return folder('', [
        folder('docs', [file('docs/readme.md'), file('docs/guide.md')], expanded),
        file('data.json'),
        file('notes.txt'),
    ], true);
}

function buildState(overrides: Partial<ExplorerState> = {}): ExplorerState {
    return {
        tree: buildTree(true),
        openPaths: new Set(),
        dirtyPaths: new Set(),
        selection: EMPTY_SELECTION,
        focusedPath: null,
        ...overrides,
    };
}

type CallbackMocks = {
    readonly [Key in keyof ExplorerCallbacks]: Mock<ExplorerCallbacks[Key]>;
};

function buildCallbacks(): CallbackMocks {
    return {
        onToggleFolder: vi.fn(),
        onOpen: vi.fn(),
        onSelectClick: vi.fn(),
        onContextMenu: vi.fn(),
    };
}

function row(container: HTMLElement, path: string): HTMLElement {
    return container.querySelector(`.tree-row[data-path="${path}"]`) as HTMLElement;
}

describe('renderExplorer', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
    });

    afterEach(() => {
        container.remove();
    });

    it('shows a prompt and no rows when no workspace is open', () => {
        const render = renderExplorer(container, buildState({ tree: null }), buildCallbacks());

        expect(container.querySelector('.tree-empty')?.textContent).toBe('No workspace open. Pick a folder to get started.');
        expect(render.visiblePaths).toEqual([]);
        expect(container.getAttribute('tabindex')).toBe('0');
    });

    it('lists visible paths in pre-order, including children of expanded folders', () => {
        const render = renderExplorer(container, buildState(), buildCallbacks());

        expect(render.visiblePaths).toEqual(['docs', 'docs/readme.md', 'docs/guide.md', 'data.json', 'notes.txt']);
        expect(container.querySelector('.tree-list')?.getAttribute('role')).toBe('tree');
        expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(5);
    });

    it('hides the children of a collapsed folder and marks its expansion state', () => {
        const render = renderExplorer(container, buildState({ tree: buildTree(false) }), buildCallbacks());

        expect(render.visiblePaths).toEqual(['docs', 'data.json', 'notes.txt']);
        expect(row(container, 'docs').getAttribute('aria-expanded')).toBe('false');
        expect(row(container, 'docs').querySelector('.tree-icon')?.getAttribute('data-open')).toBe('false');
    });

    it('shows folders with a folder icon and no arrows', () => {
        renderExplorer(container, buildState({ tree: buildTree(false) }), buildCallbacks());
        const folder = row(container, 'docs');

        expect(folder.querySelector('.tree-icon')?.getAttribute('data-type')).toBe('folder');
        expect(folder.querySelector('.tree-twist')).toBeNull();
        expect(folder.textContent).toBe('docs');
    });

    it('marks an expanded folder with aria-expanded and an open folder icon', () => {
        renderExplorer(container, buildState(), buildCallbacks());

        expect(row(container, 'docs').getAttribute('aria-expanded')).toBe('true');
        expect(row(container, 'docs').querySelector('.tree-icon')?.getAttribute('data-open')).toBe('true');
        expect(row(container, 'docs').dataset.kind).toBe('directory');
        expect(row(container, 'data.json').dataset.kind).toBe('file');
    });

    it('flags selected, focused and dirty rows through data attributes', () => {
        renderExplorer(container, buildState({
            selection: { selectedPaths: new Set(['docs', 'data.json']), anchorPath: 'data.json' },
            focusedPath: 'notes.txt',
            dirtyPaths: new Set(['data.json']),
        }), buildCallbacks());

        expect(row(container, 'docs').dataset.selected).toBe('true');
        expect(row(container, 'data.json').dataset.selected).toBe('true');
        expect(row(container, 'data.json').dataset.dirty).toBe('true');
        expect(row(container, 'notes.txt').dataset.focused).toBe('true');
        expect(row(container, 'notes.txt').dataset.selected).toBeUndefined();
        expect(row(container, 'notes.txt').dataset.dirty).toBeUndefined();
    });

    it('shows the name, full path tooltip and file type icon for each row', () => {
        renderExplorer(container, buildState(), buildCallbacks());
        const markdownRow = row(container, 'docs/readme.md');

        expect(markdownRow.querySelector('.tree-name')?.textContent).toBe('readme.md');
        expect(markdownRow.getAttribute('title')).toBe('docs/readme.md');
        expect(markdownRow.querySelector('.tree-icon')?.getAttribute('data-type')).toBeTruthy();
        expect(markdownRow.getAttribute('draggable')).toBe('true');
    });

    it('selects and toggles a folder on a plain click', () => {
        const callbacks = buildCallbacks();
        renderExplorer(container, buildState(), callbacks);

        row(container, 'docs').click();

        expect(callbacks.onSelectClick).toHaveBeenCalledWith('docs', 'plain');
        expect(callbacks.onToggleFolder).toHaveBeenCalledWith('docs');
    });

    it('only changes selection on a ctrl or shift click on a folder', () => {
        const callbacks = buildCallbacks();
        renderExplorer(container, buildState(), callbacks);

        row(container, 'docs').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
        row(container, 'docs').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));

        expect(callbacks.onSelectClick).toHaveBeenNthCalledWith(1, 'docs', 'toggle');
        expect(callbacks.onSelectClick).toHaveBeenNthCalledWith(2, 'docs', 'range');
        expect(callbacks.onToggleFolder).not.toHaveBeenCalled();
    });

    it('reports click kinds for files, treating meta like ctrl', () => {
        const callbacks = buildCallbacks();
        renderExplorer(container, buildState(), callbacks);
        const target = row(container, 'notes.txt');

        target.click();
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true, ctrlKey: true }));

        expect(callbacks.onSelectClick.mock.calls).toEqual([
            ['notes.txt', 'plain'],
            ['notes.txt', 'toggle'],
            ['notes.txt', 'range'],
        ]);
    });

    it('opens a file on double click', () => {
        const callbacks = buildCallbacks();
        renderExplorer(container, buildState(), callbacks);

        row(container, 'data.json').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

        expect(callbacks.onOpen).toHaveBeenCalledWith('data.json');
    });

    it('passes the row path to the context menu callback', () => {
        const callbacks = buildCallbacks();
        renderExplorer(container, buildState(), callbacks);

        row(container, 'docs/guide.md').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

        expect(callbacks.onContextMenu).toHaveBeenCalledTimes(1);
        expect(callbacks.onContextMenu.mock.calls[0]?.[1]).toBe('docs/guide.md');
    });

    it('opens the empty-area menu with a null path when right-clicking outside rows', () => {
        const callbacks = buildCallbacks();
        renderExplorer(container, buildState(), callbacks);
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

        container.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(callbacks.onContextMenu).toHaveBeenCalledWith(event, null);
    });

    it('fires the empty-area menu once, with the latest callbacks, after several renders', () => {
        const stale = buildCallbacks();
        const latest = buildCallbacks();
        renderExplorer(container, buildState(), stale);
        renderExplorer(container, buildState(), stale);
        renderExplorer(container, buildState(), latest);

        container.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

        expect(stale.onContextMenu).not.toHaveBeenCalled();
        expect(latest.onContextMenu).toHaveBeenCalledTimes(1);
    });

    it('turns off dragging on coarse-pointer devices', () => {
        const original = window.matchMedia;
        window.matchMedia = ((query: string) => ({ matches: query === '(pointer: coarse)' })) as unknown as typeof window.matchMedia;

        try {
            renderExplorer(container, buildState(), buildCallbacks());

            expect(row(container, 'data.json').getAttribute('draggable')).toBe('false');
        }
        finally {
            window.matchMedia = original;
        }
    });
});
