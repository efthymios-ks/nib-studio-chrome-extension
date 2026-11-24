import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { destroyLiveEditors, markedText, mountLiveEditor, typeAt } from '../testing/liveEditor.js';
import { ignoreSelectionChange, pressKey } from '../testing/testHelpers.js';
import { canonicalCaret, snapToEditable } from './liveCaret.js';

beforeEach(() => {
    document.addEventListener('selectionchange', ignoreSelectionChange, true);
});

afterEach(() => {
    destroyLiveEditors();
    document.body.replaceChildren();
    document.removeEventListener('selectionchange', ignoreSelectionChange, true);
});

// Puts the caret where a click or a key would, then reads where it ended up.
function caretAfterClick(text: string, position: number): string {
    const view = mountLiveEditor(text).view;
    view.dispatch({ selection: { anchor: position }, userEvent: 'select.pointer' });

    return markedText(view);
}

describe('the caret among hidden syntax', () => {
    it.each([
        ['inside the closing marker at the end of bold text', 'plain **bold** more', 14, 'plain **bold‸** more'],
        ['inside the closing marker from within it', 'plain **bold** more', 13, 'plain **bold‸** more'],
        ['in front of the opening marker of bold text after plain text', 'plain **bold** more', 8, 'plain ‸**bold** more'],
        ['in front of the opening marker from within it', 'plain **bold** more', 7, 'plain ‸**bold** more'],
        ['inside italic text', 'a *soft* b', 8, 'a *soft‸* b'],
        ['inside inline code', 'run `npm` now', 9, 'run `npm‸` now'],
        ['past a heading mark', '# Title', 0, '# ‸Title'],
        ['past a heading mark from within it', '## Title', 1, '## ‸Title'],
        ['past a bullet', '- item', 0, '- ‸item'],
        ['past a task checkbox', '- [ ] task', 2, '- [ ] ‸task'],
        ['past a quote mark', '> quote', 0, '> ‸quote'],
        ['after a link, not inside its text', 'see [docs](u) x', 9, 'see [docs](u)‸ x'],
        ['in front of a link after plain text', 'see [docs](u) x', 5, 'see ‸[docs](u) x'],
        ['in front of an escaped character', 'a \\* b', 3, 'a ‸\\* b'],
        ['at the start of a table cell', '| a | b |\n| - | - |', 0, '| ‸a | b |\n| - | - |'],
        ['at the start of the next cell past a divider', '| a | b |\n| - | - |', 5, '| a | ‸b |\n| - | - |'],
        ['at the end of a cell before a divider', '| a | b |\n| - | - |', 4, '| a‸ | b |\n| - | - |'],
        ['at the end of the header, off the delimiter row', '| a | b |\n| - | - |', 17, '| a | b‸ |\n| - | - |'],
    ])('stays %s', (_name, text, position, expected) => {
        expect(caretAfterClick(text, position)).toBe(expected);
    });

    it('keeps a caret already on visible text where it is', () => {
        const view = mountLiveEditor('plain **bo‸ld** more').view;

        expect(canonicalCaret(view.state, view.state.selection.main.head)).toBe(10);
    });

    it('leaves a selection where it was put', () => {
        const view = mountLiveEditor('plain «**bold**» more').view;

        expect(markedText(view)).toBe('plain «**bold**» more');
    });
});

describe('carets on the frame of a box', () => {
    const DOC = 'intro\n```js\ncode\n```\nend';

    it.each([
        ['enters the code from above', 2, 8, 'intro\n```js\n‸code\n```\nend'],
        ['enters the code from below', 24, 19, 'intro\n```js\ncode‸\n```\nend'],
        ['leaves the code upwards', 12, 7, 'intro‸\n```js\ncode\n```\nend'],
        ['leaves the code downwards', 16, 19, 'intro\n```js\ncode\n```\n‸end'],
    ])('%s', (_name, from, to, expected) => {
        const view = mountLiveEditor(DOC).view;
        view.dispatch({ selection: { anchor: from } });

        view.dispatch({ selection: { anchor: to }, userEvent: 'select' });

        expect(markedText(view)).toBe(expected);
    });

    it('steps over a horizontal rule in the direction of travel', () => {
        const view = mountLiveEditor('a‸\n***\nb').view;

        view.dispatch({ selection: { anchor: 3 } });

        expect(markedText(view)).toBe('a\n***\n‸b');
        expect(snapToEditable(view.state, 3, 7)).toBe(1);
    });

    it('enters front matter from below at the end of its last line', () => {
        const view = mountLiveEditor('---\ntitle: x\ntags: a\n---\n\nbody‸').view;

        view.dispatch({ selection: { anchor: 0 } });

        expect(markedText(view)).toBe('---\ntitle: x\ntags: a‸\n---\n\nbody');
    });
});

describe('arrow keys', () => {
    it('move one visible character at a time across hidden markers', () => {
        const view = mountLiveEditor('plai‸n **bold** more').view;
        const seen: string[] = [];

        for (let step = 0; step < 7; step++) {
            pressKey(view.contentDOM, 'ArrowRight');
            seen.push(markedText(view));
        }

        expect(seen).toEqual([
            'plain‸ **bold** more',
            'plain ‸**bold** more',
            'plain **b‸old** more',
            'plain **bo‸ld** more',
            'plain **bol‸d** more',
            'plain **bold‸** more',
            'plain **bold** ‸more',
        ]);

        const back: string[] = [];

        for (let step = 0; step < 3; step++) {
            pressKey(view.contentDOM, 'ArrowLeft');
            back.push(markedText(view));
        }

        expect(back).toEqual(['plain **bold‸** more', 'plain **bol‸d** more', 'plain **bo‸ld** more']);
    });

    it('cross a hidden prefix to the line above or below in one press', () => {
        const view = mountLiveEditor('one\n# ‸Two').view;

        pressKey(view.contentDOM, 'ArrowLeft');
        expect(markedText(view)).toBe('one‸\n# Two');

        pressKey(view.contentDOM, 'ArrowRight');
        expect(markedText(view)).toBe('one\n# ‸Two');
    });

    it('go to the start of a heading text with Home, past its hidden marks', () => {
        const view = mountLiveEditor('# Ti‸tle').view;

        pressKey(view.contentDOM, 'Home');

        expect(markedText(view)).toBe('# ‸Title');
    });

    it('step from cell to cell in one press', () => {
        const view = mountLiveEditor('| a‸ | b |\n| - | - |').view;

        pressKey(view.contentDOM, 'ArrowRight');

        expect(markedText(view)).toBe('| a | ‸b |\n| - | - |');
    });

    it('select whole visible characters with Shift', () => {
        const view = mountLiveEditor('plain ‸**bold** more').view;

        pressKey(view.contentDOM, 'ArrowRight', { shiftKey: true });

        expect(markedText(view)).toBe('plain «**b»old** more');
    });

    it('move by word with Ctrl', () => {
        const view = mountLiveEditor('plain ‸**bold** more').view;

        pressKey(view.contentDOM, 'ArrowRight', { ctrlKey: true });

        expect(markedText(view)).toBe('plain **bold‸** more');
    });
});

describe('typing at the edges of formatting', () => {
    it.each([
        ['continues bold after bold text', 'plain **bold‸** more', 'er', 'plain **bolder‸** more'],
        ['stays plain before bold text after plain text', 'plain ‸**bold** more', 'X', 'plain X‸**bold** more'],
        ['continues italic after italic text', 'a *soft‸* b', 'er', 'a *softer‸* b'],
        ['stays plain before italic text', 'a ‸*soft* b', 'X', 'a X‸*soft* b'],
        ['continues inline code after code', 'run `npm‸` now', ' ci', 'run `npm ci‸` now'],
        ['stays plain before inline code', 'run ‸`npm` now', 'X', 'run X‸`npm` now'],
    ])('%s', (_name, text, typed, expected) => {
        const view = mountLiveEditor(text).view;

        typeAt(view, typed);

        expect(markedText(view)).toBe(expected);
    });

    it('puts text on the caret side of a hidden marker when the browser inserts on the other side', () => {
        const view = mountLiveEditor('plain **bold‸** more').view;

        typeAt(view, 'X', 14);

        expect(markedText(view)).toBe('plain **boldX‸** more');
    });
});
