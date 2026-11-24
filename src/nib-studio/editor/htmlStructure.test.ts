import { html } from '@codemirror/lang-html';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { escapeHtmlAttribute, escapeHtmlText } from '../../common/html/escapeHtml.js';
import {
    adjacentElement,
    attributeValue,
    childElements,
    decodeHtmlText,
    enclosingElements,
    renameChanges,
} from './htmlStructure.js';

function stateOf(text: string): EditorState {
    const state = EditorState.create({ doc: text, extensions: [html()] });
    ensureSyntaxTree(state, state.doc.length, 5000);

    return state;
}

describe('enclosingElements', () => {
    it('lists the elements around a position, innermost first, with their tag ranges', () => {
        const text = '<div><p class="x">a <b>bold</b></p></div>';
        const state = stateOf(text);
        const elements = enclosingElements(state, text.indexOf('old'));

        expect(elements.map((element) => element.name)).toEqual(['b', 'p', 'div']);
        expect(text.slice(elements[1]!.openFrom, elements[1]!.openTo)).toBe('<p class="x">');
        expect(text.slice(elements[1]!.closeFrom!, elements[1]!.closeTo!)).toBe('</p>');
        expect(text.slice(elements[0]!.contentFrom, elements[0]!.contentTo)).toBe('bold');
    });

    it('counts the edges of an element\'s content as inside it, and leaves out void elements', () => {
        const text = '<p><b>x</b><img src="a.png"></p>';
        const state = stateOf(text);

        expect(enclosingElements(state, text.indexOf('x')).map((element) => element.name)).toEqual(['b', 'p']);
        expect(enclosingElements(state, text.indexOf('<img') + 4).map((element) => element.name)).toEqual(['p']);
    });

    it('reads elements closed by what follows them, as list items can be', () => {
        const text = '<ul><li>one<li>two</ul>';
        const state = stateOf(text);
        const list = enclosingElements(state, text.indexOf('one'))[1]!;

        expect(childElements(state, list).map((item) => text.slice(item.from, item.to))).toEqual(['<li>one', '<li>two']);
        expect(childElements(state, list)[0]?.closeFrom).toBeNull();
    });
});

describe('adjacentElement', () => {
    it('finds the sibling across white space only', () => {
        const text = '<p>a</p>\n  <p>b</p> c <p>d</p>';
        const state = stateOf(text);
        const second = enclosingElements(state, text.indexOf('b'))[0]!;

        expect(adjacentElement(state, second, -1)?.contentFrom).toBe(text.indexOf('a'));
        expect(adjacentElement(state, second, 1)).toBeNull();
    });
});

describe('attributes and text', () => {
    it('reads attribute values with their quotes off and their entities decoded', () => {
        const text = '<a href="a.html?x=1&amp;y=2" title=\'Say "hi"\' hidden data-n=3>t</a>';
        const state = stateOf(text);
        const link = enclosingElements(state, text.indexOf('>t') + 1)[0]!;

        expect(attributeValue(state, link, 'href')).toBe('a.html?x=1&y=2');
        expect(attributeValue(state, link, 'title')).toBe('Say "hi"');
        expect(attributeValue(state, link, 'hidden')).toBe('');
        expect(attributeValue(state, link, 'data-n')).toBe('3');
        expect(attributeValue(state, link, 'rel')).toBeNull();
    });

    it('escapes and decodes text', () => {
        expect(escapeHtmlText('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
        expect(escapeHtmlAttribute('say "a & <b>"')).toBe('say &quot;a &amp; &lt;b>&quot;');
        expect(decodeHtmlText('&amp; &lt;b&gt; &copy; &#169; &#x41;')).toBe('& <b> © © A');
        expect(decodeHtmlText('<script>x()</script>')).toBe('<script>x()</script>');
    });

    it('renames an element in both of its tags', () => {
        const text = '<h2 id="t">Title</h2>';
        const state = stateOf(text);
        const heading = enclosingElements(state, text.indexOf('Title'))[0]!;

        expect(state.update({ changes: renameChanges(heading, 'p') }).state.doc.toString()).toBe('<p id="t">Title</p>');
    });
});
