import { cursorCharLeft, cursorCharRight } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { destroyLiveEditors, markedText, mountLiveEditor, shownLines, typeAt } from '../testing/liveEditor.js';
import { clipboardEvent, ignoreSelectionChange, pressKey } from '../testing/testHelpers.js';
import { canonicalCaret, deletionAt } from './htmlLiveEditing.js';
import { htmlItems } from './htmlLiveItems.js';

beforeEach(() => {
    document.addEventListener('selectionchange', ignoreSelectionChange, true);
});

afterEach(() => {
    destroyLiveEditors();
    document.body.replaceChildren();
    document.removeEventListener('selectionchange', ignoreSelectionChange, true);
});

function mount(marked: string): EditorView {
    return mountLiveEditor(marked, { mode: 'html' }).view;
}

// Places the caret exactly, past the view's own placement, as an edit made in the Editor would leave it.
function caretAt(view: EditorView, marker: string): void {
    const text = view.state.doc.toString();
    view.dispatch({ selection: { anchor: text.indexOf(marker) + marker.length } });
}

function press(view: EditorView, key: string, modifiers: KeyboardEventInit = {}): void {
    pressKey(view.contentDOM, key, modifiers);
}

function texts(view: EditorView, selector: string): string[] {
    return [...view.contentDOM.querySelectorAll(selector)].map((element) => element.textContent ?? '');
}

describe('showing HTML as a document', () => {
    it('hides tags and indentation, and shows entities as their characters', () => {
        const view = mount('<body>\n    <p>Hello <b>bold</b> &amp; <a href="https://example.com/">link</a></p>\n</body>');

        expect(shownLines(view)).toEqual(['', 'Hello bold & link', '']);
        expect(view.state.doc.toString()).toBe('<body>\n    <p>Hello <b>bold</b> &amp; <a href="https://example.com/">link</a></p>\n</body>');
    });

    it('gives text the look of its elements', () => {
        const view = mount('<h2>Title</h2>\n<p><strong>a</strong> <em>b</em> <u>c</u> <del>d</del> <code>e</code> <a href="x.html">f</a></p>');

        expect(view.contentDOM.querySelector('.cm-html-heading[data-level="2"]')?.textContent).toBe('Title');
        expect(texts(view, '.cm-html-strong')).toEqual(['a']);
        expect(texts(view, '.cm-html-em')).toEqual(['b']);
        expect(texts(view, '.cm-html-underline')).toEqual(['c']);
        expect(texts(view, '.cm-html-strike')).toEqual(['d']);
        expect(texts(view, '.cm-live-code')).toEqual(['e']);
        expect(view.contentDOM.querySelector('.cm-live-link')?.getAttribute('title')).toBe('x.html');
    });

    it('shows bullets, numbers, cell edges and rules', () => {
        const view = mount('<ul><li>one</li><li>two</li></ul>\n<ol><li>first</li><li>second</li></ol>\n<table><tr><td>a</td><td>b</td></tr></table>\n<hr>');

        expect(shownLines(view)).toEqual(['•one•two', '1.first2.second', 'a│b', '']);
        expect(view.contentDOM.querySelector('.cm-live-rule')).not.toBeNull();
    });

    it('numbers an ordered list from its start, an item\'s value and backwards when reversed', () => {
        const view = mount([
            '<ol start="5"><li>a</li><li>b</li></ol>',
            '<ol><li>a</li><li value="10">b</li><li>c</li></ol>',
            '<ol reversed><li>a</li><li>b</li><li>c</li></ol>',
        ].join('\n'));

        expect(shownLines(view)).toEqual(['5.a6.b', '1.a10.b11.c', '3.a2.b1.c']);
    });

    it('shows the head, styles, scripts, comments, the doctype and other elements as boxes', () => {
        const view = mount('<!doctype html>\n<head><title>T</title></head>\n<style>p{}</style><script>run()</script><!-- note --><svg></svg><my-widget>x</my-widget>');

        expect(texts(view, '.cm-html-box')).toEqual(['<!doctype html>', '<head>', '<style>', '<script>', '<!-- comment -->', '<svg>', '<my-widget>']);
    });

    it('shows images from their address', () => {
        const view = mount('<p><img src="pic.png" alt="Pic"></p>');

        expect(texts(view, '.cm-live-image-blocked')).toEqual(['Image not shown (file outside the workspace): pic.png']);
    });

    it('draws a line of tags only short, and leaves preformatted text as written', () => {
        const view = mount('<ul>\n    <li>one</li>\n</ul>\n<pre>\n    indented\n</pre>');

        expect(view.contentDOM.querySelectorAll('.cm-html-structure')).toHaveLength(4);
        expect(shownLines(view)).toContain('    indented');
        expect(view.contentDOM.querySelectorAll('.cm-html-pre').length).toBeGreaterThan(0);
    });
});

describe('the caret', () => {
    it('skips hidden tags, one shown character per arrow key', () => {
        const view = mount('<p>ab <b>cd</b> e</p>');
        caretAt(view, '<p>ab ');

        cursorCharRight(view);
        expect(markedText(view)).toBe('<p>ab <b>c‸d</b> e</p>');

        cursorCharRight(view);
        expect(markedText(view)).toBe('<p>ab <b>cd‸</b> e</p>');

        cursorCharRight(view);
        expect(markedText(view)).toBe('<p>ab <b>cd</b> ‸e</p>');

        cursorCharLeft(view);
        expect(markedText(view)).toBe('<p>ab <b>cd‸</b> e</p>');

        cursorCharLeft(view);
        cursorCharLeft(view);
        expect(markedText(view)).toBe('<p>ab ‸<b>cd</b> e</p>');
    });

    it('sits where typing does what it shows, and past a line\'s indentation and opening tags', () => {
        const view = mount('<ul>\n    <li><b>x</b> y</li>\n</ul>');
        const text = view.state.doc.toString();
        const lineStart = text.indexOf('    <li>');

        expect(canonicalCaret(view.state, lineStart)).toBe(text.indexOf('<b>'));
        expect(canonicalCaret(view.state, text.indexOf('x'))).toBe(text.indexOf('<b>'));
        expect(canonicalCaret(view.state, text.indexOf('</b>') + 4)).toBe(text.indexOf('</b>'));
    });

    it('moves past every hidden range as one unit', () => {
        const view = mount('<p>a<b>b</b></p>');

        expect(htmlItems(view.state).map((item) => [item.kind, view.state.sliceDoc(item.from, item.to)])).toEqual([
            ['tag', '<p>'],
            ['tag', '<b>'],
            ['tag', '</b>'],
            ['tag', '</p>'],
        ]);
    });
});

describe('typing and deleting', () => {
    it('changes only the bytes typed, and escapes markup typed as text', () => {
        const source = '<!doctype html>\r\n<p class="note">Hi <em>you</em></p>';
        const view = mount(source.replace('\r\n', '\n'));
        caretAt(view, 'Hi');

        typeAt(view, ' & <b>');

        expect(view.state.doc.toString()).toBe('<!doctype html>\n<p class="note">Hi &amp; &lt;b&gt; <em>you</em></p>');
    });

    it('keeps every tag in a selection it types over or deletes', () => {
        const view = mount('<p>one <b>two</b> three</p>');
        const text = view.state.doc.toString();
        view.dispatch({ selection: { anchor: text.indexOf('ne'), head: text.indexOf('hree') } });

        typeAt(view, 'X');

        expect(view.state.doc.toString()).toBe('<p>oX<b></b>hree</p>');

        view.dispatch({ selection: { anchor: 3, head: view.state.doc.length - 4 } });
        press(view, 'Backspace');

        expect(view.state.doc.toString()).toBe('<p><b></b></p>');
    });

    it('pastes plain text, escaped, and never the clipboard\'s HTML', () => {
        const view = mount('<p>ab</p>');
        caretAt(view, '<p>a');
        const { event } = clipboardEvent('paste', { 'text/html': '<script>x()</script>', 'text/plain': 'x < y & "z"' });

        view.contentDOM.dispatchEvent(event);

        expect(view.state.doc.toString()).toBe('<p>ax &lt; y &amp; "z"b</p>');
    });

    it('copies the shown text as plain text and the source as HTML, and cut keeps the tags', () => {
        const view = mount('<p>a <b>b &amp; c</b> d</p>');
        const text = view.state.doc.toString();
        view.dispatch({ selection: { anchor: text.indexOf('a '), head: text.indexOf(' d') } });
        const copied = clipboardEvent('copy');

        view.contentDOM.dispatchEvent(copied.event);

        expect(Object.fromEntries(copied.written)).toEqual({ 'text/plain': 'a b & c', 'text/html': 'a <b>b &amp; c</b>' });

        const cut = clipboardEvent('cut');
        view.contentDOM.dispatchEvent(cut.event);

        expect(view.state.doc.toString()).toBe('<p><b></b> d</p>');
    });

    it('Backspace deletes the shown character before hidden tags, and an element with its last character', () => {
        const view = mount('<p>a <b>bc</b> d</p>');
        caretAt(view, '</b>');

        press(view, 'Backspace');
        expect(markedText(view)).toBe('<p>a <b>b‸</b> d</p>');

        press(view, 'Backspace');
        expect(markedText(view)).toBe('<p>a ‸ d</p>');
    });

    it('Delete removes the shown character after hidden tags, and an entity as one character', () => {
        const view = mount('<p>a<b>b</b>&amp;c</p>');
        caretAt(view, '<p>a');

        expect(deletionAt(view.state, view.state.selection.main.head, 1)).not.toBeNull();
        press(view, 'Delete');
        expect(view.state.doc.toString()).toBe('<p>a&amp;c</p>');

        press(view, 'Delete');
        expect(view.state.doc.toString()).toBe('<p>ac</p>');
    });

    it('Backspace and Delete remove a <br> and the line break after it as one character', () => {
        const view = mount('<p>a<br>\n    b</p>');
        caretAt(view, '\n    ');

        press(view, 'Backspace');
        expect(markedText(view)).toBe('<p>a‸b</p>');

        const forward = mount('<p>a<br>\n    b</p>');
        caretAt(forward, '<p>a');
        press(forward, 'Delete');
        expect(markedText(forward)).toBe('<p>a‸b</p>');
    });

    it('Backspace at the start of a heading makes it a paragraph, then joins it to the block before', () => {
        const view = mount('<p>one</p>\n<h2 id="x">two</h2>');
        caretAt(view, '<h2 id="x">');

        press(view, 'Backspace');
        expect(view.state.doc.toString()).toBe('<p>one</p>\n<p id="x">two</p>');

        press(view, 'Backspace');
        expect(markedText(view)).toBe('<p>one‸two</p>');
    });

    it('Delete at the end of a block joins the next one, and nothing joins past a list\'s edge', () => {
        const view = mount('<p>one</p>\n<p>two</p>\n<ul><li>three</li></ul>');
        caretAt(view, 'one');

        press(view, 'Delete');
        expect(view.state.doc.toString()).toBe('<p>onetwo</p>\n<ul><li>three</li></ul>');

        caretAt(view, '<li>');
        press(view, 'Backspace');
        expect(view.state.doc.toString()).toBe('<p>onetwo</p>\n<ul><li>three</li></ul>');
    });
});

describe('Enter', () => {
    it('splits a paragraph, closing and opening the inline elements the caret is in', () => {
        const view = mount('<div>\n    <p class="lead" id="intro">ab<b>cd</b></p>\n</div>');
        caretAt(view, '<b>c');

        press(view, 'Enter');

        expect(markedText(view)).toBe('<div>\n    <p class="lead" id="intro">ab<b>c</b></p>\n    <p class="lead"><b>‸d</b></p>\n</div>');
    });

    it('adds an empty paragraph after a heading\'s end and before a paragraph\'s start', () => {
        const view = mount('<h1>Title</h1>\n<p>Text</p>');
        caretAt(view, 'Title');

        press(view, 'Enter');
        expect(markedText(view)).toBe('<h1>Title</h1>\n<p>‸</p>\n<p>Text</p>');

        caretAt(view, '</p>\n<p>');
        press(view, 'Enter');
        expect(view.state.doc.toString()).toBe('<h1>Title</h1>\n<p></p>\n<p></p>\n<p>Text</p>');
    });

    it('adds a list item in a list, and ends the list on an empty item', () => {
        const view = mount('<ul>\n    <li>one</li>\n</ul>');
        caretAt(view, 'one');

        press(view, 'Enter');
        expect(markedText(view)).toBe('<ul>\n    <li>one</li>\n    <li>‸</li>\n</ul>');

        press(view, 'Enter');
        expect(markedText(view)).toBe('<ul>\n    <li>one</li>\n</ul>\n<p>‸</p>');
    });

    it('adds a line break in preformatted text and a <br> outside paragraphs, and Shift+Enter a <br>', () => {
        const pre = mount('<pre>ab</pre>');
        caretAt(pre, '<pre>a');
        press(pre, 'Enter');
        expect(pre.state.doc.toString()).toBe('<pre>a\nb</pre>');

        const div = mount('<div>ab</div>');
        caretAt(div, '<div>a');
        press(div, 'Enter');
        expect(div.state.doc.toString()).toBe('<div>a<br>\nb</div>');

        const paragraph = mount('<p>ab</p>');
        caretAt(paragraph, '<p>a');
        press(paragraph, 'Enter', { shiftKey: true });
        expect(paragraph.state.doc.toString()).toBe('<p>a<br>\nb</p>');
    });
});

describe('the source byte for byte', () => {
    it('keeps everything around a sequence of edits as it was', () => {
        const head = '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <style>p { color: red }</style>\n</head>\n<body>\n';
        const tail = '\n  <script>if (a < b) { run(); }</script>\n  <!-- keep me -->\n</body>\n</html>\n';
        const view = mount(`${head}  <p>Hello <i>world</i>!</p>${tail}`);
        caretAt(view, 'Hello');

        typeAt(view, ',');
        caretAt(view, 'world');
        press(view, 'Backspace');
        typeAt(view, 'D');

        expect(view.state.doc.toString()).toBe(`${head}  <p>Hello, <i>worlD</i>!</p>${tail}`);
    });
});
