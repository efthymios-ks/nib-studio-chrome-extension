import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenFile } from '../app/store.js';
import { stubClipboard, type FakeClipboard } from '../testing/fakeClipboard.js';
import { blurEditor, buttonByText, ignoreSelectionChange, openFileFixture, settleAsync, toastTexts } from '../testing/testHelpers.js';
import { renderFilesSurface, setFilesSurfaceView, type FilesSurfaceCallbacks, type FilesSurfaceState } from './filesSurface.js';

vi.mock('./mermaidBridge.js', () => ({
    renderMermaidIntoAsync: vi.fn(async () => {}),
    renderMermaidSvgAsync: vi.fn(async () => '<svg></svg>'),
    buildMermaidTools: vi.fn(() => document.createElement('div')),
}));

function buildCallbacks(): FilesSurfaceCallbacks {
    return {
        onActivate: vi.fn(),
        onClose: vi.fn(),
        onChange: vi.fn(),
        onSave: vi.fn(),
        onPickWorkspace: vi.fn(),
        onReopenWorkspace: vi.fn(),
        onCompareWith: vi.fn(),
        diffTab: { onSetSide: vi.fn(), onSwap: vi.fn() },
    };
}

function stateFor(file: OpenFile | null): FilesSurfaceState {
    return {
        workspaceOpen: true,
        tabs: file == null ? [] : [file],
        activeId: file?.path ?? null,
        activeFile: file,
        activeDiff: null,
    };
}

// The copy buttons of the file toolbar, by label, the narrow window's Copy menu button left out.
function copyLabels(container: HTMLElement): string[] {
    return [...container.querySelectorAll<HTMLElement>('.editor-toolbar .copy-action')].map((button) => button.textContent ?? '');
}

// The labels of the file toolbar's right-hand group, in order.
function actionLabels(container: HTMLElement): string[] {
    const group = container.querySelectorAll('.editor-toolbar > .toolbar-group')[1];

    return [...group?.querySelectorAll<HTMLElement>('.copy-action, :scope > .button, :scope > .badge') ?? []].map((element) => element.textContent ?? '');
}

describe('copy buttons in the file toolbar', () => {
    let container: HTMLElement;
    let callbacks: FilesSurfaceCallbacks;
    let clipboard: FakeClipboard;

    beforeEach(() => {
        localStorage.clear();
        setFilesSurfaceView('editor');
        container = document.createElement('div');
        document.body.append(container);
        callbacks = buildCallbacks();
        clipboard = stubClipboard();
        document.addEventListener('selectionchange', ignoreSelectionChange, true);
    });

    afterEach(() => {
        blurEditor();
        renderFilesSurface(container, { ...stateFor(null), workspaceOpen: false }, callbacks);
        container.remove();
        clipboard.restore();
        document.removeEventListener('selectionchange', ignoreSelectionChange, true);
        document.querySelectorAll('.toast-stack').forEach((stack) => stack.remove());
    });

    it.each(['editor', 'interactive', 'split', 'preview'])('shows Copy raw and Copy formatted in a Markdown file\'s %s view', (view) => {
        setFilesSurfaceView(view);

        renderFilesSurface(container, stateFor(openFileFixture(`copy-views-${view}/notes.md`, '# Notes')), callbacks);

        expect(copyLabels(container)).toEqual(['Copy raw', 'Copy formatted']);
        expect(container.querySelector('.editor-toolbar .copy-menu-button')).not.toBeNull();
    });

    it('groups the copy buttons before Compare with… and Saved', () => {
        renderFilesSurface(container, stateFor(openFileFixture('copy-order/data.json', '{}')), callbacks);

        expect(actionLabels(container)).toEqual(['Copy raw', 'Copy formatted', 'Compare with…', 'Format', 'Minify', 'Saved']);
    });

    it.each([
        ['copy-kinds/main.ts', ['Copy content']],
        ['copy-kinds/notes.txt', ['Copy content']],
        ['copy-kinds/page.html', ['Copy raw', 'Copy formatted']],
        ['copy-kinds/app.yaml', ['Copy raw', 'Copy formatted']],
        ['copy-kinds/feed.xml', ['Copy raw', 'Copy formatted']],
        ['copy-kinds/users.csv', ['Copy raw', 'Copy formatted']],
    ])('shows %s the copy buttons that apply', (path, labels) => {
        renderFilesSurface(container, stateFor(openFileFixture(path, 'a,b\n1,2\n')), callbacks);

        expect(copyLabels(container)).toEqual(labels);
    });

    it('shows a workbook Copy formatted only, and a PDF or picture none of them', () => {
        renderFilesSurface(container, stateFor(openFileFixture('copy-kinds/sales.xlsx', '', { file: new File([''], 'sales.xlsx') })), callbacks);
        expect(copyLabels(container)).toEqual(['Copy formatted']);

        for (const path of ['copy-kinds/paper.pdf', 'copy-kinds/photo.png']) {
            renderFilesSurface(container, stateFor(openFileFixture(path, '', { file: new File([''], path) })), callbacks);
            expect(container.querySelector('.copy-action, .copy-menu-button'), path).toBeNull();
        }
    });

    it('copies the editor\'s text, typed and not yet saved', async () => {
        renderFilesSurface(container, stateFor(openFileFixture('copy-typed/main.ts', 'saved();')), callbacks);
        const view = EditorView.findFromDOM(container.querySelector('.cm-content') as HTMLElement) as EditorView;
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'typed();' } });

        buttonByText(container, 'Copy content')?.click();
        await settleAsync();

        expect(clipboard.writeText).toHaveBeenCalledWith('typed();');
        expect(toastTexts()).toContain('Content copied.');
    });

    it('copies formatted Markdown from the Preview view as rich HTML', async () => {
        setFilesSurfaceView('preview');
        renderFilesSurface(container, stateFor(openFileFixture('copy-preview/plan.md', '# Plan\n\n- one\n', { dirty: true })), callbacks);

        buttonByText(container, 'Copy formatted')?.click();
        await settleAsync();

        expect(clipboard.last().get('text/html')).toContain('<h1 id="plan">Plan</h1>');
        expect(clipboard.last().get('text/plain')).toBe('Plan\n\n- one');
    });
});
