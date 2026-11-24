import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { mountEditor, type EditorHostHandle } from './editorHost.js';
import { indentListItems, outdentListItems } from './markdownListKeys.js';
import { ignoreSelectionChange, pressKey } from '../testing/testHelpers.js';

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

// Mounts a Markdown editor in either view with the caret where `|` is.
function mount(textWithCaret: string, livePreview = false): EditorHostHandle {
    const caret = textWithCaret.indexOf('|');
    const container = document.createElement('div');
    document.body.append(container);
    handle = mountEditor(container, {
        initialText: textWithCaret.replace('|', ''),
        mode: 'markdown',
        initialSelection: caret,
        livePreview,
    });

    return handle;
}

function withCaret(editor: EditorHostHandle): string {
    const head = editor.view.state.selection.main.head;
    const text = editor.getValue();

    return `${text.slice(0, head)}|${text.slice(head)}`;
}

function stateAt(textWithCaret: string): EditorState {
    const caret = textWithCaret.indexOf('|');

    return EditorState.create({ doc: textWithCaret.replace('|', ''), selection: EditorSelection.single(caret) });
}

function apply(state: EditorState, command: typeof indentListItems): string | null {
    const spec = command(state);

    return spec == null ? null : state.update(spec).state.doc.toString();
}

describe.each([
    ['Editor', false],
    ['Interactive', true],
])('list keys in the %s view', (_view, livePreview) => {
    it('continues a bulleted, numbered and task list on Enter', () => {
        const bullets = mount('- one|', livePreview);
        pressKey(bullets.view.contentDOM, 'Enter');
        expect(withCaret(bullets)).toBe('- one\n- |');
        bullets.destroy();

        const numbers = mount('1. one|', livePreview);
        pressKey(numbers.view.contentDOM, 'Enter');
        expect(withCaret(numbers)).toBe('1. one\n2. |');
        numbers.destroy();

        const tasks = mount('- [x] done|', livePreview);
        pressKey(tasks.view.contentDOM, 'Enter');
        expect(withCaret(tasks)).toBe('- [x] done\n- [ ] |');
    });

    it('continues a quote on Enter', () => {
        const editor = mount('> wise|', livePreview);

        pressKey(editor.view.contentDOM, 'Enter');

        expect(withCaret(editor)).toBe('> wise\n> |');
    });

    it('ends the list on Enter in an empty item', () => {
        const editor = mount('- one\n- |', livePreview);

        pressKey(editor.view.contentDOM, 'Enter');

        expect(editor.getValue().trimEnd()).toBe('- one');
        expect(editor.view.state.doc.lineAt(editor.view.state.selection.main.head).text).toBe('');
    });

    it('removes the marker on Backspace at the start of an item', () => {
        const editor = mount('- one\n- |two', livePreview);

        pressKey(editor.view.contentDOM, 'Backspace');

        expect(editor.getValue()).not.toContain('- two');
        expect(editor.getValue()).toContain('two');
    });

    it('nests an item under the one above on Tab and moves it back on Shift+Tab', () => {
        const editor = mount('- one\n- tw|o', livePreview);

        pressKey(editor.view.contentDOM, 'Tab');
        expect(withCaret(editor)).toBe('- one\n  - tw|o');

        pressKey(editor.view.contentDOM, 'Tab', { shiftKey: true });
        expect(withCaret(editor)).toBe('- one\n- tw|o');
    });
});

describe('indentListItems', () => {
    it('nests under the sibling text column, so numbered items line up', () => {
        expect(apply(stateAt('1. one\n2. tw|o'), indentListItems)).toBe('1. one\n   2. two');
    });

    it('moves an item together with its sub-items', () => {
        expect(apply(stateAt('- a\n- |b\n  - c\n- d'), indentListItems)).toBe('- a\n  - b\n    - c\n- d');
    });

    it('indents by one unit when there is no item above to nest under', () => {
        expect(apply(stateAt('- fir|st'), indentListItems)).toBe('  - first');
    });

    it('leaves lines that are not list items to the usual indent', () => {
        expect(indentListItems(stateAt('plain |text'))).toBeNull();
        expect(outdentListItems(stateAt('plain |text'))).toBeNull();
    });
});

describe('outdentListItems', () => {
    it('moves an item to its parent level', () => {
        expect(apply(stateAt('1. one\n   - tw|o'), outdentListItems)).toBe('1. one\n- two');
    });

    it('does nothing at the top level', () => {
        expect(apply(stateAt('- to|p'), outdentListItems)).toBe('- top');
    });
});
