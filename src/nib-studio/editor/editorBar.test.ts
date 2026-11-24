import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountEditor, type EditorHostHandle, type EditorMode } from './editorHost.js';
import { destroyLiveEditors, mountLiveEditor } from '../testing/liveEditor.js';
import { ignoreSelectionChange, pressKey } from '../testing/testHelpers.js';

let handle: EditorHostHandle | null = null;

beforeEach(() => {
    document.addEventListener('selectionchange', ignoreSelectionChange, true);
});

afterEach(() => {
    handle?.destroy();
    handle = null;
    destroyLiveEditors();
    document.body.replaceChildren();
    document.removeEventListener('selectionchange', ignoreSelectionChange, true);
});

function mount(mode: EditorMode, text = 'make it loud'): EditorHostHandle {
    const barSlot = document.createElement('div');
    const container = document.createElement('div');
    document.body.append(barSlot, container);
    handle = mountEditor(container, { initialText: text, mode, barSlot });

    return handle;
}

function bar(): HTMLElement {
    return document.querySelector<HTMLElement>('.editor-bar')!;
}

function button(command: string): HTMLButtonElement {
    return bar().querySelector<HTMLButtonElement>(`.editor-bar-button[data-command="${command}"]`)!;
}

function commands(): string[] {
    return [...bar().querySelectorAll<HTMLElement>('.editor-bar-button')].map((element) => element.dataset['command'] ?? '');
}

// A real click: the mousedown the bar has to keep from taking focus, then the click.
function press(element: HTMLElement): MouseEvent {
    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    element.dispatchEvent(mousedown);
    element.click();

    return mousedown;
}

function menuItems(): string[] {
    return [...bar().querySelectorAll('.editor-bar-menu-item')].map((item) => item.textContent ?? '');
}

describe('editor bar', () => {
    it('offers only undo and redo for other text files', () => {
        mount('json', '{}');

        expect(commands()).toEqual(['undo', 'redo']);
        expect(bar().getAttribute('role')).toBe('toolbar');
        expect(bar().querySelector('.editor-bar-separator')).toBeNull();
    });

    it('offers undo and redo, a divider, then the Markdown formats', () => {
        mount('markdown');

        expect(commands()).toEqual([
            'undo',
            'redo',
            'bold',
            'italic',
            'strikethrough',
            'inlineCode',
            'link',
            'heading',
            'quote',
            'codeBlock',
            'bulletedList',
            'numberedList',
            'taskList',
        ]);
        expect(bar().querySelectorAll('.editor-bar-separator')).toHaveLength(2);
        expect(button('undo').title).toBe('Undo (Ctrl+Z)');
        expect(button('redo').title).toBe('Redo (Ctrl+Y)');
        expect(button('bold').title).toBe('Bold (Ctrl+B)');
        expect(button('bold').getAttribute('aria-label')).toBe('Bold');
    });

    it('disables undo and redo while there is nothing to undo or redo, live', () => {
        const editor = mount('plain', 'abc');

        expect(button('undo').getAttribute('aria-disabled')).toBe('true');
        expect(button('redo').getAttribute('aria-disabled')).toBe('true');

        editor.view.dispatch({ changes: { from: 3, insert: 'd' }, userEvent: 'input.type' });

        expect(button('undo').getAttribute('aria-disabled')).toBe('false');

        press(button('undo'));

        expect(editor.getValue()).toBe('abc');
        expect(button('undo').getAttribute('aria-disabled')).toBe('true');
        expect(button('redo').getAttribute('aria-disabled')).toBe('false');

        press(button('redo'));

        expect(editor.getValue()).toBe('abcd');

        press(button('redo'));

        expect(editor.getValue()).toBe('abcd');
    });

    it('keeps focus and the selection in the editor when a button is pressed', () => {
        const editor = mount('markdown');
        editor.view.focus();
        editor.view.dispatch({ selection: { anchor: 8, head: 12 } });

        const mousedown = press(button('bold'));

        expect(mousedown.defaultPrevented).toBe(true);
        expect(editor.getValue()).toBe('make it **loud**');
        expect(editor.view.contentDOM.contains(document.activeElement)).toBe(true);
        expect(editor.view.state.sliceDoc(editor.view.state.selection.main.from, editor.view.state.selection.main.to)).toBe('loud');
    });

    it('shows which formats the selection has, following the caret', () => {
        const editor = mount('markdown', 'plain **bold words** and *soft*');

        editor.view.dispatch({ selection: { anchor: 13 } });

        expect(button('bold').getAttribute('aria-pressed')).toBe('true');
        expect(button('italic').getAttribute('aria-pressed')).toBe('false');

        editor.view.dispatch({ selection: { anchor: 27 } });

        expect(button('bold').getAttribute('aria-pressed')).toBe('false');
        expect(button('italic').getAttribute('aria-pressed')).toBe('true');

        editor.view.dispatch({ selection: { anchor: 2 } });

        expect(button('italic').getAttribute('aria-pressed')).toBe('false');
    });

    it('formats the word at an empty caret', () => {
        const editor = mount('markdown');
        editor.view.dispatch({ selection: { anchor: 10 } });

        press(button('italic'));

        expect(editor.getValue()).toBe('make it *loud*');
        expect(editor.view.state.selection.main.head).toBe(11);
    });

    it('drops the heading menu from the bar and applies a level', () => {
        const editor = mount('markdown', 'Title');

        press(button('heading'));

        expect(button('heading').getAttribute('aria-expanded')).toBe('true');
        expect(menuItems()).toEqual(['Normal text', 'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6']);
        expect(bar().querySelector('[aria-checked="true"]')?.textContent).toBe('Normal text');

        press([...bar().querySelectorAll<HTMLElement>('.editor-bar-menu-item')][2]!);

        expect(editor.getValue()).toBe('## Title');
        expect(bar().querySelector<HTMLElement>('.editor-bar-menu')?.hidden).toBe(true);
        expect(button('heading').getAttribute('aria-expanded')).toBe('false');
        expect(button('heading').getAttribute('aria-pressed')).toBe('true');
    });

    it('closes a menu on Escape, on a click outside and on a second click of its button', () => {
        mount('markdown', 'let x;');
        const menu = (): HTMLElement => bar().querySelector<HTMLElement>('.editor-bar-menu')!;

        press(button('codeBlock'));
        expect(menu().hidden).toBe(false);
        expect(menuItems()).toContain('mermaid');

        pressKey(document.body, 'Escape');
        expect(menu().hidden).toBe(true);

        press(button('codeBlock'));
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        expect(menu().hidden).toBe(true);

        press(button('codeBlock'));
        press(button('codeBlock'));
        expect(menu().hidden).toBe(true);
    });

    it('moves between buttons with the arrow keys and opens a menu from the keyboard', () => {
        mount('markdown', 'Title');
        const undoButton = button('undo');

        expect(undoButton.tabIndex).toBe(0);

        undoButton.focus();
        pressKey(undoButton, 'ArrowRight');

        expect(document.activeElement).toBe(button('redo'));
        expect(button('redo').tabIndex).toBe(0);
        expect(undoButton.tabIndex).toBe(-1);

        pressKey(button('redo'), 'End');
        expect(document.activeElement).toBe(button('taskList'));

        button('heading').focus();
        button('heading').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
        expect(document.activeElement?.textContent).toBe('Normal text');

        pressKey(document.activeElement!, 'ArrowDown');
        expect(document.activeElement?.textContent).toBe('Heading 1');
    });

    it('shows Bold pressed wherever the caret is in bold text in the Interactive view, and not before it', () => {
        const editor = mountLiveEditor('plain **bold** more', { withBar: true });
        const shownBold = [...editor.view.contentDOM.querySelectorAll('span')].find((span) => span.textContent === 'bold');

        for (const position of [8, 10, 12, 14]) {
            editor.view.dispatch({ selection: { anchor: position }, userEvent: 'select.pointer' });

            expect(button('bold').getAttribute('aria-pressed')).toBe(String(position !== 8));
        }

        expect(shownBold).toBeDefined();
        expect(editor.view.contentDOM.textContent).toBe('plain bold more');
    });

    it('applies bold to the selected visible text in the Interactive view', () => {
        const editor = mountLiveEditor('plain «bold» more', { withBar: true });

        press(button('bold'));

        expect(editor.getValue()).toBe('plain **bold** more');
        expect(button('bold').getAttribute('aria-pressed')).toBe('true');

        press(button('bold'));

        expect(editor.getValue()).toBe('plain bold more');
    });

    it('opens the language menu under a code block label and relabels the block', () => {
        const editor = mountLiveEditor('intro\n\n```js\nlet x;\n```', { withBar: true });
        const label = editor.view.contentDOM.querySelector<HTMLElement>('.cm-live-code-language')!;

        label.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

        expect(bar().querySelector<HTMLElement>('.editor-bar-menu')?.hidden).toBe(false);
        expect(button('codeBlock').getAttribute('aria-expanded')).toBe('true');
        expect(menuItems()).toContain('Remove code block');

        const python = [...bar().querySelectorAll<HTMLElement>('.editor-bar-menu-item')].find((item) => item.textContent === 'python')!;
        press(python);

        expect(editor.getValue()).toBe('intro\n\n```python\nlet x;\n```');
        expect(editor.view.contentDOM.querySelector('.cm-live-code-language')?.textContent).toBe('python');
    });

    it('opens a menu under another element, placed from that element', () => {
        const editor = mount('markdown', 'let x;');
        const anchor = document.createElement('span');
        document.body.append(anchor);

        editor.view.dom.dispatchEvent(new CustomEvent('live-code-language', { detail: { anchor } }));
        const menu = bar().querySelector<HTMLElement>('.editor-bar-menu')!;

        expect(menu.hidden).toBe(false);
        expect(menu.style.top).not.toBe('');
        expect(menuItems()[0]).toBe('No language');

        press(button('heading'));

        expect(menu.style.top).toBe('');
    });

    it('is not mounted without a slot and goes away with the editor', () => {
        const container = document.createElement('div');
        document.body.append(container);
        const plain = mountEditor(container, { initialText: 'x', mode: 'markdown' });

        expect(document.querySelector('.editor-bar')).toBeNull();
        plain.destroy();

        mount('markdown');
        handle?.destroy();
        handle = null;

        expect(document.querySelector('.editor-bar')).toBeNull();
    });
});
