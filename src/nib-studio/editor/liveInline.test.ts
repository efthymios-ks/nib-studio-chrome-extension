import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syntaxTree } from '@codemirror/language';
import type { EditorView, WidgetType } from '@codemirror/view';
import { destroyLiveEditors, mountLiveEditor, shownLines } from '../testing/liveEditor.js';
import { ignoreSelectionChange } from '../testing/testHelpers.js';
import { liveStructure } from './liveBlocks.js';
import { linkParts, scanInline } from './liveInline.js';

beforeEach(() => {
    document.addEventListener('selectionchange', ignoreSelectionChange, true);
});

afterEach(() => {
    destroyLiveEditors();
    document.body.replaceChildren();
    document.removeEventListener('selectionchange', ignoreSelectionChange, true);
});

// The parts of the first link node in the text.
function firstLinkParts(view: EditorView): ReturnType<typeof linkParts> | undefined {
    const { state } = view;
    let found: ReturnType<typeof linkParts> | undefined;

    syntaxTree(state).iterate({
        enter: (node) => {
            if (found === undefined && node.name === 'Link') {
                found = linkParts(state, node.node, liveStructure(state));
            }
        },
    });

    return found;
}

function hiddenTexts(view: EditorView): string[] {
    return scanInline(view.state, 0, view.state.doc.length)
        .filter(({ from, to, decoration }) => to > from && decoration.spec.widget == null && decoration.spec.class == null)
        .sort((left, right) => left.from - right.from)
        .map(({ from, to }) => view.state.sliceDoc(from, to));
}

function widgetNames(view: EditorView): string[] {
    return scanInline(view.state, 0, view.state.doc.length)
        .filter(({ decoration }) => decoration.spec.widget != null)
        .sort((left, right) => left.from - right.from)
        .map(({ decoration }) => (decoration.spec.widget as WidgetType).constructor.name);
}

describe('linkParts', () => {
    it('reads the text and address of an inline link', () => {
        const view = mountLiveEditor('see [the docs](https://example.com) now').view;

        expect(firstLinkParts(view)).toEqual({ textFrom: 5, textTo: 13, url: 'https://example.com' });
    });

    it('reads an empty address as a link with no address', () => {
        const view = mountLiveEditor('a [link]() here').view;

        expect(firstLinkParts(view)).toEqual({ textFrom: 3, textTo: 7, url: '' });
    });

    it('takes the address after the text when the text is an address too', () => {
        const view = mountLiveEditor('[https://a.example](https://b.example)').view;

        expect(firstLinkParts(view)).toEqual({ textFrom: 1, textTo: 18, url: 'https://b.example' });
    });

    it.each([
        ['a full reference', 'see [the docs][Docs]\n\n[docs]: https://d.example'],
        ['a collapsed reference', 'see [Docs][]\n\n[docs]: https://d.example'],
        ['a shortcut reference', 'see [DOCS]\n\n[docs]: https://d.example'],
    ])('finds the address of %s from its definition, ignoring case', (_name, text) => {
        const view = mountLiveEditor(text).view;

        expect(firstLinkParts(view)?.url).toBe('https://d.example');
        expect(shownLines(view)[0]).toMatch(/^see (the docs|Docs|DOCS)$/);
    });

    it('gives nothing for brackets with no definition, which stay as text', () => {
        const view = mountLiveEditor('tick [x] and [y][z]').view;

        expect(firstLinkParts(view) ?? null).toBeNull();
        expect(hiddenTexts(view)).toEqual([]);
        expect(shownLines(view)).toEqual(['tick [x] and [y][z]']);
    });
});

describe('scanInline', () => {
    it('shows a link with an empty address as its text, with no address on hover', () => {
        const view = mountLiveEditor('a [link]() here').view;

        expect(hiddenTexts(view)).toEqual(['[', ']()']);
        expect(view.contentDOM.querySelector('.cm-live-link')?.hasAttribute('title')).toBe(false);
    });

    it('marks a link once when its text is itself an address', () => {
        const view = mountLiveEditor('[https://a.example](https://b.example)').view;

        expect([...view.contentDOM.querySelectorAll('.cm-live-link')].map((link) => link.getAttribute('title')))
            .toEqual(['https://b.example']);
    });

    it('hides the indentation before heading marks', () => {
        const view = mountLiveEditor('  ## Indented').view;

        expect(hiddenTexts(view)).toEqual(['  ## ']);
        expect(shownLines(view)).toEqual(['Indented']);
    });

    it('numbers items the way their list writes them', () => {
        const view = mountLiveEditor('7) seven\n8) eight\n\nend').view;

        expect(shownLines(view)).toEqual(['7)seven', '8)eight', '', 'end']);
    });

    it('ticks an upper-case X and leaves an empty done task unstruck', () => {
        const view = mountLiveEditor('- [X] shipped\n- [x] \n\nend').view;

        expect([...view.contentDOM.querySelectorAll<HTMLInputElement>('input.cm-live-task')].map((box) => box.checked)).toEqual([true, true]);
        expect([...view.contentDOM.querySelectorAll('.cm-live-task-done')].map((done) => done.textContent)).toEqual(['shipped']);
    });

    it('draws a rule inside a quote as a line within the quote', () => {
        const view = mountLiveEditor('> above\n> ***\n> below').view;

        expect(widgetNames(view)).toEqual(['InlineRuleWidget']);
        expect(shownLines(view)).toEqual(['above', '', 'below']);
        expect(view.contentDOM.querySelectorAll('.cm-live-quote')).toHaveLength(3);
    });

    it('styles each line of a quote inside a quote once', () => {
        const view = mountLiveEditor('> outer\n> > inner').view;
        const quoteLines = scanInline(view.state, 0, view.state.doc.length)
            .filter(({ decoration }) => decoration.spec.class === 'cm-live-quote');

        expect(quoteLines.map((item) => item.from)).toEqual([0, 8]);
        expect(shownLines(view)).toEqual(['outer', 'inner']);
    });

    it('hides the title of a reference definition and shows it on hover over the address', () => {
        const view = mountLiveEditor('[faq]\n\n[faq]: https://f.example "Questions"').view;
        const address = view.contentDOM.querySelector('.cm-live-reference');

        expect(shownLines(view)[2]).toBe('faq → https://f.example');
        expect(address?.textContent).toBe('https://f.example');
        expect(address?.getAttribute('title')).toBe('Questions');
    });

    it('leaves the front matter undecorated, for its box to show as written', () => {
        const view = mountLiveEditor('---\ntitle: **not bold**\n---\n\n**bold**').view;

        expect(hiddenTexts(view)).toEqual(['**', '**']);
        expect(scanInline(view.state, 0, view.state.doc.length).every((item) => item.from > 27)).toBe(true);
        expect(shownLines(view)).toContain('title: **not bold**');
    });

    it('decorates only the nodes in the scanned range', () => {
        const view = mountLiveEditor('**one**\n\n**two**').view;
        const second = view.state.doc.line(3);
        const items = scanInline(view.state, second.from, second.to);

        expect(items.map((item) => view.state.sliceDoc(item.from, item.to))).toEqual(['**', '**']);
        expect(items.every((item) => item.from >= second.from)).toBe(true);
    });
});

describe('images', () => {
    it('loads the address after the alt text when the alt text is an address too', () => {
        const view = mountLiveEditor('![https://a.example](data:image/png;base64,AA)').view;

        expect(view.contentDOM.querySelector('img.cm-live-image')?.getAttribute('src')).toBe('data:image/png;base64,AA');
    });
});
