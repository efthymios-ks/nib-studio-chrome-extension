import { EditorView, runScopeHandlers } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenFile } from '../app/store.js';
import { pruneEditorSessions } from '../editor/editorHost.js';
import { openFileFixture } from '../testing/testHelpers.js';

const { renderMermaidIntoAsync } = vi.hoisted(() => ({
    renderMermaidIntoAsync: vi.fn(async () => {}),
}));

vi.mock('./mermaidBridge.js', () => ({ renderMermaidIntoAsync }));

const { disposeActiveMarkdownSplitEditor, renderMarkdownSplit } = await import('./markdownSplit.js');

function openFile(path: string, text: string): OpenFile {
    return openFileFixture(path, text, { view: 'split' });
}

describe('renderMarkdownSplit', () => {
    let container: HTMLElement;
    const callbacks = { onChange: vi.fn(), onSave: vi.fn() };

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        callbacks.onChange.mockClear();
        callbacks.onSave.mockClear();
        renderMermaidIntoAsync.mockClear();
    });

    afterEach(() => {
        disposeActiveMarkdownSplitEditor();
        container.remove();
    });

    function editorView(): EditorView {
        return EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!)!;
    }

    function preview(): HTMLElement {
        return container.querySelector<HTMLElement>('.markdown-preview')!;
    }

    it('renders a Source editor and a Preview pane separated by a resizer', () => {
        renderMarkdownSplit(container, openFile('split/a.md', '# Title'), callbacks);

        const headers = [...container.querySelectorAll('.split-pane-header')].map((header) => header.textContent);
        expect(headers).toEqual(['Source', 'Preview']);
        expect(container.querySelector('.split-resizer')).not.toBeNull();
        expect(editorView().state.doc.toString()).toBe('# Title');
        expect(preview().querySelector('h1')?.textContent).toBe('Title');
    });

    it('re-renders the preview and reports the change as the user types', () => {
        renderMarkdownSplit(container, openFile('split/b.md', 'old'), callbacks);

        editorView().dispatch({ changes: { from: 0, to: 3, insert: '## New heading' } });

        expect(callbacks.onChange).toHaveBeenCalledWith('split/b.md', '## New heading');
        expect(preview().querySelector('h2')?.textContent).toBe('New heading');
    });

    it('calls onSave with the file path on Mod-S', () => {
        renderMarkdownSplit(container, openFile('split/c.md', 'text'), callbacks);
        const isMac = /Mac/.test(navigator.platform);

        const handled = runScopeHandlers(editorView(), new KeyboardEvent('keydown', { key: 's', ctrlKey: !isMac, metaKey: isMac }), 'editor');

        expect(handled).toBe(true);
        expect(callbacks.onSave).toHaveBeenCalledWith('split/c.md');
    });

    it('renders mermaid placeholders through the bridge and binds code copy', () => {
        renderMarkdownSplit(container, openFile('split/d.md', '```mermaid\ngraph TD; A-->B\n```\n\n```js\nlet x = 1;\n```'), callbacks);

        expect(renderMermaidIntoAsync).toHaveBeenCalledTimes(1);
        const [placeholder, source] = renderMermaidIntoAsync.mock.calls[0] as unknown as [HTMLElement, string];
        expect(placeholder.dataset['mermaidId']).toBeDefined();
        expect(source).toContain('graph TD; A-->B');
        expect(preview().dataset['codeCopyBound']).toBe('true');
    });

    it('keeps only one editor alive when rendered again', () => {
        renderMarkdownSplit(container, openFile('split/e.md', 'one'), callbacks);
        renderMarkdownSplit(container, openFile('split/f.md', 'two'), callbacks);

        expect(container.querySelectorAll('.cm-editor')).toHaveLength(1);
        expect(editorView().state.doc.toString()).toBe('two');
    });

    it('restores the caret when the same file comes back with the same length', () => {
        const file = openFile('split/g.md', 'abcdef');
        renderMarkdownSplit(container, file, callbacks);
        editorView().dispatch({ selection: { anchor: 4 } });
        disposeActiveMarkdownSplitEditor();
        pruneEditorSessions([]);

        renderMarkdownSplit(container, file, callbacks);

        expect(editorView().state.selection.main.head).toBe(4);
    });

    it('starts at the top when the file length changed while away', () => {
        renderMarkdownSplit(container, openFile('split/h.md', 'abcdef'), callbacks);
        editorView().dispatch({ selection: { anchor: 4 } });
        disposeActiveMarkdownSplitEditor();
        pruneEditorSessions([]);

        renderMarkdownSplit(container, openFile('split/h.md', 'abcdefghij'), callbacks);

        expect(editorView().state.selection.main.head).toBe(0);
    });

    it('resizes the columns while dragging the resizer and stops on mouseup', () => {
        renderMarkdownSplit(container, openFile('split/i.md', 'x'), callbacks);
        const split = container.querySelector<HTMLElement>('.split')!;
        vi.spyOn(split, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 1000 } as DOMRect);

        container.querySelector<HTMLElement>('.split-resizer')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(document.body.dataset['resizing']).toBe('horizontal');

        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }));
        expect(split.style.getPropertyValue('--split-columns')).toBe('30% 6px 70%');

        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 10 }));
        expect(split.style.getPropertyValue('--split-columns')).toBe('10% 6px 90%');

        document.dispatchEvent(new MouseEvent('mouseup'));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 }));
        expect(document.body.dataset['resizing']).toBeUndefined();
        expect(split.style.getPropertyValue('--split-columns')).toBe('10% 6px 90%');
    });
});
