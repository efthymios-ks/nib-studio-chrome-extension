import { ensureSyntaxTree, foldable, syntaxTree } from '@codemirror/language';
import { forceLinting, forEachDiagnostic } from '@codemirror/lint';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectMode, isLivePreviewOn, mountEditor, type EditorHostHandle } from './editorHost.js';

let activeHandle: EditorHostHandle | null = null;
let activeContainer: HTMLElement | null = null;

afterEach(() => {
    activeHandle?.destroy();
    activeContainer?.remove();
    activeHandle = null;
    activeContainer = null;
});

function mount(initialText: string, initialSelection?: number): EditorHostHandle {
    activeContainer = document.createElement('div');
    document.body.append(activeContainer);
    activeHandle = mountEditor(activeContainer, {
        initialText,
        mode: 'plain',
        initialSelection,
    });

    return activeHandle;
}

describe('mountEditor handle', () => {
    it('exposes getValue returning the current document', () => {
        const handle = mount('alpha\nbeta');
        expect(handle.getValue()).toBe('alpha\nbeta');
    });

    it('exposes the selection head through the view state', () => {
        const handle = mount('alpha\nbeta', 3);
        expect(handle.view.state.selection.main.head).toBe(3);
    });

    it('returns the selection head via getSelectionHead', () => {
        const handle = mount('abcdef', 4);
        expect(handle.getSelectionHead()).toBe(4);
    });

    it('clamps an out-of-range initialSelection to the document length', () => {
        const handle = mount('abc', 100);
        expect(handle.getSelectionHead()).toBe(3);
    });
});

describe('multiple selections', () => {
    function press(handle: EditorHostHandle, init: KeyboardEventInit): void {
        handle.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    }

    function selectedTexts(handle: EditorHostHandle): string[] {
        return handle.view.state.selection.ranges.map((range) => handle.view.state.sliceDoc(range.from, range.to));
    }

    it('adds the next occurrence of the word with Ctrl+D, each time it is pressed', () => {
        const handle = mount('the cat and the dog and the bird', 1);

        press(handle, { key: 'd', code: 'KeyD', keyCode: 68, ctrlKey: true });
        expect(selectedTexts(handle)).toEqual(['the']);

        press(handle, { key: 'd', code: 'KeyD', keyCode: 68, ctrlKey: true });
        press(handle, { key: 'd', code: 'KeyD', keyCode: 68, ctrlKey: true });

        expect(selectedTexts(handle)).toEqual(['the', 'the', 'the']);
    });

    it('adds the next occurrence with Ctrl+D on a second layout such as Greek', () => {
        const handle = mount('the cat and the dog', 1);

        press(handle, { key: 'δ', code: 'KeyD', keyCode: 68, ctrlKey: true });
        press(handle, { key: 'δ', code: 'KeyD', keyCode: 68, ctrlKey: true });

        expect(selectedTexts(handle)).toEqual(['the', 'the']);
    });

    it('selects every occurrence of the selection with Ctrl+Shift+L', () => {
        const handle = mount('the cat and the dog and the bird', 1);
        press(handle, { key: 'd', code: 'KeyD', keyCode: 68, ctrlKey: true });

        press(handle, { key: 'L', code: 'KeyL', keyCode: 76, ctrlKey: true, shiftKey: true });

        expect(handle.view.state.selection.ranges).toHaveLength(3);
    });

    it('selects every occurrence with Ctrl+Shift+L after Ctrl+D has added some, as the plan presses them', () => {
        const handle = mount('the cat, the dog, the bird and the fish, then the other', 1);
        press(handle, { key: 'd', code: 'KeyD', keyCode: 68, ctrlKey: true });
        press(handle, { key: 'd', code: 'KeyD', keyCode: 68, ctrlKey: true });
        press(handle, { key: 'd', code: 'KeyD', keyCode: 68, ctrlKey: true });
        const event = new KeyboardEvent('keydown', { key: 'L', code: 'KeyL', keyCode: 76, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });

        handle.view.contentDOM.dispatchEvent(event);

        // Whole words only, as Ctrl+D picked a whole word: not the `the` in `then` or `other`.
        expect(handle.view.state.selection.ranges.map((range) => range.from)).toEqual([0, 9, 18, 31, 46]);
        expect(event.defaultPrevented).toBe(true);
    });

    it('selects every occurrence of the word at the caret with Ctrl+Shift+L when nothing is selected', () => {
        const handle = mount('dog cat dog', 1);

        press(handle, { key: 'L', code: 'KeyL', keyCode: 76, ctrlKey: true, shiftKey: true });

        expect(selectedTexts(handle)).toEqual(['dog', 'dog']);
    });

    it('draws every selection and cursor, not only the main one', () => {
        const handle = mount('alpha');

        expect(handle.view.dom.querySelector('.cm-selectionLayer')).not.toBeNull();
        expect(handle.view.dom.querySelector('.cm-cursorLayer')).not.toBeNull();
    });
});

describe('HTML files', () => {
    it('open in the html mode, .htm too', () => {
        expect(detectMode('page.html')).toBe('html');
        expect(detectMode('OLD.HTM')).toBe('html');
        expect(detectMode('notes.md')).toBe('markdown');
    });

    it('highlight HTML, and dock Undo, Redo and the HTML formatting buttons above the text', () => {
        activeContainer = document.createElement('div');
        const barSlot = document.createElement('div');
        document.body.append(activeContainer, barSlot);
        activeHandle = mountEditor(activeContainer, { initialText: '<p class="x">Hi</p>', mode: 'html', barSlot });
        const content = activeHandle.view.contentDOM;

        expect(content.getAttribute('data-language')).toBe('html');
        expect(syntaxTree(activeHandle.view.state).topNode.name).toBe('Document');
        expect([...barSlot.querySelectorAll('[data-command]')].map((button) => button.getAttribute('data-command'))).toEqual([
            'undo', 'redo', 'bold', 'italic', 'link', 'heading', 'bulletedList', 'numberedList',
        ]);
        expect(isLivePreviewOn(activeHandle.view.state)).toBe(false);
        barSlot.remove();
    });

    it('show the page in the Interactive view when asked, and only for HTML or Markdown', () => {
        activeContainer = document.createElement('div');
        document.body.append(activeContainer);
        activeHandle = mountEditor(activeContainer, { initialText: '<p>Hi</p>', mode: 'html', livePreview: true });

        expect(isLivePreviewOn(activeHandle.view.state)).toBe(true);
        expect(activeHandle.view.dom.getAttribute('data-live-kind')).toBe('html');
    });
});

describe('YAML files', () => {
    function mountYaml(initialText: string): EditorHostHandle {
        activeContainer = document.createElement('div');
        document.body.append(activeContainer);
        activeHandle = mountEditor(activeContainer, { initialText, mode: 'yaml' });

        return activeHandle;
    }

    function diagnosticsOf(handle: EditorHostHandle): string[] {
        const found: string[] = [];
        forEachDiagnostic(handle.view.state, (diagnostic, from, to) => {
            found.push(`${diagnostic.severity} ${from}-${to} ${diagnostic.message}`);
        });

        return found;
    }

    it('open in the yaml mode, .yml too', () => {
        expect(detectMode('config.yaml')).toBe('yaml');
        expect(detectMode('CI.YML')).toBe('yaml');
    });

    it('highlight YAML and fold a nested map', () => {
        const handle = mountYaml('server:\n  host: localhost\n  port: 80\nname: demo\n');
        const state = handle.view.state;
        ensureSyntaxTree(state, state.doc.length, 1_000);
        const firstLine = state.doc.line(1);

        expect(handle.view.contentDOM.getAttribute('data-language')).toBe('yaml');
        expect(foldable(state, firstLine.from, firstLine.to)).toEqual({ from: firstLine.to, to: state.doc.line(3).to });
    });

    it('mark a syntax error with its line and column, and a repeated key as a warning', async () => {
        const handle = mountYaml('a: 1\nb: [1, 2\nc: 3\n');
        forceLinting(handle.view);

        await vi.waitFor(() => {
            expect(diagnosticsOf(handle)).toEqual([
                'error 14-15 Flow sequence in block collection must be sufficiently indented and end with a ] (line 3, column 1).',
            ]);
        });

        handle.setValue('a: 1\nb: 2\na: 3\n');
        forceLinting(handle.view);

        await vi.waitFor(() => {
            expect(diagnosticsOf(handle)).toEqual(['warning 10-11 The key a is repeated; the last value wins (line 3, column 1).']);
        });
    });
});
