import { afterEach, describe, expect, it, vi } from 'vitest';
import { undo, redo, undoDepth } from '@codemirror/commands';
import { isLivePreviewOn, mountEditor, pruneEditorSessions, renameEditorSession, type EditorHostHandle } from './editorHost.js';
import { ignoreSelectionChange } from '../testing/testHelpers.js';

const SESSION_KEY = 'notes/todo.md';

document.addEventListener('selectionchange', ignoreSelectionChange, true);

function mount(text: string, livePreview = false, onChange?: (text: string) => void): EditorHostHandle {
    const container = document.createElement('div');
    document.body.append(container);

    return mountEditor(container, { initialText: text, mode: 'markdown', sessionKey: SESSION_KEY, livePreview, onChange });
}

afterEach(() => {
    pruneEditorSessions([]);
    document.body.replaceChildren();
});

describe('editor sessions', () => {
    it('keeps undo history when the editor is mounted again', () => {
        const first = mount('hello');
        first.view.dispatch({ changes: { from: 5, insert: ' world' }, userEvent: 'input' });
        first.destroy();

        const second = mount('hello world');
        undo(second.view);

        expect(second.getValue()).toBe('hello');

        redo(second.view);

        expect(second.getValue()).toBe('hello world');
        second.destroy();
    });

    it('turns text changed outside the editor into an undoable edit, without reporting it back', () => {
        const first = mount('{"a":1}');
        first.destroy();
        const onChange = vi.fn();

        const second = mount('{\n  "a": 1\n}', false, onChange);

        expect(second.getValue()).toBe('{\n  "a": 1\n}');
        expect(onChange).not.toHaveBeenCalled();

        undo(second.view);

        expect(second.getValue()).toBe('{"a":1}');
        expect(onChange).toHaveBeenCalledWith('{"a":1}');
        second.destroy();
    });

    it('keeps the text, caret and undo history between the Editor and Interactive views', () => {
        const editor = mount('# Plan\n\nship **it**');
        editor.view.dispatch({ changes: { from: 19, insert: ' now' }, userEvent: 'input.type' });
        editor.view.dispatch({ selection: { anchor: 3 } });

        expect(isLivePreviewOn(editor.view.state)).toBe(false);
        editor.destroy();

        const interactive = mount('# Plan\n\nship **it** now', true);

        expect(isLivePreviewOn(interactive.view.state)).toBe(true);
        expect(interactive.view.dom.getAttribute('data-live-preview')).toBe('true');
        expect(interactive.getValue()).toBe('# Plan\n\nship **it** now');
        expect(interactive.getSelectionHead()).toBe(3);

        interactive.view.dispatch({ selection: { anchor: 10 } });
        undo(interactive.view);

        expect(interactive.getValue()).toBe('# Plan\n\nship **it**');
        interactive.view.dispatch({ selection: { anchor: 12 } });
        interactive.destroy();

        const back = mount('# Plan\n\nship **it**');

        expect(isLivePreviewOn(back.view.state)).toBe(false);
        expect(back.view.dom.hasAttribute('data-live-preview')).toBe(false);
        expect(back.getSelectionHead()).toBe(12);

        redo(back.view);

        expect(back.getValue()).toBe('# Plan\n\nship **it** now');
        back.destroy();
    });
});

describe('renamed sessions', () => {
    it('carry the history of an editor still mounted under the old name', () => {
        const editor = mount('draft');
        editor.view.dispatch({ changes: { from: 5, insert: ' two' }, userEvent: 'input.type' });

        renameEditorSession(SESSION_KEY, 'notes/renamed.md');
        editor.destroy();
        const container = document.createElement('div');
        document.body.append(container);
        const renamed = mountEditor(container, { initialText: 'draft two', mode: 'markdown', sessionKey: 'notes/renamed.md' });
        undo(renamed.view);

        expect(renamed.getValue()).toBe('draft');
        renamed.destroy();
    });
});

describe('editor handle text changes', () => {
    it('syncs text without reporting it and sets text as a reported undo step', () => {
        const onChange = vi.fn();
        const handle = mount('alpha beta', false, onChange);

        handle.syncText('alpha beta');
        handle.syncText('alpha gamma');

        expect(handle.getValue()).toBe('alpha gamma');
        expect(onChange).not.toHaveBeenCalled();

        handle.setValue('alpha delta');

        expect(onChange).toHaveBeenCalledWith('alpha delta');

        undo(handle.view);

        expect(handle.getValue()).toBe('alpha gamma');
        handle.destroy();
    });

    it('treats text that differs only in its line breaks as no change', () => {
        const handle = mount('one\r\ntwo\r\n');
        handle.view.dispatch({ selection: { anchor: 5 } });

        handle.syncText('one\r\ntwo\r\n');

        expect(undoDepth(handle.view.state)).toBe(0);
        expect(handle.getSelectionHead()).toBe(5);
        handle.destroy();
    });
});
