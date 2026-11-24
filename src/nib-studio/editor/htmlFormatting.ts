import { syntaxTree } from '@codemirror/language';
import {
    ChangeSet,
    EditorSelection,
    Prec,
    type ChangeSpec,
    type EditorState,
    type Extension,
    type TransactionSpec,
} from '@codemirror/state';
import { keymap, type EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { escapeHtmlAttribute, escapeHtmlText } from '../../common/html/escapeHtml.js';
import { toast } from '../app/toast.js';
import type { EditorBarButton, EditorBarChoice } from './editorBar.js';
import { structuralEdit } from './htmlLiveEditing.js';
import {
    attributeValue,
    childElements,
    enclosingElementNamed,
    enclosingElements,
    findAttribute,
    HEADING_LEVELS,
    LIST_ELEMENTS,
    renameChanges,
    type HtmlElement,
} from './htmlStructure.js';
import { showLinkPopover } from './linkPopover.js';
import { asUndoStep, changesKeepingCaret, expandToWord } from './liveTransactions.js';
import { MARKDOWN_FORMATS, type MarkdownFormatId } from './markdownFormatting.js';

interface InlineFormat {
    // The tags that carry the format, any of which the button removes.
    readonly names: ReadonlySet<string>;
    // The tag the button adds.
    readonly tag: string;
}

const BOLD: InlineFormat = { names: new Set(['strong', 'b']), tag: 'strong' };
const ITALIC: InlineFormat = { names: new Set(['em', 'i']), tag: 'em' };
const LINK_NAMES: ReadonlySet<string> = new Set(['a']);
const ITEM_NAMES: ReadonlySet<string> = new Set(['li']);
const TEXT_BLOCK_NAMES: ReadonlySet<string> = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const INSIDE_MARKUP = new Set(['OpenTag', 'CloseTag', 'SelfClosingTag', 'Comment', 'DoctypeDecl']);
const MAX_HEADING_LEVEL = 6;
const ONE_ELEMENT_MESSAGE = 'Select text that starts and ends in the same element to format it.';
const HEADING_MESSAGE = 'Put the caret in a paragraph or heading, or select the text for the heading.';
const LIST_MESSAGE = 'Put the caret in a paragraph, heading or list, or select the text for the list.';

// Every formatting change is one undo step of its own, made on purpose with its tags where they are.
function formatting(spec: TransactionSpec): TransactionSpec {
    return asUndoStep(spec, 'input.format', structuralEdit.of(true));
}

// Bold or italic: removes the format when the selection is in an element that has it, as `<strong>` or `<b>`,
// and otherwise wraps the selection, or the word at the caret, in its tag; with neither,
// it adds an empty pair
// with the caret between,
// for the next text typed. Null when the selection starts and ends in different elements.
function toggleInlineFormat(state: EditorState, format: InlineFormat): TransactionSpec | null {
    const range = state.selection.main;
    const around = enclosingElementNamed(state, range.from, format.names);

    if (around != null && range.to <= around.contentTo) {
        return unwrapElement(state, around, range.from, range.to);
    }

    const target = expandToWord(state, range);
    const opening = `<${format.tag}>`;
    const closing = `</${format.tag}>`;

    if (target.empty) {
        return formatting({
            changes: { from: target.from, insert: `${opening}${closing}` },
            selection: EditorSelection.cursor(target.from + opening.length),
        });
    }

    if (!canWrap(state, target.from, target.to)) {
        return null;
    }

    return formatting({
        changes: [{ from: target.from, insert: opening }, { from: target.to, insert: closing }],
        selection: EditorSelection.range(target.from + opening.length, target.to + opening.length),
    });
}

export function toggleBold(state: EditorState): TransactionSpec | null {
    return toggleInlineFormat(state, BOLD);
}

export function toggleItalic(state: EditorState): TransactionSpec | null {
    return toggleInlineFormat(state, ITALIC);
}

export function isInFormat(state: EditorState, names: ReadonlySet<string>): boolean {
    return enclosingElementNamed(state, state.selection.main.head, names) != null;
}

// Removes an element's tags and keeps what is between them, with the selection on the same text.
function unwrapElement(state: EditorState, element: HtmlElement, from: number, to: number): TransactionSpec {
    const changes: ChangeSpec[] = [{ from: element.openFrom, to: element.openTo }];

    if (element.closeFrom != null && element.closeTo != null) {
        changes.push({ from: element.closeFrom, to: element.closeTo });
    }

    const changeSet = ChangeSet.of(changes, state.doc.length);

    return formatting({
        changes: changeSet,
        selection: EditorSelection.range(changeSet.mapPos(from, 1), changeSet.mapPos(to, -1)),
    });
}

// A wrap keeps the HTML well formed only when both ends sit in text of the same element, never inside a tag.
function canWrap(state: EditorState, from: number, to: number): boolean {
    if (isInsideMarkup(state, from) || isInsideMarkup(state, to)) {
        return false;
    }

    return enclosingElements(state, from)[0]?.from === enclosingElements(state, to)[0]?.from;
}

function isInsideMarkup(state: EditorState, position: number): boolean {
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, 1); node != null; node = node.parent) {
        if (INSIDE_MARKUP.has(node.name) && node.from < position && position < node.to) {
            return true;
        }
    }

    return false;
}

// Opens the link popover for the link around the selection,
// or for the selected text or the word at the caret.
// An address applied to a link changes its `href`, an empty one removes the link and keeps its text,
// and an address for text wraps it in `<a href>`, or adds a link reading the address where there is no text.
function openHtmlLinkPopover(view: EditorView): boolean {
    const { state } = view;
    const range = state.selection.main;
    const link = enclosingElementNamed(state, range.from, LINK_NAMES);

    if (link != null) {
        return showLinkPopover(view, {
            url: attributeValue(state, link, 'href') ?? '',
            isNew: false,
            anchor: link.contentFrom,
            apply: (current, url) => setLinkAddress(current, link, url),
        });
    }

    const target = expandToWord(state, range);

    return showLinkPopover(view, {
        url: '',
        isNew: true,
        anchor: target.from,
        apply: (current, url) => linkText(current, target.from, target.to, url),
    });
}

export function setLinkAddress(state: EditorState, link: HtmlElement, url: string): TransactionSpec {
    const address = url.trim();

    if (address === '') {
        return unwrapElement(state, link, state.selection.main.from, state.selection.main.to);
    }

    const attribute = findAttribute(state, link, 'href');
    const written = `href="${escapeHtmlAttribute(address)}"`;
    const change = attribute == null
        ? { from: link.nameTo, insert: ` ${written}` }
        : { from: attribute.from, to: attribute.to, insert: written };

    return formatting({ changes: change, selection: state.selection.map(ChangeSet.of(change, state.doc.length)) });
}

export function linkText(state: EditorState, from: number, to: number, url: string): TransactionSpec | null {
    const address = url.trim();

    if (address === '') {
        return null;
    }

    const opening = `<a href="${escapeHtmlAttribute(address)}">`;

    if (from === to) {
        const insert = `${opening}${escapeHtmlText(address)}</a>`;

        return formatting({ changes: { from, insert }, selection: EditorSelection.cursor(from + insert.length) });
    }

    if (!canWrap(state, from, to)) {
        toast(ONE_ELEMENT_MESSAGE, 'info');

        return null;
    }

    return formatting({
        changes: [{ from, insert: opening }, { from: to, insert: '</a>' }],
        selection: EditorSelection.cursor(to + opening.length + '</a>'.length),
    });
}

// The paragraph or heading around the caret, which Heading level renames.
function textBlockAt(state: EditorState): HtmlElement | null {
    return enclosingElementNamed(state, state.selection.main.head, TEXT_BLOCK_NAMES);
}

export function headingLevel(state: EditorState): number {
    const block = textBlockAt(state);

    return block == null ? 0 : HEADING_LEVELS.get(block.name) ?? 0;
}

// Makes the paragraph or heading around the caret a heading of the level, or a paragraph for level 0,
// keeping its attributes; selected text outside any becomes a heading of its own.
export function setHeadingLevel(state: EditorState, level: number): TransactionSpec | null {
    const name = level === 0 ? 'p' : `h${level}`;
    const block = textBlockAt(state);
    const range = state.selection.main;

    if (block != null) {
        return formatting(changesKeepingCaret(state, renameChanges(block, name), range.head));
    }

    if (level === 0 || range.empty || !canWrap(state, range.from, range.to)) {
        return null;
    }

    return formatting({
        changes: [{ from: range.from, insert: `<${name}>` }, { from: range.to, insert: `</${name}>` }],
        selection: EditorSelection.cursor(range.to + `<${name}></${name}>`.length),
    });
}

export function isList(state: EditorState, tag: string): boolean {
    const head = state.selection.main.head;

    return enclosingElementNamed(state, head, ITEM_NAMES) != null && enclosingElementNamed(state, head, LIST_ELEMENTS)?.name === tag;
}

// Bulleted (`ul`) or numbered (`ol`) list: in a list of the other kind it switches the kind;
// in a list of this kind it turns every item into a paragraph and removes the list;
// in a paragraph or heading it makes that a one-item list; and selected text outside any becomes one.
export function toggleList(state: EditorState, tag: 'ul' | 'ol'): TransactionSpec | null {
    const head = state.selection.main.head;
    const list = enclosingElementNamed(state, head, ITEM_NAMES) == null ? null : enclosingElementNamed(state, head, LIST_ELEMENTS);

    if (list != null && list.name !== tag) {
        return formatting(changesKeepingCaret(state, renameChanges(list, tag), head));
    }

    if (list != null) {
        return unwrapList(state, list, head);
    }

    const block = textBlockAt(state);

    if (block != null) {
        const changes: ChangeSpec[] = [{ from: block.openFrom, to: block.openTo, insert: `<${tag}><li>` }];
        changes.push(block.closeFrom != null && block.closeTo != null
            ? { from: block.closeFrom, to: block.closeTo, insert: `</li></${tag}>` }
            : { from: block.contentTo, insert: `</li></${tag}>` });

        return formatting(changesKeepingCaret(state, changes, head));
    }

    const range = state.selection.main;

    if (range.empty || !canWrap(state, range.from, range.to)) {
        return null;
    }

    return formatting({
        changes: [{ from: range.from, insert: `<${tag}><li>` }, { from: range.to, insert: `</li></${tag}>` }],
        selection: EditorSelection.cursor(range.to + `<${tag}><li></li></${tag}>`.length),
    });
}

function unwrapList(state: EditorState, list: HtmlElement, caret: number): TransactionSpec {
    const changes: ChangeSpec[] = [{ from: list.openFrom, to: list.openTo }];

    for (const item of childElements(state, list).filter((child) => child.name === 'li')) {
        changes.push({ from: item.nameFrom, to: item.nameTo, insert: 'p' });
        changes.push(item.closeNameFrom != null && item.closeNameTo != null
            ? { from: item.closeNameFrom, to: item.closeNameTo, insert: 'p' }
            : { from: item.contentTo, insert: '</p>' });
    }

    if (list.closeFrom != null && list.closeTo != null) {
        changes.push({ from: list.closeFrom, to: list.closeTo });
    }

    return formatting(changesKeepingCaret(state, changes, caret));
}

// Runs a command's change, or says why there is none.
function dispatchOr(view: EditorView, spec: TransactionSpec | null, message: string): boolean {
    if (view.state.readOnly) {
        return false;
    }

    if (spec == null) {
        toast(message, 'info');

        return true;
    }

    view.dispatch(spec);

    return true;
}

// Ctrl+B, Ctrl+I and Ctrl+K for HTML, in the Editor and Interactive views.
export function htmlFormattingKeymap(): Extension {
    return Prec.high(keymap.of([
        { key: 'Mod-b', run: (view) => dispatchOr(view, toggleBold(view.state), ONE_ELEMENT_MESSAGE) },
        { key: 'Mod-i', run: (view) => dispatchOr(view, toggleItalic(view.state), ONE_ELEMENT_MESSAGE) },
        { key: 'Mod-k', run: openHtmlLinkPopover },
    ]));
}

function glyphOf(id: MarkdownFormatId): string {
    return MARKDOWN_FORMATS.find((format) => format.id === id)?.glyph ?? '';
}

// The formatting buttons of the editor bar for HTML: bold, italic and link,
// then heading level and the two lists.
export function htmlFormattingButtonGroups(): ReadonlyArray<ReadonlyArray<EditorBarButton>> {
    const headingChoices = (state: EditorState): ReadonlyArray<EditorBarChoice> => {
        const current = headingLevel(state);

        return Array.from({ length: MAX_HEADING_LEVEL + 1 }, (_, level) => ({
            id: level === 0 ? 'paragraph' : `h${level}`,
            label: level === 0 ? 'Normal text' : `Heading ${level}`,
            isCurrent: level === current,
            run: (view: EditorView) => {
                dispatchOr(view, setHeadingLevel(view.state, level), HEADING_MESSAGE);
            },
        }));
    };

    return [
        [
            {
                id: 'bold',
                label: 'Bold',
                glyph: glyphOf('bold'),
                shortcut: 'Ctrl+B',
                run: (view) => {
                    dispatchOr(view, toggleBold(view.state), ONE_ELEMENT_MESSAGE);
                },
                isPressed: (state) => isInFormat(state, BOLD.names),
            },
            {
                id: 'italic',
                label: 'Italic',
                glyph: glyphOf('italic'),
                shortcut: 'Ctrl+I',
                run: (view) => {
                    dispatchOr(view, toggleItalic(view.state), ONE_ELEMENT_MESSAGE);
                },
                isPressed: (state) => isInFormat(state, ITALIC.names),
            },
            {
                id: 'link',
                label: 'Link',
                glyph: glyphOf('link'),
                shortcut: 'Ctrl+K',
                run: (view) => {
                    openHtmlLinkPopover(view);
                },
                isPressed: (state) => isInFormat(state, LINK_NAMES),
            },
        ],
        [
            {
                id: 'heading',
                label: 'Heading level',
                glyph: glyphOf('heading'),
                menu: headingChoices,
                isPressed: (state) => headingLevel(state) > 0,
            },
            {
                id: 'bulletedList',
                label: 'Bulleted list',
                glyph: glyphOf('bulletedList'),
                run: (view) => {
                    dispatchOr(view, toggleList(view.state, 'ul'), LIST_MESSAGE);
                },
                isPressed: (state) => isList(state, 'ul'),
            },
            {
                id: 'numberedList',
                label: 'Numbered list',
                glyph: glyphOf('numberedList'),
                run: (view) => {
                    dispatchOr(view, toggleList(view.state, 'ol'), LIST_MESSAGE);
                },
                isPressed: (state) => isList(state, 'ol'),
            },
        ],
    ];
}
