import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountEditor, type EditorHostHandle, type EditorMode } from './editorHost.js';
import { markdownFormattingButtonGroups, runMarkdownFormat } from './markdownFormattingToolbar.js';
import { MARKDOWN_FORMATS } from './markdownFormatting.js';
import { ignoreSelectionChange, pressKey } from '../testing/testHelpers.js';

let activeHandle: EditorHostHandle | null = null;

beforeEach(() => {
    document.addEventListener('selectionchange', ignoreSelectionChange, true);
});

afterEach(() => {
    activeHandle?.destroy();
    activeHandle = null;
    document.body.replaceChildren();
    document.removeEventListener('selectionchange', ignoreSelectionChange, true);
});

function mount(mode: EditorMode, readOnly = false): EditorHostHandle {
    const container = document.createElement('div');
    document.body.append(container);
    activeHandle = mountEditor(container, { initialText: 'make it loud', mode, readOnly });

    return activeHandle;
}

function select(handle: EditorHostHandle, from: number, to: number): void {
    handle.view.dispatch({ selection: { anchor: from, head: to } });
}

describe('markdownFormattingToolbar', () => {
    it.each([
        ['b', {}, 'make it **loud**'],
        ['i', {}, 'make it *loud*'],
        ['x', { shiftKey: true }, 'make it ~~loud~~'],
        ['e', {}, 'make it `loud`'],
        ['k', {}, 'make it [loud](url)'],
    ])('applies Ctrl+%s', (key, modifiers, expected) => {
        const handle = mount('markdown');
        select(handle, 8, 12);

        const event = pressKey(handle.view.contentDOM, key, { ctrlKey: true, ...modifiers });

        expect(event.defaultPrevented).toBe(true);
        expect(handle.getValue()).toBe(expected);
    });

    it('leaves the shortcuts out of other modes and read-only Markdown', () => {
        const plain = mount('plain');
        select(plain, 8, 12);
        pressKey(plain.view.contentDOM, 'b', { ctrlKey: true });
        expect(plain.getValue()).toBe('make it loud');
        plain.destroy();

        const readOnly = mount('markdown', true);
        select(readOnly, 8, 12);
        pressKey(readOnly.view.contentDOM, 'b', { ctrlKey: true });
        expect(readOnly.getValue()).toBe('make it loud');
    });

    it('groups the bar buttons into inline then block formats, every format once', () => {
        const groups = markdownFormattingButtonGroups();

        expect(groups.map((group) => group.length)).toEqual([5, 6]);
        expect(groups.flat().map((button) => button.id)).toEqual(MARKDOWN_FORMATS.map((format) => format.id));
        expect(groups[1]?.filter((button) => button.menu != null).map((button) => button.id)).toEqual(['heading', 'codeBlock']);
    });

    it('runs a format unless the editor is read only', () => {
        const bold = MARKDOWN_FORMATS.find((format) => format.id === 'bold')!;
        const handle = mount('markdown');
        select(handle, 0, 4);

        expect(runMarkdownFormat(handle.view, bold)).toBe(true);
        expect(handle.getValue()).toBe('**make** it loud');
        handle.destroy();

        const readOnly = mount('markdown', true);

        expect(runMarkdownFormat(readOnly.view, bold)).toBe(false);
    });
});
