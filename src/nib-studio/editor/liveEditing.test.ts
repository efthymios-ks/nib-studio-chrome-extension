import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { redo, undo, undoDepth } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { destroyLiveEditors, markedText, mountLiveEditor, shownLines, typeAt } from '../testing/liveEditor.js';
import { clipboardEvent, ignoreSelectionChange, pressKey } from '../testing/testHelpers.js';
import { markdownForRange, visibleDeletion } from './liveEditing.js';

beforeEach(() => {
    document.addEventListener('selectionchange', ignoreSelectionChange, true);
});

afterEach(() => {
    destroyLiveEditors();
    // The shared context menu stays on the page, as in the app.
    document.body.replaceChildren(...document.querySelectorAll('.context-menu'));
    document.removeEventListener('selectionchange', ignoreSelectionChange, true);
});

function press(view: EditorView, key: string, modifiers: KeyboardEventInit = {}): string {
    pressKey(view.contentDOM, key, modifiers);

    return markedText(view);
}

function after(text: string, key: string, modifiers: KeyboardEventInit = {}): string {
    return press(mountLiveEditor(text).view, key, modifiers);
}

describe('Backspace and Delete next to hidden markers', () => {
    it.each([
        ['Backspace before bold text removes the space before it', 'plain ‸**bold** more', 'Backspace', 'plain‸**bold** more'],
        ['Backspace at the end of bold text removes its last letter', 'plain **bold‸** more', 'Backspace', 'plain **bol‸** more'],
        ['Backspace after the first letter of bold text removes that letter', 'plain **b‸old** more', 'Backspace', 'plain ‸**old** more'],
        ['Delete at the end of bold text removes the space after it', 'plain **bold‸** more', 'Delete', 'plain **bold‸**more'],
        ['Delete before bold text removes its first letter', 'plain ‸**bold** more', 'Delete', 'plain ‸**old** more'],
        ['Backspace after a link removes its last letter', 'see [docs](u)‸ x', 'Backspace', 'see [doc](u)‸ x'],
        ['Backspace after an escaped character removes it with its backslash', 'a \\*‸ b', 'Backspace', 'a ‸ b'],
        ['Backspace after inline code removes its last letter', 'run `npm‸` now', 'Backspace', 'run `np‸` now'],
    ])('%s', (_name, text, key, expected) => {
        expect(after(text, key)).toBe(expected);
    });

    it('removes a word with Ctrl+Backspace, moving the space it leaves past the closing markers', () => {
        expect(after('one **two three‸** four', 'Backspace', { ctrlKey: true })).toBe('one **two** ‸ four');
    });

    it('removes an image as a whole', () => {
        expect(after('a ![i](data:image/png;base64,AA)‸ b', 'Backspace')).toBe('a ‸ b');
    });
});

describe('empty formatting runs', () => {
    it.each([
        ['bold', 'a **b‸** c', 'Backspace'],
        ['italic', 'a *b‸* c', 'Backspace'],
        ['strikethrough', 'a ~~b‸~~ c', 'Backspace'],
        ['inline code', 'a `b‸` c', 'Backspace'],
        ['bold, deleted forwards', 'a ‸**b** c', 'Delete'],
    ])('removes the markers of %s when its last letter goes', (_name, text, key) => {
        expect(after(text, key)).toBe('a ‸ c');
    });

    it('removes the markers when the selected text of a run is deleted', () => {
        expect(after('one **«two»** three', 'Backspace')).toBe('one ‸ three');
    });

    it('keeps the pair Ctrl+B adds while the caret stays, so typing is bold', () => {
        const view = mountLiveEditor('make it ‸').view;

        pressKey(view.contentDOM, 'b', { ctrlKey: true });
        typeAt(view, 'x');

        expect(markedText(view)).toBe('make it **x‸**');
    });

    it('removes the pair Ctrl+B added once the caret leaves, without an undo step', () => {
        const view = mountLiveEditor('make it ‸').view;
        const depth = undoDepth(view.state);

        pressKey(view.contentDOM, 'b', { ctrlKey: true });
        expect(view.state.doc.toString()).toBe('make it ****');
        expect(view.contentDOM.textContent).toBe('make it ');

        pressKey(view.contentDOM, 'ArrowLeft');

        expect(markedText(view)).toBe('make it‸ ');
        expect(undoDepth(view.state)).toBe(depth);
    });

    it('removes the pair with Backspace while the caret is in it', () => {
        const view = mountLiveEditor('make it ‸').view;
        pressKey(view.contentDOM, 'e', { ctrlKey: true });

        expect(press(view, 'Backspace')).toBe('make it ‸');
    });

    it('leaves a literal pair of markers alone when the caret moves past it', () => {
        const view = mountLiveEditor('a ****‸ b').view;

        view.dispatch({ selection: { anchor: 4 } });
        pressKey(view.contentDOM, 'ArrowRight');

        expect(view.state.doc.toString()).toBe('a **** b');
    });
});

describe('spaces at the edges of a run', () => {
    function hasMarkersShown(view: EditorView): boolean {
        return shownLines(view).some((line) => /[*~]/.test(line));
    }

    it.each([
        ['bold', 'one **two‸** four', 'one **two** ‸ four', 'one **two x‸** four'],
        ['italic', 'one *two‸* four', 'one *two* ‸ four', 'one *two x‸* four'],
        ['strikethrough', 'one ~~two‸~~ four', 'one ~~two~~ ‸ four', 'one ~~two x‸~~ four'],
    ])('keeps the markers of %s hidden when a space is typed at its end, and goes on in the run', (_name, text, spaced, continued) => {
        const view = mountLiveEditor(text).view;

        typeAt(view, ' ');

        expect(markedText(view)).toBe(spaced);
        expect(hasMarkersShown(view)).toBe(false);

        typeAt(view, 'x');

        expect(markedText(view)).toBe(continued);
        expect(hasMarkersShown(view)).toBe(false);
    });

    it('goes on in the run after several spaces', () => {
        const view = mountLiveEditor('**two‸**').view;

        typeAt(view, ' ');
        typeAt(view, ' ');
        typeAt(view, 'x');

        expect(markedText(view)).toBe('**two  x‸**');
    });

    it('types plain text after the space once the caret has left it', () => {
        const view = mountLiveEditor('**two‸** end').view;
        typeAt(view, ' ');
        const after = view.state.selection.main.head;

        view.dispatch({ selection: { anchor: 0 } });
        view.dispatch({ selection: { anchor: after } });
        typeAt(view, 'x');

        expect(markedText(view)).toBe('**two** x‸ end');
    });

    it('moves the space a deleted first word leaves before the opening markers', () => {
        const view = mountLiveEditor('one **«two» three** four').view;

        pressKey(view.contentDOM, 'Backspace');

        expect(view.state.doc.toString()).toBe('one  **three** four');
        expect(hasMarkersShown(view)).toBe(false);
    });

    it('drops the markers of a run left with nothing but a space', () => {
        const view = mountLiveEditor('one **«two»** four').view;

        typeAt(view, ' ');

        expect(markedText(view)).toBe('one  ‸ four');
    });

    it('puts a space typed into the pair Ctrl+B leaves in front of it, and keeps the pair for the text', () => {
        const view = mountLiveEditor('make it ‸').view;
        pressKey(view.contentDOM, 'b', { ctrlKey: true });

        typeAt(view, ' ');

        expect(markedText(view)).toBe('make it  **‸**');
        expect(hasMarkersShown(view)).toBe(false);

        typeAt(view, 'x');

        expect(markedText(view)).toBe('make it  **x‸**');
    });

    it('undoes the space and its move in one step', () => {
        const view = mountLiveEditor('one **two‸** four').view;

        typeAt(view, ' ');
        undo(view);

        expect(markedText(view)).toBe('one **two‸** four');
    });
});

describe('Backspace at the start of a line', () => {
    it.each([
        ['turns a heading into a paragraph', '# ‸Title', '‸Title'],
        ['turns a deeper heading into a paragraph', 'a\n\n### ‸Title', 'a\n\n‸Title'],
        ['turns a setext heading into a paragraph', '‸Title\n=====\n\nb', '‸Title\n\nb'],
        ['removes a quote marker', '> ‸quote', '‸quote'],
        ['keeps the list behaviour of turning the marker into indentation', '- one\n- ‸two', '- one\n  ‸two'],
        ['removes a horizontal rule above as a whole', 'a\n\n***\n‸b', 'a\n\n‸b'],
        ['moves into a code box above instead of merging with it', '```\ncode\n```\n‸text', '```\ncode‸\n```\ntext'],
        ['removes an empty line under a code box', '```\ncode\n```\n‸', '```\ncode‸\n```'],
        ['does nothing at the start of a code box', 'x\n```\n‸code\n```', 'x\n```\n‸code\n```'],
        ['removes an empty code box', 'x\n```\n‸\n```', 'x‸'],
        ['does nothing at the start of a table cell', '| a | ‸b |\n| - | - |', '| a | ‸b |\n| - | - |'],
        ['does nothing at the start of a table row', '| a | b |\n| - | - |\n| ‸1 | 2 |', '| a | b |\n| - | - |\n| ‸1 | 2 |'],
    ])('%s', (_name, text, expected) => {
        expect(after(text, 'Backspace')).toBe(expected);
    });

    it('brings the next line up without its heading marks on Delete', () => {
        expect(after('one‸\n# Two', 'Delete')).toBe('one‸Two');
    });

    it('never merges into a table or a code box on Delete', () => {
        expect(after('a‸\n| x | y |\n| - | - |', 'Delete')).toBe('a‸\n| x | y |\n| - | - |');
        expect(after('```\ncode‸\n```', 'Delete')).toBe('```\ncode‸\n```');
        expect(after('| x | y‸ |\n| - | - |', 'Delete')).toBe('| x | y‸ |\n| - | - |');
    });
});

describe('typing over a selection', () => {
    it.each([
        ['inside a run keeps its formatting', 'a **«bold»** b', 'X', 'a **X‸** b'],
        ['over a whole run, markers included, keeps its formatting', 'a «**bold**» b', 'X', 'a **X‸** b'],
        ['across runs keeps the markers of the runs it cuts', 'pl«ain **bo»ld** more', 'X', 'plX‸**ld** more'],
        ['across a whole run removes it', 'a «x **bold** y» b', 'X', 'a X‸ b'],
        ['across table cells keeps the pipes', '| «a | b» |\n| - | - |', 'X', '| X‸ |  |\n| - | - |'],
        ['across lines takes the first line formatting', 'a«bc\n# Ti»tle', 'X', 'aX‸tle'],
        ['into a code box keeps the fence', 'a«bc\n```\nco»de\n```', 'X', 'aX‸\n```\nde\n```'],
    ])('%s', (_name, text, typed, expected) => {
        const view = mountLiveEditor(text).view;

        typeAt(view, typed);

        expect(markedText(view)).toBe(expected);
    });

    it('deletes across lines without merging a code fence into the text', () => {
        const view = mountLiveEditor('a«bc\n```\nco»de\n```').view;

        pressKey(view.contentDOM, 'Backspace');

        expect(view.state.doc.toString()).toBe('a\n```\nde\n```');
    });

    it('computes the visible deletion of a range', () => {
        const view = mountLiveEditor('one **two** three').view;

        expect(visibleDeletion(view.state, 2, 7).changes).toEqual([{ from: 2, to: 4 }, { from: 6, to: 7 }]);
    });
});

describe('copy', () => {
    it.each([
        ['a whole run', 'one **two** three', 6, 9, '**two**'],
        ['part of a run', 'one **two three** four', 0, 8, 'one **tw**'],
        ['the end of a link', 'see [the docs](https://x.y) now', 9, 29, '[docs](https://x.y) n'],
    ])('gives the Markdown of %s with the markers it cuts', (_name, text, from, to, expected) => {
        const view = mountLiveEditor(text).view;

        expect(markdownForRange(view.state, from, to)).toBe(expected);
    });

    it('copies and cuts the selection as Markdown', () => {
        const view = mountLiveEditor('one **two «three»** four').view;
        view.focus();
        const copy = clipboardEvent('copy');
        view.contentDOM.dispatchEvent(copy.event);

        expect(copy.written.get('text/plain')).toBe('**three**');

        const cut = clipboardEvent('cut');
        view.contentDOM.dispatchEvent(cut.event);

        expect(cut.written.get('text/plain')).toBe('**three**');
        expect(view.state.doc.toString()).toBe('one **two**  four');
    });
});

describe('Enter', () => {
    it.each([
        ['continues a list after bold text, past its markers', '- **b‸**', '- **b**\n- ‸'],
        ['adds an empty line above a heading from the start of its text', 'a\n# ‸Title', 'a\n\n# ‸Title'],
        ['adds an empty item above from the start of an item', '- [x] ‸item', '- [ ] \n- [x] ‸item'],
        ['continues a setext heading under its underline', 'Title‸\n=====', 'Title\n=====\n‸'],
        ['adds a line of code in a code box', '```\nab‸\n```', '```\nab\n‸\n```'],
        ['leaves a code box from its empty last line', '```\nab\n‸\n```', '```\nab\n```\n‸'],
        ['leaves a code box onto the empty line after it', '```\nab\n‸\n```\n\nnext', '```\nab\n```\n‸\nnext'],
        ['moves down a table row', '| a | b |\n| - | - |\n| 1‸ | 2 |\n| 3 | 4 |', '| a | b |\n| - | - |\n| 1 | 2 |\n| 3‸ | 4 |'],
    ])('%s', (_name, text, expected) => {
        expect(after(text, 'Enter')).toBe(expected);
    });

    it('leaves a code box at the end of the document with ↓', () => {
        expect(after('```\nab‸\n```', 'ArrowDown')).toBe('```\nab\n```\n‸');
    });

    it('turns three backticks on an empty line into a code box', () => {
        const view = mountLiveEditor('a\n``‸').view;

        typeAt(view, '`');

        expect(markedText(view)).toBe('a\n```\n‸\n```');
    });
});

describe('tables', () => {
    const TABLE = '| a | b |\n| - | - |\n| 1 | 2 |';

    it('escapes a pipe typed into a cell', () => {
        const view = mountLiveEditor('| a‸ | b |\n| - | - |').view;

        typeAt(view, '|x');

        expect(view.state.doc.toString()).toBe('| a\\|x | b |\n| - | - |');
    });

    it('moves between cells with Tab and Shift+Tab, selecting the cell text', () => {
        const view = mountLiveEditor('| a‸ | b |\n| - | - |\n| 1 | 2 |').view;

        expect(press(view, 'Tab')).toBe('| a | «b» |\n| - | - |\n| 1 | 2 |');
        expect(press(view, 'Tab')).toBe('| a | b |\n| - | - |\n| «1» | 2 |');
        expect(press(view, 'Tab', { shiftKey: true })).toBe('| a | «b» |\n| - | - |\n| 1 | 2 |');
    });

    it('adds a row on Tab in the last cell, as one undo step', () => {
        const view = mountLiveEditor(`${TABLE.slice(0, -2)}‸ |`).view;

        expect(press(view, 'Tab')).toBe(`${TABLE}\n| ‸ |  |`);

        undo(view);

        expect(view.state.doc.toString()).toBe(TABLE);
    });

    it('keeps Home and End within the cell', () => {
        const view = mountLiveEditor('| one | t‸wo | three |\n| - | - | - |').view;

        expect(press(view, 'End')).toBe('| one | two‸ | three |\n| - | - | - |');
        expect(press(view, 'Home')).toBe('| one | ‸two | three |\n| - | - | - |');
        expect(press(view, 'End', { shiftKey: true })).toBe('| one | «two» | three |\n| - | - | - |');
    });

    it('moves between rows in the same column with ↑ and ↓', () => {
        const view = mountLiveEditor('| a | b‸ |\n| - | - |\n| 1 | 2 |').view;

        expect(press(view, 'ArrowDown')).toBe('| a | b |\n| - | - |\n| 1 | 2‸ |');
        expect(press(view, 'ArrowUp')).toBe('| a | b‸ |\n| - | - |\n| 1 | 2 |');
    });

    it('offers row and column changes on right-click', () => {
        const view = mountLiveEditor(TABLE).view;
        vi.spyOn(view, 'posAtCoords').mockReturnValue(TABLE.indexOf('2'));
        const menuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });

        view.contentDOM.dispatchEvent(menuEvent);
        const items = [...document.querySelectorAll<HTMLElement>('.context-menu .context-menu-item')];

        expect(menuEvent.defaultPrevented).toBe(true);
        expect(items.map((item) => item.textContent)).toEqual([
            'Insert row above',
            'Insert row below',
            'Insert column left',
            'Insert column right',
            'Delete row',
            'Delete column',
        ]);

        items[3]!.click();

        expect(view.state.doc.toString()).toBe('| a | b |  |\n| - | - | --- |\n| 1 | 2 |  |');

        undo(view);
        redo(view);
        undo(view);

        expect(view.state.doc.toString()).toBe(TABLE);
    });

    it('leaves out the row changes the header row cannot take', () => {
        const view = mountLiveEditor(TABLE).view;
        vi.spyOn(view, 'posAtCoords').mockReturnValue(2);

        view.contentDOM.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        const labels = [...document.querySelectorAll<HTMLElement>('.context-menu[data-open="true"] .context-menu-item')]
            .map((item) => item.textContent);

        expect(labels).toEqual(['Insert row below', 'Insert column left', 'Insert column right', 'Delete column']);
    });
});

describe('undo', () => {
    it('undoes a heading Backspace, a code box exit and a pipe escape one step each', () => {
        const view = mountLiveEditor('# ‸Title').view;

        pressKey(view.contentDOM, 'Backspace');
        undo(view);

        expect(view.state.doc.toString()).toBe('# Title');

        const box = mountLiveEditor('```\nab\n‸\n```').view;
        pressKey(box.contentDOM, 'Enter');
        undo(box);

        expect(box.state.doc.toString()).toBe('```\nab\n\n```');
    });
});
