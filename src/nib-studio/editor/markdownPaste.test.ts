import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountEditor, type EditorHostHandle } from './editorHost.js';
import { clipboardEvent, ignoreSelectionChange, pressKey } from '../testing/testHelpers.js';

let handle: EditorHostHandle | null = null;

beforeEach(() => {
    document.addEventListener('selectionchange', ignoreSelectionChange, true);
});

afterEach(() => {
    handle?.destroy();
    handle = null;
    document.body.replaceChildren();
    document.removeEventListener('selectionchange', ignoreSelectionChange, true);
});

function mount(livePreview: boolean, text = 'Start: '): EditorHostHandle {
    const container = document.createElement('div');
    document.body.append(container);
    handle = mountEditor(container, { initialText: text, mode: 'markdown', livePreview, initialSelection: text.length });

    return handle;
}

function paste(target: EditorHostHandle, data: Readonly<Record<string, string>>): Event {
    const { event } = clipboardEvent('paste', data);
    target.view.contentDOM.dispatchEvent(event);

    return event;
}

const WEB_PAGE = {
    'text/html': '<h2>Plan</h2><p>Ship <strong>today</strong>, see <a href="https://example.com">notes</a></p><script>alert(1)</script>',
    'text/plain': 'Plan\nShip today, see notes',
};

describe('pasting in the Interactive view', () => {
    it('converts clipboard HTML to Markdown', () => {
        const editor = mount(true);

        const event = paste(editor, WEB_PAGE);

        expect(event.defaultPrevented).toBe(true);
        expect(editor.getValue()).toBe('Start: ## Plan\n\nShip **today**, see [notes](https://example.com)');
    });

    it('replaces the selection and leaves the caret after the pasted text', () => {
        const editor = mount(true, 'keep REPLACE keep');
        editor.view.dispatch({ selection: { anchor: 5, head: 12 } });

        paste(editor, { 'text/html': '<em>new</em>', 'text/plain': 'new' });

        expect(editor.getValue()).toBe('keep *new* keep');
        // After the pasted text, inside its hidden closing marker, so typing goes on in italic.
        expect(editor.view.state.selection.main.head).toBe('keep *new'.length);
    });

    it('pastes plain text as is', () => {
        const editor = mount(true);

        paste(editor, { 'text/plain': '**already** Markdown' });

        expect(editor.getValue()).toBe('Start: **already** Markdown');
    });

    it('pastes the plain text of HTML without formatting', () => {
        const editor = mount(true);

        paste(editor, { 'text/html': '<span>a_b * c</span>', 'text/plain': 'a_b * c' });

        expect(editor.getValue()).toBe('Start: a_b * c');
    });

    it('pastes plain text after Ctrl+Shift+V', () => {
        const editor = mount(true);

        pressKey(editor.view.contentDOM, 'V', { ctrlKey: true, shiftKey: true });
        paste(editor, WEB_PAGE);

        expect(editor.getValue()).toBe('Start: Plan\nShip today, see notes');

        paste(editor, WEB_PAGE);

        expect(editor.getValue()).toContain('## Plan');
    });

    it('copies the Markdown source', () => {
        const editor = mount(true, '**bold** and [link](https://example.com)');
        // CodeMirror copies only while the page selection is in the editor.
        editor.view.focus();
        editor.view.dispatch({ selection: { anchor: 0, head: editor.view.state.doc.length } });
        const { event, written } = clipboardEvent('copy');

        editor.view.contentDOM.dispatchEvent(event);

        expect(written.get('text/plain')).toBe('**bold** and [link](https://example.com)');
        expect(written.has('text/html')).toBe(false);
    });
});

describe('pasting in the Editor view', () => {
    it('keeps the clipboard plain text', () => {
        const editor = mount(false);

        paste(editor, WEB_PAGE);

        expect(editor.getValue()).toBe('Start: Plan\nShip today, see notes');
    });
});
