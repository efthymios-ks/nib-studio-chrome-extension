import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SANDBOX_CHANNEL } from '../../common/html/sandboxMessages.js';
import { asRoot, FakeDirectoryHandle } from '../../common/fs/testing/fakeFileSystem.js';
import { drawSandboxPage } from '../testing/sandboxFrames.js';
import { openFileFixture, settleAsync } from '../testing/testHelpers.js';
import { disposeActiveMarkdownSplitEditor } from './markdownSplit.js';
import { renderHtmlSplit } from './htmlSplit.js';

describe('renderHtmlSplit', () => {
    let container: HTMLElement;
    let folder: FakeDirectoryHandle;
    const callbacks = { onChange: vi.fn(), onSave: vi.fn() };

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        folder = new FakeDirectoryHandle('workspace');
        folder.addFile('site/app.js', 'document.body.dataset.ran = "yes";');
        callbacks.onChange.mockClear();
        callbacks.onSave.mockClear();
    });

    afterEach(() => {
        disposeActiveMarkdownSplitEditor();
        container.remove();
    });

    function editorView(): EditorView {
        return EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!)!;
    }

    function mount(text: string, onOpenLink = vi.fn()): ReturnType<typeof renderHtmlSplit> {
        return renderHtmlSplit(container, openFileFixture('site/page.html', text, { view: 'split' }), callbacks, {
            documentPath: 'site/page.html',
            root: asRoot(folder),
            onOpenLink,
            onSave: callbacks.onSave,
            delayMs: 10,
        });
    }

    it('shows the source beside the page in the sandbox page, with its scripts', async () => {
        mount('<p id="text">one</p><script src="app.js"></script><button onclick="go()">Go</button>');
        await settleAsync();
        const sandbox = drawSandboxPage(container);

        expect([...container.querySelectorAll('.split-pane-header')].map((header) => header.textContent)).toEqual(['Source', 'Preview']);
        expect(editorView().state.doc.toString()).toContain('<p id="text">one</p>');
        expect(sandbox.frame.closest('.split-pane-body')).not.toBeNull();
        expect(sandbox.frame.getAttribute('src')).toBe('sandbox.html');
        expect(sandbox.frame.getAttribute('sandbox')).toBe('allow-scripts allow-modals allow-forms');
        expect(sandbox.page()).toContain('onclick="go()"');
        expect(sandbox.page()).toMatch(/<script src="data:text\/javascript;charset=utf-8;base64,[^"]+"><\/script>/);
    });

    it('draws the page again in a new sandbox page once typing pauses, keeping the scroll', async () => {
        mount('<p>one</p>');
        await settleAsync();
        const first = drawSandboxPage(container);
        first.post({ channel: SANDBOX_CHANNEL, type: 'scroll', left: 0, top: 90 });

        editorView().dispatch({ changes: { from: 3, to: 6, insert: 'two' } });
        await settleAsync();
        const second = drawSandboxPage(container);

        expect(callbacks.onChange).toHaveBeenCalledWith('site/page.html', '<p>two</p>');
        expect(second.frame).not.toBe(first.frame);
        expect(second.received[0]).toMatchObject({ type: 'render', scroll: { left: 0, top: 90 } });
        expect(second.page()).toContain('<p>two</p>');
        expect(container.querySelectorAll('iframe.html-preview-frame')).toHaveLength(1);
    });

    it('saves on Ctrl+S in the page and follows its links', async () => {
        const onOpenLink = vi.fn();
        mount('<a href="other.html">other</a>', onOpenLink);
        await settleAsync();
        const sandbox = drawSandboxPage(container);

        sandbox.post({ channel: SANDBOX_CHANNEL, type: 'save' });
        sandbox.post({ channel: SANDBOX_CHANNEL, type: 'link', href: 'other.html' });

        expect(callbacks.onSave).toHaveBeenCalledTimes(1);
        expect(onOpenLink).toHaveBeenCalledWith({ path: 'site/other.html', fragment: null });
    });
});
