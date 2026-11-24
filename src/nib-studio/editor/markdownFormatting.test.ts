import { describe, expect, it } from 'vitest';
import { history, undo, undoDepth } from '@codemirror/commands';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';
import {
    CODE_BLOCK_LANGUAGES,
    MARKDOWN_FORMATS,
    codeBlockChoices,
    currentCodeBlockLanguage,
    cycleHeading,
    headingChoices,
    setCodeBlockLanguage,
    setHeadingLevel,
    insertLink,
    isBold,
    isItalic,
    toggleBold,
    toggleBulletedList,
    toggleCodeBlock,
    toggleInlineCode,
    toggleItalic,
    toggleNumberedList,
    toggleQuote,
    toggleStrikethrough,
    toggleTaskList,
} from './markdownFormatting.js';

type FormattingFunction = (state: EditorState) => TransactionSpec;

function createState(text: string, from: number, to = from): EditorState {
    return EditorState.create({
        doc: text,
        selection: EditorSelection.single(from, to),
        extensions: [history()],
    });
}

// Builds a state selecting `selected` within `text`.
function stateSelecting(text: string, selected: string): EditorState {
    const from = text.indexOf(selected);

    return createState(text, from, from + selected.length);
}

function apply(state: EditorState, format: FormattingFunction): EditorState {
    return state.update(format(state)).state;
}

function selectedText(state: EditorState): string {
    const { from, to } = state.selection.main;

    return state.sliceDoc(from, to);
}

describe('inline formats', () => {
    it('wraps the selection in bold markers and keeps the text selected', () => {
        const result = apply(stateSelecting('make it loud', 'loud'), toggleBold);

        expect(result.doc.toString()).toBe('make it **loud**');
        expect(selectedText(result)).toBe('loud');
    });

    it('removes bold markers around the selection', () => {
        const result = apply(stateSelecting('make it **loud**', 'loud'), toggleBold);

        expect(result.doc.toString()).toBe('make it loud');
        expect(selectedText(result)).toBe('loud');
    });

    it('removes bold markers inside the selection', () => {
        const result = apply(stateSelecting('make it **loud**', '**loud**'), toggleBold);

        expect(result.doc.toString()).toBe('make it loud');
        expect(selectedText(result)).toBe('loud');
    });

    it('adds italic to bold text instead of removing a bold marker', () => {
        const state = stateSelecting('**word**', 'word');

        expect(isBold(state)).toBe(true);
        expect(isItalic(state)).toBe(false);
        expect(apply(state, toggleItalic).doc.toString()).toBe('***word***');
    });

    it('removes italic from bold italic text and keeps the bold', () => {
        const result = apply(stateSelecting('***word***', 'word'), toggleItalic);

        expect(result.doc.toString()).toBe('**word**');
    });

    it('toggles strikethrough on and off', () => {
        const struck = apply(stateSelecting('old plan', 'old'), toggleStrikethrough);
        expect(struck.doc.toString()).toBe('~~old~~ plan');

        expect(apply(struck, toggleStrikethrough).doc.toString()).toBe('old plan');
    });

    it('toggles inline code on and off', () => {
        const coded = apply(stateSelecting('run npm test now', 'npm test'), toggleInlineCode);
        expect(coded.doc.toString()).toBe('run `npm test` now');
        expect(selectedText(coded)).toBe('npm test');

        expect(apply(coded, toggleInlineCode).doc.toString()).toBe('run npm test now');
    });

    it('formats every selection range', () => {
        const state = EditorState.create({
            doc: 'one two',
            selection: EditorSelection.create([EditorSelection.range(0, 3), EditorSelection.range(4, 7)]),
            extensions: [EditorState.allowMultipleSelections.of(true)],
        });

        expect(apply(state, toggleBold).doc.toString()).toBe('**one** **two**');
    });
});

// A state that knows the Markdown syntax, with the caret where `|` is.
function markdownStateAt(textWithCaret: string): EditorState {
    const caret = textWithCaret.indexOf('|');
    const state = EditorState.create({
        doc: textWithCaret.replace('|', ''),
        selection: EditorSelection.single(caret),
        extensions: [history(), markdown({ base: markdownLanguage })],
    });
    ensureSyntaxTree(state, state.doc.length, 5000);

    return state;
}

function textWithCaret(state: EditorState): string {
    const head = state.selection.main.head;
    const text = state.doc.toString();

    return `${text.slice(0, head)}|${text.slice(head)}`;
}

describe('formats with nothing selected', () => {
    it.each([
        ['bold', toggleBold, 'make it **lo|ud**'],
        ['italic', toggleItalic, 'make it *lo|ud*'],
        ['strikethrough', toggleStrikethrough, 'make it ~~lo|ud~~'],
        ['inline code', toggleInlineCode, 'make it `lo|ud`'],
    ])('applies %s to the word at the caret and keeps the caret in place', (_name, format, expected) => {
        expect(textWithCaret(apply(markdownStateAt('make it lo|ud'), format))).toBe(expected);
    });

    it('formats the word the caret ends', () => {
        expect(textWithCaret(apply(markdownStateAt('make it loud|'), toggleBold))).toBe('make it **loud|**');
    });

    it('inserts empty markers with the caret between them away from any word', () => {
        expect(textWithCaret(apply(markdownStateAt('make it |'), toggleBold))).toBe('make it **|**');
        expect(textWithCaret(apply(markdownStateAt('make it **|**'), toggleBold))).toBe('make it |');
    });

    it('removes the format around the caret anywhere inside it', () => {
        const state = markdownStateAt('a **bold wo|rds** b');

        expect(isBold(state)).toBe(true);
        expect(textWithCaret(apply(state, toggleBold))).toBe('a bold wo|rds b');
    });

    it('counts a caret on the outer edge of a format as outside it', () => {
        expect(isBold(markdownStateAt('a **bold**| b'))).toBe(false);
        expect(isBold(markdownStateAt('a |**bold** b'))).toBe(false);
        expect(isItalic(markdownStateAt('a *so|ft* b'))).toBe(true);
    });

    it('links the word at the caret, or unwraps the link around it', () => {
        const linked = apply(markdownStateAt('see do|cs now'), insertLink);

        expect(linked.doc.toString()).toBe('see [docs](url) now');
        expect(selectedText(linked)).toBe('url');
        expect(textWithCaret(apply(markdownStateAt('see [the do|cs](https://x.y) now'), insertLink))).toBe('see the do|cs now');

        const empty = apply(markdownStateAt('a | b'), insertLink);

        expect(empty.doc.toString()).toBe('a [](url) b');
        expect(selectedText(empty)).toBe('url');
    });

    it('removes the fences of the code block around a caret deep inside it', () => {
        const state = markdownStateAt('```ts\nlet a;\nlet b|;\nlet c;\n```');
        const bar = MARKDOWN_FORMATS.find((format) => format.id === 'codeBlock')!;

        expect(bar.isActive?.(state)).toBe(true);
        expect(currentCodeBlockLanguage(state)).toBe('ts');
        expect(apply(state, toggleCodeBlock).doc.toString()).toBe('let a;\nlet b;\nlet c;');
    });
});

describe('insertLink', () => {
    it('links plain text and selects the url placeholder', () => {
        const result = apply(stateSelecting('see the docs', 'the docs'), insertLink);

        expect(result.doc.toString()).toBe('see [the docs](url)');
        expect(selectedText(result)).toBe('url');
    });

    it('uses a selected URL as both text and destination and selects the text', () => {
        const url = 'https://example.com/page';
        const result = apply(stateSelecting(`visit ${url}`, url), insertLink);

        expect(result.doc.toString()).toBe(`visit [${url}](${url})`);
        expect(result.selection.main.from).toBe('visit ['.length);
        expect(selectedText(result)).toBe(url);
    });

    it('unwraps a selected link back to its text', () => {
        const result = apply(stateSelecting('a [label](https://x.y) b', '[label](https://x.y)'), insertLink);

        expect(result.doc.toString()).toBe('a label b');
        expect(selectedText(result)).toBe('label');
    });

    it('unwraps a link around the selected text', () => {
        const result = apply(stateSelecting('a [label](https://x.y) b', 'label'), insertLink);

        expect(result.doc.toString()).toBe('a label b');
        expect(selectedText(result)).toBe('label');
    });
});

describe('toggleCodeBlock', () => {
    it('fences the selected lines and puts the caret on the language slot', () => {
        const text = 'intro\nconst a = 1;\nconst b = 2;\noutro';
        const result = apply(stateSelecting(text, 'a = 1;\nconst b'), toggleCodeBlock);

        expect(result.doc.toString()).toBe('intro\n```\nconst a = 1;\nconst b = 2;\n```\noutro');
        expect(result.selection.main.empty).toBe(true);
        expect(result.selection.main.head).toBe('intro\n```'.length);
    });

    it('removes fences around the selected lines', () => {
        const result = apply(stateSelecting('```ts\nlet x;\n```', 'let x;'), toggleCodeBlock);

        expect(result.doc.toString()).toBe('let x;');
        expect(selectedText(result)).toBe('let x;');
    });

    it('removes fences included in the selection', () => {
        const text = '```\nlet x;\n```';
        const result = apply(createState(text, 0, text.length), toggleCodeBlock);

        expect(result.doc.toString()).toBe('let x;');
    });
});

describe('line formats', () => {
    it('cycles the heading level from none to three and back', () => {
        let state = createState('Title', 2);
        const seen: string[] = [];

        for (let step = 0; step < 4; step++) {
            state = apply(state, cycleHeading);
            seen.push(state.doc.toString());
        }

        expect(seen).toEqual(['# Title', '## Title', '### Title', 'Title']);
    });

    it('quotes every selected line and unquotes them again', () => {
        const text = 'first\nsecond';
        const quoted = apply(createState(text, 0, text.length), toggleQuote);
        expect(quoted.doc.toString()).toBe('> first\n> second');
        expect(selectedText(quoted)).toBe('first\n> second');

        const unquoted = apply(createState(quoted.doc.toString(), 0, quoted.doc.length), toggleQuote);
        expect(unquoted.doc.toString()).toBe(text);
    });

    it('adds the prefix only where it is missing and skips blank lines', () => {
        const text = '- one\ntwo\n\nthree';
        const result = apply(createState(text, 0, text.length), toggleBulletedList);

        expect(result.doc.toString()).toBe('- one\n- two\n\n- three');
    });

    it('numbers the selected lines in order', () => {
        const text = 'alpha\nbeta\ngamma';
        const result = apply(createState(text, 0, text.length), toggleNumberedList);

        expect(result.doc.toString()).toBe('1. alpha\n2. beta\n3. gamma');
    });

    it('turns a bulleted list into a task list and back to plain lines', () => {
        const text = '- buy milk\n- call home';
        const tasks = apply(createState(text, 0, text.length), toggleTaskList);
        expect(tasks.doc.toString()).toBe('- [ ] buy milk\n- [ ] call home');

        const plain = apply(createState(tasks.doc.toString(), 0, tasks.doc.length), toggleTaskList);
        expect(plain.doc.toString()).toBe('buy milk\ncall home');
    });

    it('keeps list indentation', () => {
        const result = apply(createState('    nested', 6), toggleBulletedList);

        expect(result.doc.toString()).toBe('    - nested');
    });

    it('ignores a line the selection only touches at its start', () => {
        const text = 'one\ntwo';
        const result = apply(createState(text, 0, 'one\n'.length), toggleQuote);

        expect(result.doc.toString()).toBe('> one\ntwo');
    });
});

describe('undo', () => {
    it('undoes each formatting action as a single step', () => {
        let state = stateSelecting('a [b](c) line', 'line');
        state = apply(state, toggleBold);
        state = apply(state, toggleItalic);
        state = apply(state, toggleNumberedList);

        expect(state.doc.toString()).toBe('1. a [b](c) ***line***');
        expect(undoDepth(state)).toBe(3);

        undo({ state, dispatch: (transaction) => {
            state = transaction.state;
        } });

        expect(state.doc.toString()).toBe('a [b](c) ***line***');
    });
});

describe('MARKDOWN_FORMATS', () => {
    it('lists every format once with a label and a glyph', () => {
        const ids = MARKDOWN_FORMATS.map((format) => format.id);

        expect(new Set(ids).size).toBe(ids.length);

        for (const format of MARKDOWN_FORMATS) {
            expect(format.label.length).toBeGreaterThan(0);
            expect(format.glyph).toContain('<svg');
        }
    });

    it('pairs every shortcut label with a key binding', () => {
        for (const format of MARKDOWN_FORMATS) {
            expect(format.shortcut == null).toBe(format.key == null);
        }
    });
});

describe('setHeadingLevel', () => {
    it('sets any of the six levels and back to plain text', () => {
        const state = stateSelecting('# Title', 'Title');

        expect(apply(state, (target) => setHeadingLevel(target, 5)).doc.toString()).toBe('##### Title');
        expect(apply(state, (target) => setHeadingLevel(target, 0)).doc.toString()).toBe('Title');
    });

    it('offers normal text and headings 1 to 6 with the current level marked', () => {
        const choices = headingChoices(stateSelecting('### Title', 'Title'));

        expect(choices.map((choice) => choice.label)).toEqual([
            'Normal text',
            'Heading 1',
            'Heading 2',
            'Heading 3',
            'Heading 4',
            'Heading 5',
            'Heading 6',
        ]);
        expect(choices.find((choice) => choice.isCurrent)?.label).toBe('Heading 3');
    });
});

describe('setCodeBlockLanguage', () => {
    it('wraps the selected lines in a fence for the language', () => {
        const text = 'flowchart LR\n    A --> B';
        const result = apply(createState(text, 0, text.length), (target) => setCodeBlockLanguage(target, 'mermaid'));

        expect(result.doc.toString()).toBe('```mermaid\nflowchart LR\n    A --> B\n```');
    });

    it('relabels the code block already around the selection', () => {
        const state = stateSelecting('```ts\nlet x;\n```', 'let x;');

        expect(currentCodeBlockLanguage(state)).toBe('ts');
        expect(apply(state, (target) => setCodeBlockLanguage(target, 'javascript')).doc.toString())
            .toBe('```javascript\nlet x;\n```');
    });

    it('lists languages alphabetically, including mermaid, and offers removal inside a block', () => {
        const sorted = [...CODE_BLOCK_LANGUAGES].sort((left, right) => left.localeCompare(right));
        const inside = codeBlockChoices(stateSelecting('```ts\nlet x;\n```', 'let x;'));

        expect(CODE_BLOCK_LANGUAGES).toEqual(sorted);
        expect(CODE_BLOCK_LANGUAGES).toContain('mermaid');
        expect(inside.at(-1)?.label).toBe('Remove code block');
        expect(codeBlockChoices(stateSelecting('plain', 'plain')).some((choice) => choice.label === 'Remove code block')).toBe(false);
    });
});
