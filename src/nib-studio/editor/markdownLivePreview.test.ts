import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { undo, undoDepth } from '@codemirror/commands';
import type { EditorView, WidgetType } from '@codemirror/view';
import { renderMermaidIntoAsync } from '../views/mermaidBridge.js';
import { destroyLiveEditors, mountLiveEditor, shownLines } from '../testing/liveEditor.js';
import { ignoreSelectionChange, settleAsync } from '../testing/testHelpers.js';
import { buildImage, renderedDiagrams, toggleTaskAt } from './markdownLivePreview.js';
import { scanInline } from './liveInline.js';
import type { LiveItem } from './liveItems.js';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';

vi.mock('../views/mermaidBridge.js', () => ({
    renderMermaidIntoAsync: vi.fn(async (placeholder: HTMLElement, source: string) => {
        placeholder.innerHTML = `<svg data-diagram="true"><text>${source.length}</text></svg>`;
    }),
}));

beforeEach(() => {
    document.addEventListener('selectionchange', ignoreSelectionChange, true);
});

afterEach(() => {
    destroyLiveEditors();
    document.body.replaceChildren();
    document.removeEventListener('selectionchange', ignoreSelectionChange, true);
    vi.clearAllMocks();
});

function moveCaret(view: EditorView, position: number): void {
    view.dispatch({ selection: { anchor: position } });
}

// The inline layer's items over the whole document, in document order.
function inlineItems(view: EditorView): LiveItem[] {
    return scanInline(view.state, 0, view.state.doc.length).sort((left, right) => left.from - right.from || left.to - right.to);
}

// The source text each plain replace decoration of the inline layer hides.
function hiddenTexts(view: EditorView): string[] {
    return inlineItems(view)
        .filter(({ from, to, decoration }) => (
            decoration.spec.widget == null && to > from && decoration.spec.class == null && decoration.spec.attributes == null
        ))
        .map(({ from, to }) => view.state.sliceDoc(from, to));
}

// The widget type names of the inline layer and the source each replaces.
function widgets(view: EditorView): Array<{ name: string; source: string }> {
    return inlineItems(view)
        .filter(({ decoration }) => decoration.spec.widget != null)
        .map(({ from, to, decoration }) => ({
            name: (decoration.spec.widget as WidgetType).constructor.name,
            source: view.state.sliceDoc(from, to),
        }));
}

function markedTexts(view: EditorView, className: string): string[] {
    return inlineItems(view)
        .filter(({ from, to, decoration }) => decoration.spec.class === className && to > from)
        .map(({ from, to }) => view.state.sliceDoc(from, to));
}

// Every caret position, so a test can check something holds wherever the caret is.
function everyCaret(view: EditorView, check: () => void): void {
    for (let position = 0; position <= view.state.doc.length; position++) {
        moveCaret(view, position);
        check();
    }
}

describe('inline syntax', () => {
    it.each([
        ['bold', 'some **loud** words', ['**', '**'], 'some loud words'],
        ['bold with underscores', 'some __loud__ words', ['__', '__'], 'some loud words'],
        ['italic', 'some *soft* words', ['*', '*'], 'some soft words'],
        ['italic with underscores', 'some _soft_ words', ['_', '_'], 'some soft words'],
        ['strikethrough', 'some ~~old~~ words', ['~~', '~~'], 'some old words'],
        ['inline code', 'run `npm test` now', ['`', '`'], 'run npm test now'],
        ['an escape', 'a \\* b', ['\\'], 'a * b'],
    ])('hides the %s markers wherever the caret is', (_name, text, markers, shown) => {
        const view = mountLiveEditor(text).view;

        everyCaret(view, () => {
            expect(hiddenTexts(view)).toEqual(markers);
            expect(shownLines(view)).toEqual([shown]);
        });
    });

    it('styles inline code', () => {
        const view = mountLiveEditor('run `npm test` now').view;

        expect(markedTexts(view, 'cm-live-code')).toEqual(['`npm test`']);
    });

    it('shows a link as its text, with the address on hover, and never builds an anchor', () => {
        const view = mountLiveEditor('see [the docs](https://example.com "Docs") now').view;

        everyCaret(view, () => {
            expect(hiddenTexts(view)).toEqual(['[', '](https://example.com "Docs")']);
            expect(shownLines(view)).toEqual(['see the docs now']);
        });
        expect(view.contentDOM.querySelector('.cm-live-link')?.getAttribute('title')).toBe('https://example.com');
        expect(view.contentDOM.querySelector('a')).toBeNull();
    });

    it('shows reference links by their text, with the address from the definition', () => {
        const view = mountLiveEditor('see [the docs][d] and [faq]\n\n[d]: https://d.example\n[faq]: https://f.example "FAQ"').view;
        const links = [...view.contentDOM.querySelectorAll('.cm-live-link')].map((link) => [link.textContent, link.getAttribute('title')]);

        expect(links).toEqual([['the docs', 'https://d.example'], ['faq', 'https://f.example']]);
        expect(shownLines(view)[0]).toBe('see the docs and faq');
        expect(shownLines(view)[2]).toBe('d → https://d.example');
    });

    it('marks bare and angle-bracket links and hides the brackets', () => {
        const view = mountLiveEditor('visit https://example.com or <https://example.org>').view;

        expect(markedTexts(view, 'cm-live-link')).toEqual(['https://example.com', '<https://example.org>']);
        expect(shownLines(view)).toEqual(['visit https://example.com or https://example.org']);
    });

    it('leaves raw HTML as text', () => {
        const view = mountLiveEditor('<b>raw</b> and <!-- note -->').view;

        expect(hiddenTexts(view)).toEqual([]);
        expect(view.contentDOM.querySelector('b')).toBeNull();
        expect(shownLines(view)).toEqual(['<b>raw</b> and <!-- note -->']);
    });

    it('renders data images and never loads a web image', () => {
        const view = mountLiveEditor('![dot](data:image/png;base64,iVBORw0KGgo=) and ![logo](https://example.com/logo.png)').view;
        const image = view.contentDOM.querySelector('img.cm-live-image');
        // CodeMirror's own widget buffers are images without a source.
        const loading = [...view.contentDOM.querySelectorAll('img')].filter((element) => element.hasAttribute('src'));

        everyCaret(view, () => {
            expect(widgets(view).map((widget) => widget.name)).toEqual(['ImageWidget', 'ImageWidget']);
        });
        expect(image?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
        expect(loading).toEqual([image]);
        expect(view.contentDOM.querySelector('.cm-live-image-blocked')?.textContent)
            .toBe('Remote image not loaded (offline): https://example.com/logo.png');
    });

    it('selects an image when it is clicked', () => {
        const view = mountLiveEditor('a ![dot](data:image/png;base64,AA) b').view;
        const image = view.contentDOM.querySelector<HTMLElement>('img.cm-live-image')!;

        image.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

        expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('![dot](data:image/png;base64,AA)');
    });

    it('labels an image as the previews do when the view has no workspace', () => {
        expect(buildImage('images/chart.png', 'Chart').textContent).toBe('Image not shown (file outside the workspace): images/chart.png');
        expect(buildImage('javascript:alert(1)', '').tagName).toBe('SPAN');
    });
});

describe('line syntax', () => {
    it('hides heading marks wherever the caret is and sizes the line per level', () => {
        const view = mountLiveEditor('# Title\n\n### Third ###\n\nbody').view;

        everyCaret(view, () => {
            expect(hiddenTexts(view)).toEqual(['# ', '### ', ' ###']);
        });
        expect(view.contentDOM.querySelectorAll('.cm-live-heading')).toHaveLength(2);
        expect(view.contentDOM.querySelector('.cm-live-heading')?.getAttribute('data-level')).toBe('1');
        expect(shownLines(view)).toEqual(['Title', '', 'Third', '', 'body']);
    });

    it('keeps a lone # as text until a space follows it', () => {
        const view = mountLiveEditor('#hashtag\n\n#').view;

        expect(hiddenTexts(view)).toEqual([]);
        expect(shownLines(view)).toEqual(['#hashtag', '', '#']);
    });

    it('hides a setext underline and styles the text as a heading', () => {
        const view = mountLiveEditor('Title\n=====\n\nSub\n---\n\nbody').view;

        everyCaret(view, () => {
            expect(shownLines(view)).toEqual(['Title', '', 'Sub', '', 'body']);
        });
        expect([...view.contentDOM.querySelectorAll('.cm-live-heading')].map((line) => line.getAttribute('data-level'))).toEqual(['1', '2']);
    });

    it('hides quote marks wherever the caret is and borders every quoted line', () => {
        const view = mountLiveEditor('> first\n> second\n\nend').view;

        everyCaret(view, () => {
            expect(hiddenTexts(view)).toEqual(['> ', '> ']);
        });
        expect(view.contentDOM.querySelectorAll('.cm-live-quote')).toHaveLength(2);
    });

    it('shows bullets as • and numbers as the item number', () => {
        const view = mountLiveEditor('- one\n* two\n  - nested\n\n3. three\n3. four\n\nend').view;

        everyCaret(view, () => {
            expect(shownLines(view)).toEqual(['•one', '•two', '•nested', '', '3.three', '4.four', '', 'end']);
        });
        expect([...view.contentDOM.querySelectorAll('.cm-live-list-item')].map((line) => (line as HTMLElement).style.getPropertyValue('--list-depth')))
            .toEqual(['0', '0', '1', '0', '0']);
    });

    it('lines up a list item continuation line with the item text, without its indentation', () => {
        const view = mountLiveEditor('- one\n  more\n- two').view;
        const lines = [...view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')];

        expect(shownLines(view)).toEqual(['•one', 'more', '•two']);
        expect(lines.map((line) => line.getAttribute('data-continued'))).toEqual([null, 'true', null]);
    });

    it('keeps a lone list marker as text until a space follows it', () => {
        const view = mountLiveEditor('-\n\n1.').view;

        expect(widgets(view)).toEqual([]);
    });

    it('draws task markers as checkboxes and strikes done tasks', () => {
        const view = mountLiveEditor('- [ ] open\n- [x] done\n\nend').view;
        const boxes = [...view.contentDOM.querySelectorAll<HTMLInputElement>('input.cm-live-task')];

        everyCaret(view, () => {
            expect(widgets(view).map((widget) => widget.source)).toEqual(['- [ ] ', '- [x] ']);
        });
        expect(boxes.map((box) => box.checked)).toEqual([false, true]);
        expect(markedTexts(view, 'cm-live-task-done')).toEqual(['done']);
    });

    it('draws a horizontal rule as a line wherever the caret is', () => {
        const view = mountLiveEditor('text\n\n---\n\nend').view;

        everyCaret(view, () => {
            expect(view.contentDOM.querySelector('.cm-live-rule')).not.toBeNull();
            expect(view.contentDOM.textContent).not.toContain('---');
        });
    });
});

describe('code boxes', () => {
    it('shows the code in a box with a language label and never the fences', () => {
        const view = mountLiveEditor('intro\n\n```js\nlet x = 1;\nlet y = 2;\n```\n\nend').view;

        everyCaret(view, () => {
            const box = view.contentDOM.querySelector('.cm-live-code-box');
            expect(box?.querySelector('.cm-live-code-language')?.textContent).toBe('js');
            expect([...box!.querySelectorAll('.cm-line')].map((line) => line.textContent)).toEqual(['let x = 1;', 'let y = 2;']);
            expect(view.contentDOM.textContent).not.toContain('```');
        });
    });

    it('labels a block without a language as plain text', () => {
        const view = mountLiveEditor('```\ncode\n```').view;

        expect(view.contentDOM.querySelector('.cm-live-code-language')?.textContent).toBe('Plain text');
    });

    it('puts the caret in the box and asks for the language menu when the label is pressed', () => {
        const view = mountLiveEditor('intro‸\n\n```js\nlet x;\n```').view;
        const label = view.contentDOM.querySelector<HTMLElement>('.cm-live-code-language')!;
        const asked = vi.fn();
        view.dom.addEventListener('live-code-language', asked);
        const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });

        label.dispatchEvent(mousedown);

        expect(mousedown.defaultPrevented).toBe(true);
        expect(view.state.selection.main.head).toBe('intro\n\n```js\n'.length);
        expect(asked).toHaveBeenCalledTimes(1);
    });

    it('sets an indented code block in a box without its indentation', () => {
        const view = mountLiveEditor('text\n\n    code line\n\nend').view;

        expect(view.contentDOM.querySelectorAll('.cm-live-code-box .cm-line')).toHaveLength(1);
        expect(shownLines(view)[2]).toBe('code line');
    });

    it('shows front matter as a muted box without its dashes', () => {
        const view = mountLiveEditor('---\ntitle: Notes\ntags: [a]\n---\n\n# Body').view;

        everyCaret(view, () => {
            expect(view.contentDOM.querySelector('.cm-live-front-matter')).not.toBeNull();
            expect(view.contentDOM.textContent).not.toContain('---');
        });
        expect([...view.contentDOM.querySelectorAll('.cm-live-front-matter-line')].map((line) => line.textContent))
            .toEqual(['title: Notes', 'tags: [a]']);
        expect(view.contentDOM.querySelectorAll('.cm-live-heading')).toHaveLength(1);
    });
});

describe('mermaid diagrams', () => {
    it('draws the diagram while the caret is outside the block', async () => {
        const view = mountLiveEditor('# Flow\n\n```mermaid\ngraph TD; A-->B\n```\n\nend').view;
        await settleAsync();

        expect(renderedDiagrams(view.state).map((region) => region.kind)).toEqual(['mermaid']);
        expect(vi.mocked(renderMermaidIntoAsync).mock.calls[0]?.[1]).toBe('graph TD; A-->B');
        expect(view.dom.querySelector('.cm-live-mermaid svg')).not.toBeNull();
        expect(view.contentDOM.textContent).not.toContain('graph TD');
    });

    it('shows the source as a code box with the live diagram when the caret enters', async () => {
        const view = mountLiveEditor('```mermaid\ngraph TD; A-->B\n```\n\nend').view;

        moveCaret(view, 14);
        await settleAsync();

        expect(renderedDiagrams(view.state)).toEqual([]);
        expect(view.contentDOM.querySelector('.cm-live-code-box[data-kind="mermaid"] .cm-line')?.textContent).toBe('graph TD; A-->B');
        expect(view.contentDOM.querySelector('.cm-live-diagram-panel svg')).not.toBeNull();
        expect(view.contentDOM.textContent).not.toContain('```');

        moveCaret(view, view.state.doc.length);
        await settleAsync();

        expect(view.dom.querySelector('.cm-live-mermaid svg')).not.toBeNull();
        expect(view.contentDOM.querySelector('.cm-live-diagram-panel')).toBeNull();
    });

    it('draws the diagram again a moment after the source changes', async () => {
        vi.useFakeTimers();

        try {
            const view = mountLiveEditor('```mermaid\ngraph TD; A-->B‸\n```\n\nend').view;
            await vi.advanceTimersByTimeAsync(0);
            const callsBefore = vi.mocked(renderMermaidIntoAsync).mock.calls.length;

            view.dispatch(view.state.replaceSelection('-->C'));
            await vi.advanceTimersByTimeAsync(100);

            expect(vi.mocked(renderMermaidIntoAsync).mock.calls.length).toBe(callsBefore);

            await vi.advanceTimersByTimeAsync(400);

            expect(vi.mocked(renderMermaidIntoAsync).mock.calls.at(-1)?.[1]).toBe('graph TD; A-->B-->C');
            expect(view.contentDOM.querySelector('.cm-live-diagram-panel svg text')?.textContent).toBe(String('graph TD; A-->B-->C'.length));
        }
        finally {
            vi.useRealTimers();
        }
    });

    it('puts the caret in the source when the diagram is clicked', async () => {
        const view = mountLiveEditor('```mermaid\ngraph TD; A-->B\n```\n\nend').view;
        await settleAsync();
        const diagram = view.dom.querySelector<HTMLElement>('.cm-live-mermaid')!;
        const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });

        diagram.dispatchEvent(mousedown);

        expect(mousedown.defaultPrevented).toBe(true);
        expect(view.state.selection.main.head).toBe('```mermaid\n'.length);
        expect(view.dom.querySelector('.cm-live-mermaid')).toBeNull();
    });
});

describe('tables', () => {
    const TABLE = '| Name | Qty |\n| :--- | :-: |\n| **Widget** | 3 |\n| a\\|b | |';

    it('draws a grid of cells with no pipes or delimiter row, wherever the caret is', () => {
        const view = mountLiveEditor(`${TABLE}\n\nend`).view;

        everyCaret(view, () => {
            const rows = [...view.contentDOM.querySelectorAll('.cm-live-table .cm-live-table-row')];
            expect(rows.map((row) => [...row.querySelectorAll('.cm-live-table-cell')].map((cell) => cell.textContent))).toEqual([
                ['Name', 'Qty'],
                ['Widget', '3'],
                ['a|b', ' '],
            ]);
            // The escaped pipe of `a\|b` is cell text.
            expect((view.contentDOM.textContent ?? '').replace('a|b', '')).not.toMatch(/\||---/);
        });
    });

    it('marks the header row and aligns the columns', () => {
        const view = mountLiveEditor(TABLE).view;
        const header = view.contentDOM.querySelector('.cm-live-table-row[data-header="true"]');
        const cells = [...header!.querySelectorAll<HTMLElement>('.cm-live-table-cell')];

        expect(cells[1]?.style.textAlign).toBe('center');
        expect(Number(cells[0]?.style.flexGrow)).toBeGreaterThan(0);
    });

    it('fills a short row with empty cells so the columns line up', () => {
        const view = mountLiveEditor('| a | b | c |\n| - | - | - |\n| 1 |').view;
        const lastRow = [...view.contentDOM.querySelectorAll('.cm-live-table-row')].at(-1)!;

        expect(lastRow.querySelectorAll('.cm-live-table-cell')).toHaveLength(3);
    });
});

describe('the text', () => {
    const EVERYTHING = '---\nk: v\n---\n\n# T\n\nSub\n---\n\n**b** *i* ~~s~~ `c` [l](u) <https://x.y> ![a](data:image/png;base64,AA) \\*\n\n'
        + '> q\n\n- [ ] t\n- x\n1. n\n\n***\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```mermaid\ngraph TD;\n```\n\n```js\nlet a;\n```\n\n<div>html</div>\n';

    it('stays byte for byte while the caret moves through every construct', () => {
        const view = mountLiveEditor(EVERYTHING).view;
        const depth = undoDepth(view.state);

        everyCaret(view, () => {
            inlineItems(view);
        });

        expect(view.state.doc.toString()).toBe(EVERYTHING);
        expect(undoDepth(view.state)).toBe(depth);
    });

    it('never shows table pipes, code fences, heading marks or emphasis markers', () => {
        const view = mountLiveEditor(EVERYTHING).view;

        everyCaret(view, () => {
            const shown = view.contentDOM.textContent ?? '';
            expect(shown).not.toContain('|');
            expect(shown).not.toContain('```');
            expect(shown).not.toContain('#');
            expect(shown).not.toContain('**');
            expect(shown).not.toContain('](');
        });
    });
});

describe('task checkboxes', () => {
    it('toggles the task in the source on click, as one undo step', () => {
        const view = mountLiveEditor('- [ ] write tests\n- [x] ship\n\nend').view;
        const depthBefore = undoDepth(view.state);

        view.contentDOM.querySelector<HTMLInputElement>('input.cm-live-task')?.click();

        expect(view.state.doc.toString()).toBe('- [x] write tests\n- [x] ship\n\nend');
        expect(undoDepth(view.state)).toBe(depthBefore + 1);

        view.contentDOM.querySelectorAll<HTMLInputElement>('input.cm-live-task')[1]?.click();
        undo(view);
        undo(view);

        expect(view.state.doc.toString()).toBe('- [ ] write tests\n- [x] ship\n\nend');
    });

    it('keeps focus and the selection on mousedown', () => {
        const view = mountLiveEditor('- [ ] task\n\nend').view;
        const box = view.contentDOM.querySelector<HTMLInputElement>('input.cm-live-task')!;
        const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });

        box.dispatchEvent(mousedown);

        expect(mousedown.defaultPrevented).toBe(true);
        expect(view.state.selection.main.head).toBe(view.state.doc.length);
    });

    it('finds the task on the line from a position', () => {
        const state = EditorState.create({ doc: '> - [X] quoted', extensions: [markdown({ base: markdownLanguage })] });
        ensureSyntaxTree(state, state.doc.length, 5000);
        const spec = toggleTaskAt(state, 2);

        expect(state.update(spec!).state.doc.toString()).toBe('> - [ ] quoted');
        expect(toggleTaskAt(state, 9)).toBeNull();
    });
});
