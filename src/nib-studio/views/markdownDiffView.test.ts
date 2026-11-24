import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarkdownDiffDocument } from '../../common/diff/diffDocument.js';
import { buildMarkdownDiffDocument } from '../../common/diff/markdownDiffDocument.js';
import type { DiffSide } from '../app/store.js';
import type { DiffSideName } from './diffSideHeader.js';
import { createMarkdownDiffViewState, type DiffViewCallbacks, type MarkdownDiffViewState } from './diffViewState.js';
import { settleAsync } from '../testing/testHelpers.js';

// The page names the texts it was drawn from, so each test can tell which document it was given.
const { attachMarkdownDiffControls, renderDiffDocumentHtmlAsync } = vi.hoisted(() => ({
    attachMarkdownDiffControls: vi.fn(),
    renderDiffDocumentHtmlAsync: vi.fn(async (document: MarkdownDiffDocument) => {
        const side = (which: 'left' | 'right'): string => document.rows.map((row) => row[which]?.tokens[0]?.text).filter((text) => text != null).join(',');

        return `<p>${side('left')}|${side('right')}</p>`;
    }),
}));

vi.mock('../../common/diff/diffHtml.js', () => ({ renderDiffDocumentHtmlAsync }));
vi.mock('./markdownDiffControls.js', () => ({ attachMarkdownDiffControls }));
vi.mock('./mermaidBridge.js', () => ({ renderMermaidSvgAsync: vi.fn(async () => '<svg></svg>') }));

const { markdownDiffDocumentFor, renderMarkdownDiffView } = await import('./markdownDiffView.js');

function documentOf(original: string, modified: string): MarkdownDiffDocument {
    return buildMarkdownDiffDocument({
        original: { name: 'a.md', source: 'file', path: 'a.md' },
        modified: { name: 'b.md', source: 'file', path: 'b.md' },
        originalText: original,
        modifiedText: modified,
    });
}

function side(path: string, text: string): DiffSide {
    return { label: path, path, source: 'file', text };
}

describe('renderMarkdownDiffView', () => {
    let container: HTMLElement;
    let state: MarkdownDiffViewState;
    let callbacks: DiffViewCallbacks & { onSetSide: ReturnType<typeof vi.fn<DiffViewCallbacks['onSetSide']>>; onSwap: ReturnType<typeof vi.fn<() => void>> };

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        state = createMarkdownDiffViewState();
        callbacks = { onSetSide: vi.fn<DiffViewCallbacks['onSetSide']>(), onSwap: vi.fn<() => void>() };
        renderDiffDocumentHtmlAsync.mockClear();
        attachMarkdownDiffControls.mockClear();
    });

    afterEach(() => {
        container.remove();
        document.querySelectorAll('.toast-stack').forEach((stack) => stack.remove());
    });

    function frame(): HTMLIFrameElement {
        return container.querySelector<HTMLIFrameElement>('iframe.markdown-diff-frame')!;
    }

    it('renders the toolbar, the sides bar and a sandboxed frame', () => {
        renderMarkdownDiffView(container, { original: side('docs/a.md', '# A'), modified: side('docs/b.md', '# B'), state, callbacks });

        expect(container.querySelector('.editor-toolbar [data-action="swap"]')).not.toBeNull();
        expect(frame().getAttribute('sandbox')).toBe('allow-same-origin');
        expect(frame().getAttribute('title')).toBe('Markdown diff');
    });

    it('builds the diff document with the side names, draws its page with the diagram renderer, and caches both', async () => {
        renderMarkdownDiffView(container, { original: side('docs/a.md', '# A'), modified: side('docs/b.md', '# B'), state, callbacks });
        await settleAsync();

        expect(renderDiffDocumentHtmlAsync).toHaveBeenCalledTimes(1);
        const [document, options] = renderDiffDocumentHtmlAsync.mock.calls[0] as unknown as [MarkdownDiffDocument, { renderMermaid: unknown }];
        expect(document.kind).toBe('markdown');
        expect(document.original).toEqual({ name: 'a.md', source: 'file', path: 'docs/a.md' });
        expect(document.markdown.modified.path).toBe('b.md');
        expect(typeof options.renderMermaid).toBe('function');
        expect(frame().srcdoc).toBe('<p># A|# B</p>');
        expect(state.cache).toEqual({ original: '# A', modified: '# B', html: '<p># A|# B</p>', document });
    });

    it('reuses the cached page and its document when the texts are unchanged', async () => {
        const document = documentOf('# A', '# B');
        state.cache = { original: '# A', modified: '# B', html: '<p>cached</p>', document };

        renderMarkdownDiffView(container, { original: side('a.md', '# A'), modified: side('b.md', '# B'), state, callbacks });
        await settleAsync();

        expect(renderDiffDocumentHtmlAsync).not.toHaveBeenCalled();
        expect(frame().srcdoc).toBe('<p>cached</p>');
        expect(markdownDiffDocumentFor({ original: side('a.md', '# A'), modified: side('b.md', '# B'), state })).toBe(document);
    });

    it('rebuilds when a side text changed', async () => {
        state.cache = { original: '# A', modified: '# B', html: '<p>cached</p>', document: documentOf('# A', '# B') };

        renderMarkdownDiffView(container, { original: side('a.md', '# A'), modified: side('b.md', '# C'), state, callbacks });
        await settleAsync();

        expect(renderDiffDocumentHtmlAsync).toHaveBeenCalledTimes(1);
        expect(frame().srcdoc).toBe('<p># A|# C</p>');
    });

    it('has no diff document while a side is missing', () => {
        expect(markdownDiffDocumentFor({ original: side('a.md', '# A'), modified: null, state })).toBeNull();
    });

    it('shows a failure toast when the diff cannot be built', async () => {
        renderDiffDocumentHtmlAsync.mockRejectedValueOnce(new Error('Diff exploded.'));

        renderMarkdownDiffView(container, { original: side('a.md', 'x'), modified: side('b.md', 'y'), state, callbacks });
        await settleAsync();

        const failure = [...document.querySelectorAll<HTMLElement>('.toast')].find((toast) => toast.dataset['tone'] === 'fail');
        expect(failure?.textContent).toBe('Diff exploded.');
        expect(state.cache).toBeNull();
    });

    it('shows the drop zone for the missing side instead of a frame', () => {
        const onTarget: Array<(target: DiffSide) => void> = [];
        const targetDropZone = vi.fn((onChoose: (target: DiffSide) => void) => {
            onTarget.push(onChoose);

            return Object.assign(document.createElement('div'), { className: 'fake-drop-zone' });
        });

        renderMarkdownDiffView(container, { original: side('a.md', 'x'), modified: null, state, callbacks: { ...callbacks, targetDropZone } });
        onTarget[0]?.(side('c.md', 'z'));

        expect(frame()).toBeNull();
        expect(container.querySelector('.fake-drop-zone')).not.toBeNull();
        expect(callbacks.onSetSide).toHaveBeenCalledWith('modified' satisfies DiffSideName, side('c.md', 'z'));
        expect(renderDiffDocumentHtmlAsync).not.toHaveBeenCalled();
    });

    it('wires the frame controls on load and keeps the chosen view in state', () => {
        state.view = 'after';
        state.scrollY = 240;
        renderMarkdownDiffView(container, { original: side('a.md', 'x'), modified: side('b.md', 'y'), state, callbacks });
        // happy-dom does not load iframes, so give the frame a document and window of its own.
        const frameDocument = document.implementation.createHTMLDocument('diff');
        frameDocument.body.innerHTML = '<div class="md-bar"></div>';
        const frameWindow = Object.assign(new EventTarget(), { scrollY: 0, scrollTo: vi.fn() });
        Object.defineProperty(frame(), 'contentDocument', { value: frameDocument });
        Object.defineProperty(frame(), 'contentWindow', { value: frameWindow });

        frame().dispatchEvent(new Event('load'));

        expect(frameWindow.scrollTo).toHaveBeenCalledWith(0, 240);
        frameWindow.scrollY = 512;
        frameWindow.dispatchEvent(new Event('scroll'));
        expect(state.scrollY).toBe(512);

        expect(attachMarkdownDiffControls).toHaveBeenCalledTimes(1);
        const options = attachMarkdownDiffControls.mock.calls[0]?.[1] as { initialView: string; onViewChange: (view: string) => void };
        expect(options.initialView).toBe('after');

        options.onViewChange('before');
        expect(state.view).toBe('before');

        options.onViewChange('bogus');
        expect(state.view).toBe('diff');
    });

    it('skips the controls when the frame has no diff bar', () => {
        renderMarkdownDiffView(container, { original: side('a.md', 'x'), modified: side('b.md', 'y'), state, callbacks });

        frame().dispatchEvent(new Event('load'));

        expect(attachMarkdownDiffControls).not.toHaveBeenCalled();
    });
});
