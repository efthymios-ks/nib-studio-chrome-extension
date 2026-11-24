import { beforeEach, describe, expect, it } from 'vitest';
import { registerTreeKeybindings, type TreeKeybindingCallbacks } from './keybindings.js';

interface Recorder {
    focused: string | null;
    opened: string[];
    expanded: Set<string>;
    collapsed: string[];
    renamed: string[];
    deleted: number;
    duplicated: string[];
    selectedAll: number;
    cleared: number;
}

function makeTree(): { paths: ReadonlyArray<string>; isDirectory: (p: string) => boolean; parentOf: (p: string) => string | null; firstChildOf: (p: string) => string | null } {
    const paths = ['src', 'src/a.ts', 'src/b.ts', 'README.md'];
    const directories = new Set(['src']);

    return {
        paths,
        isDirectory: (path: string) => directories.has(path),
        parentOf: (path: string) => {
            const index = path.lastIndexOf('/');

            return index < 0 ? '' : path.slice(0, index);
        },
        firstChildOf: (path: string) => {
            if (path === 'src') {
                return 'src/a.ts';
            }

            return null;
        },
    };
}

function mountCallbacks(tree: ReturnType<typeof makeTree>, recorder: Recorder): TreeKeybindingCallbacks {
    return {
        getFocusedPath: () => recorder.focused,
        getVisiblePaths: () => tree.paths,
        isDirectory: tree.isDirectory,
        isExpanded: (path) => recorder.expanded.has(path),
        getParentOf: tree.parentOf,
        getFirstChildOf: tree.firstChildOf,
        focusPath: (path) => { recorder.focused = path; },
        onOpen: (path) => recorder.opened.push(path),
        onExpand: (path) => recorder.expanded.add(path),
        onCollapse: (path) => recorder.collapsed.push(path),
        onRename: (path) => recorder.renamed.push(path),
        onDelete: () => { recorder.deleted += 1; },
        onDuplicate: (path) => recorder.duplicated.push(path),
        onSelectAll: () => { recorder.selectedAll += 1; },
        onClearSelection: () => { recorder.cleared += 1; },
    };
}

function dispatch(container: HTMLElement, init: KeyboardEventInit): void {
    const event = new KeyboardEvent('keydown', { ...init, bubbles: true });
    container.dispatchEvent(event);
}

describe('registerTreeKeybindings', () => {
    let container: HTMLElement;
    let recorder: Recorder;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        recorder = {
            focused: null,
            opened: [],
            expanded: new Set(),
            collapsed: [],
            renamed: [],
            deleted: 0,
            duplicated: [],
            selectedAll: 0,
            cleared: 0,
        };
    });

    it('moves focus with ArrowDown and ArrowUp', () => {
        const tree = makeTree();
        registerTreeKeybindings(container, mountCallbacks(tree, recorder));
        dispatch(container, { key: 'ArrowDown' });

        expect(recorder.focused).toBe('src');
        dispatch(container, { key: 'ArrowDown' });
        expect(recorder.focused).toBe('src/a.ts');
        dispatch(container, { key: 'ArrowUp' });
        expect(recorder.focused).toBe('src');
    });

    it('collapses an open folder on ArrowLeft, otherwise moves to parent', () => {
        const tree = makeTree();
        recorder.focused = 'src';
        recorder.expanded.add('src');
        registerTreeKeybindings(container, mountCallbacks(tree, recorder));
        dispatch(container, { key: 'ArrowLeft' });

        expect(recorder.collapsed).toEqual(['src']);

        recorder.focused = 'src/a.ts';
        dispatch(container, { key: 'ArrowLeft' });
        expect(recorder.focused).toBe('src');
    });

    it('expands a closed folder on ArrowRight, otherwise moves to first child', () => {
        const tree = makeTree();
        recorder.focused = 'src';
        registerTreeKeybindings(container, mountCallbacks(tree, recorder));
        dispatch(container, { key: 'ArrowRight' });

        expect(recorder.expanded.has('src')).toBe(true);
        dispatch(container, { key: 'ArrowRight' });
        expect(recorder.focused).toBe('src/a.ts');
    });

    it('opens a focused file on Enter', () => {
        const tree = makeTree();
        recorder.focused = 'README.md';
        registerTreeKeybindings(container, mountCallbacks(tree, recorder));
        dispatch(container, { key: 'Enter' });

        expect(recorder.opened).toEqual(['README.md']);
    });

    it('fires rename on F2', () => {
        const tree = makeTree();
        recorder.focused = 'README.md';
        registerTreeKeybindings(container, mountCallbacks(tree, recorder));
        dispatch(container, { key: 'F2' });

        expect(recorder.renamed).toEqual(['README.md']);
    });

    it('fires delete on Delete', () => {
        const tree = makeTree();
        recorder.focused = 'README.md';
        registerTreeKeybindings(container, mountCallbacks(tree, recorder));
        dispatch(container, { key: 'Delete' });

        expect(recorder.deleted).toBe(1);
    });

    it('duplicates on Ctrl+D', () => {
        const tree = makeTree();
        recorder.focused = 'README.md';
        registerTreeKeybindings(container, mountCallbacks(tree, recorder));
        dispatch(container, { key: 'd', ctrlKey: true });

        expect(recorder.duplicated).toEqual(['README.md']);
    });

    it('duplicates on Ctrl+D with a second layout such as Greek, and keeps the key from the browser\'s bookmark', () => {
        const tree = makeTree();
        recorder.focused = 'README.md';
        registerTreeKeybindings(container, mountCallbacks(tree, recorder));
        const event = new KeyboardEvent('keydown', { key: 'δ', code: 'KeyD', ctrlKey: true, bubbles: true, cancelable: true });
        container.dispatchEvent(event);

        expect(recorder.duplicated).toEqual(['README.md']);
        expect(event.defaultPrevented).toBe(true);
    });

    it('selects all on Ctrl+A', () => {
        const tree = makeTree();
        registerTreeKeybindings(container, mountCallbacks(tree, recorder));
        dispatch(container, { key: 'a', ctrlKey: true });

        expect(recorder.selectedAll).toBe(1);
    });

    it('clears selection on Escape', () => {
        const tree = makeTree();
        registerTreeKeybindings(container, mountCallbacks(tree, recorder));
        dispatch(container, { key: 'Escape' });

        expect(recorder.cleared).toBe(1);
    });

    it('dispose() removes the listener', () => {
        const tree = makeTree();
        const handle = registerTreeKeybindings(container, mountCallbacks(tree, recorder));
        handle.dispose();
        dispatch(container, { key: 'Escape' });

        expect(recorder.cleared).toBe(0);
    });
});
