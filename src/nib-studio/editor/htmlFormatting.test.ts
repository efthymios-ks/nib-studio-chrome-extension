import { html } from '@codemirror/lang-html';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { destroyLiveEditors, markedText, mountLiveEditor } from '../testing/liveEditor.js';
import { ignoreSelectionChange, pressKey } from '../testing/testHelpers.js';
import {
    headingLevel,
    htmlFormattingButtonGroups,
    isInFormat,
    isList,
    linkText,
    setHeadingLevel,
    setLinkAddress,
    toggleBold,
    toggleItalic,
    toggleList,
} from './htmlFormatting.js';
import { enclosingElementNamed } from './htmlStructure.js';

beforeEach(() => {
    document.addEventListener('selectionchange', ignoreSelectionChange, true);
});

afterEach(() => {
    destroyLiveEditors();
    document.body.replaceChildren();
    document.removeEventListener('selectionchange', ignoreSelectionChange, true);
});

// `«` and `»` mark the selection, `‸` the caret.
function stateOf(marked: string): EditorState {
    const caret = marked.indexOf('‸');
    const start = marked.indexOf('«');
    const text = marked.replace('‸', '').replace('«', '').replace('»', '');
    const selection = caret >= 0
        ? EditorSelection.cursor(caret)
        : EditorSelection.range(start, marked.replace('«', '').indexOf('»'));
    const state = EditorState.create({ doc: text, selection, extensions: [html()] });
    ensureSyntaxTree(state, state.doc.length, 5000);

    return state;
}

function applied(state: EditorState, spec: TransactionSpec | null): string {
    if (spec == null) {
        return 'unchanged';
    }

    const next = state.update(spec).state;
    const { from, to, empty } = next.selection.main;
    const text = next.doc.toString();

    return empty ? `${text.slice(0, from)}‸${text.slice(from)}` : `${text.slice(0, from)}«${text.slice(from, to)}»${text.slice(to)}`;
}

describe('bold and italic', () => {
    it('wrap the selection in <strong> and <em>', () => {
        const state = stateOf('<p>a «big» day</p>');

        expect(applied(state, toggleBold(state))).toBe('<p>a <strong>«big»</strong> day</p>');
        expect(applied(state, toggleItalic(state))).toBe('<p>a <em>«big»</em> day</p>');
    });

    it('wrap the word at the caret, or add an empty pair with the caret inside', () => {
        const word = stateOf('<p>a bi‸g day</p>');
        const space = stateOf('<p>a ‸ day</p>');

        expect(applied(word, toggleBold(word))).toBe('<p>a <strong>«big»</strong> day</p>');
        expect(applied(space, toggleBold(space))).toBe('<p>a <strong>‸</strong> day</p>');
    });

    it('remove <strong> or <b>, <em> or <i>, from the selection inside them', () => {
        const bold = stateOf('<p>a <b>b‸ig</b> day</p>');
        const italic = stateOf('<p>a <em class="x">«big»</em> day</p>');

        expect(isInFormat(bold, new Set(['strong', 'b']))).toBe(true);
        expect(applied(bold, toggleBold(bold))).toBe('<p>a b‸ig day</p>');
        expect(applied(italic, toggleItalic(italic))).toBe('<p>a «big» day</p>');
    });

    it('leave a selection that starts and ends in different elements alone, or that ends inside a tag', () => {
        const across = stateOf('<p>a «big</p><p>day»</p>');
        const tag = stateOf('<p>a «big <b»>x</b></p>');

        expect(toggleBold(across)).toBeNull();
        expect(toggleBold(tag)).toBeNull();
    });
});

describe('links', () => {
    it('wrap text in <a href>, escaping the address', () => {
        const state = stateOf('<p>see «docs»</p>');

        expect(applied(state, linkText(state, 7, 11, 'guide.html?a=1&b="2"'))).toBe('<p>see <a href="guide.html?a=1&amp;b=&quot;2&quot;">docs</a>‸</p>');
    });

    it('add a link reading its address where there is no text', () => {
        const state = stateOf('<p>‸</p>');

        expect(applied(state, linkText(state, 3, 3, 'a.html'))).toBe('<p><a href="a.html">a.html</a>‸</p>');
        expect(linkText(state, 3, 3, '  ')).toBeNull();
    });

    it('change the address of a link, add one it lacks, and remove the link for an empty one', () => {
        const state = stateOf('<p><a class="x" href="old.html">te‸xt</a></p>');
        const link = enclosingElementNamed(state, state.selection.main.head, new Set(['a']))!;
        const bare = stateOf('<p><a name="top">te‸xt</a></p>');
        const bareLink = enclosingElementNamed(bare, bare.selection.main.head, new Set(['a']))!;

        expect(applied(state, setLinkAddress(state, link, 'new.html'))).toBe('<p><a class="x" href="new.html">te‸xt</a></p>');
        expect(applied(bare, setLinkAddress(bare, bareLink, 'b.html'))).toBe('<p><a href="b.html" name="top">te‸xt</a></p>');
        expect(applied(state, setLinkAddress(state, link, ''))).toBe('<p>te‸xt</p>');
    });
});

describe('heading level', () => {
    it('renames the paragraph or heading around the caret, keeping its attributes', () => {
        const state = stateOf('<p class="lead">Ti‸tle</p>');
        const heading = state.update(setHeadingLevel(state, 2)!).state;

        expect(applied(state, setHeadingLevel(state, 2))).toBe('<h2 class="lead">Ti‸tle</h2>');
        expect(headingLevel(heading)).toBe(2);
        expect(applied(heading, setHeadingLevel(heading, 0))).toBe('<p class="lead">Ti‸tle</p>');
    });

    it('makes selected text outside any paragraph a heading, and does nothing without a selection there', () => {
        const selected = stateOf('<div>«Title»</div>');
        const caret = stateOf('<div>Ti‸tle</div>');

        expect(applied(selected, setHeadingLevel(selected, 1))).toBe('<div><h1>Title</h1>‸</div>');
        expect(setHeadingLevel(caret, 1)).toBeNull();
    });
});

describe('lists', () => {
    it('turn a paragraph into a one-item list', () => {
        const state = stateOf('<p>it‸em</p>');

        expect(applied(state, toggleList(state, 'ul'))).toBe('<ul><li>it‸em</li></ul>');
    });

    it('switch a list to the other kind', () => {
        const state = stateOf('<ul>\n  <li>o‸ne</li>\n  <li>two</li>\n</ul>');

        expect(isList(state, 'ul')).toBe(true);
        expect(applied(state, toggleList(state, 'ol'))).toBe('<ol>\n  <li>o‸ne</li>\n  <li>two</li>\n</ol>');
    });

    it('turn a list of the same kind back into paragraphs, items without a closing tag included', () => {
        const state = stateOf('<ol><li>o‸ne</li><li>two</ol>');

        expect(applied(state, toggleList(state, 'ol'))).toBe('<p>o‸ne</p><p>two</p>');
    });
});

describe('the editor bar and shortcuts', () => {
    it('offers bold, italic and link, then heading level and the two lists', () => {
        expect(htmlFormattingButtonGroups().map((group) => group.map((button) => button.id))).toEqual([
            ['bold', 'italic', 'link'],
            ['heading', 'bulletedList', 'numberedList'],
        ]);
    });

    it('wraps <strong> on Ctrl+B in the Interactive view, and the heading menu marks the current level', () => {
        const handle = mountLiveEditor('<p>a big day</p>', { mode: 'html' });
        const view = handle.view;
        const text = view.state.doc.toString();
        view.dispatch({ selection: { anchor: text.indexOf('big'), head: text.indexOf('big') + 3 } });

        pressKey(view.contentDOM, 'b', { ctrlKey: true });

        expect(markedText(view)).toBe('<p>a <strong>«big»</strong> day</p>');

        const heading = htmlFormattingButtonGroups()[1]?.[0];
        const choices = heading?.menu?.(view.state) ?? [];
        expect(choices.map((choice) => `${choice.label}${choice.isCurrent ? ' *' : ''}`)).toEqual([
            'Normal text *', 'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6',
        ]);
    });
});
