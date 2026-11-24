import { syntaxTree } from '@codemirror/language';
import { StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { Tree } from '@lezer/common';
import {
    attributeValue,
    BOXED_ELEMENTS,
    decodeHtmlText,
    HEADING_LEVELS,
    HTML_BLOCKS,
    htmlElementOf,
    type HtmlElement,
} from './htmlStructure.js';
import { atomicRangesOf, InlineRuleWidget, LiveImageWidget } from './liveDecorations.js';
import { HIDDEN } from './liveItems.js';

// What the Interactive view does with a range of the HTML source:
// `tag` hides a tag, `marker` shows a list bullet or a table cell edge in its place,
// `box` shows a labelled box
// for a whole element, comment or doctype, `indent` hides a line's indentation,
// and `entity` and `image` show what an entity or an `<img>` stands for.
export type HtmlItemKind = 'tag' | 'marker' | 'box' | 'indent' | 'entity' | 'image';

export interface HtmlItem {
    readonly from: number;
    readonly to: number;
    readonly kind: HtmlItemKind;
    // The element's tag name, for tags, markers and boxes.
    readonly name: string;
    // A tag of a block element, such as `<p>`, or a box: an edge that typing and deleting don't cross.
    readonly isBlock: boolean;
    // An opening tag, as against a closing one.
    readonly isOpening: boolean;
}

interface HtmlLiveValue {
    readonly tree: Tree;
    readonly items: ReadonlyArray<HtmlItem>;
    readonly decorations: DecorationSet;
    readonly atomic: DecorationSet;
}

const STRUCTURE_LINE = Decoration.line({ class: 'cm-html-structure' });

const INLINE_STYLES: ReadonlyMap<string, string> = new Map([
    ['strong', 'cm-html-strong'], ['b', 'cm-html-strong'], ['th', 'cm-html-strong'], ['dt', 'cm-html-strong'], ['summary', 'cm-html-strong'],
    ['em', 'cm-html-em'], ['i', 'cm-html-em'], ['cite', 'cm-html-em'], ['dfn', 'cm-html-em'], ['var', 'cm-html-em'], ['caption', 'cm-html-em'],
    ['u', 'cm-html-underline'], ['ins', 'cm-html-underline'],
    ['s', 'cm-html-strike'], ['del', 'cm-html-strike'], ['strike', 'cm-html-strike'],
    ['code', 'cm-live-code'], ['kbd', 'cm-live-code'], ['samp', 'cm-live-code'], ['tt', 'cm-live-code'],
    ['mark', 'cm-html-mark'], ['small', 'cm-html-small'], ['sub', 'cm-html-sub'], ['sup', 'cm-html-sup'],
]);

const LINE_STYLES: ReadonlyMap<string, Decoration> = new Map([
    ['blockquote', Decoration.line({ class: 'cm-live-quote' })],
    ['pre', Decoration.line({ class: 'cm-html-pre' })],
]);

const PROTECTED_KINDS: ReadonlySet<HtmlItemKind> = new Set(['tag', 'marker', 'box']);
const TAG_NODES = new Set(['OpenTag', 'CloseTag', 'SelfClosingTag']);
// The longest label a box shows before it is cut short with an ellipsis.
const MAX_BOX_LABEL = 40;

class BoxWidget extends WidgetType {
    constructor(readonly label: string) {
        super();
    }

    override eq(other: BoxWidget): boolean {
        return other.label === this.label;
    }

    toDOM(): HTMLElement {
        const box = document.createElement('span');
        box.className = 'cm-html-box';
        box.textContent = this.label;
        box.title = 'Edit this in the Editor view';

        return box;
    }

    override ignoreEvent(): boolean {
        return false;
    }
}

class TextWidget extends WidgetType {
    constructor(readonly text: string, readonly className: string) {
        super();
    }

    override eq(other: TextWidget): boolean {
        return other.text === this.text && other.className === this.className;
    }

    toDOM(): HTMLElement {
        const element = document.createElement('span');
        element.className = this.className;
        element.textContent = this.text;

        return element;
    }

    override ignoreEvent(): boolean {
        return false;
    }
}

class ImageWidget extends LiveImageWidget {
    override ignoreEvent(): boolean {
        return false;
    }
}

// Whether the item keeps its source through typing and deleting: tags, markers and boxes.
export function isProtectedItem(item: HtmlItem): boolean {
    return PROTECTED_KINDS.has(item.kind);
}

// The ranges the Interactive view hides or replaces, in order,
// with the decorations that draw the page's look.
function scanHtml(state: EditorState, tree: Tree = syntaxTree(state)): Omit<HtmlLiveValue, 'tree'> {
    const items: HtmlItem[] = [];
    const ranges: Array<Range<Decoration>> = [];
    let preDepth = 0;

    const addItem = (item: HtmlItem, decoration: Decoration): void => {
        if (item.to > item.from) {
            items.push(item);
            ranges.push(decoration.range(item.from, item.to));
        }
    };
    const addTag = (element: HtmlElement, from: number, to: number, isOpening: boolean): void => {
        addItem({ from, to, kind: 'tag', name: element.name, isBlock: HTML_BLOCKS.has(element.name), isOpening }, HIDDEN);
    };

    tree.iterate({
        enter: (node) => {
            if (node.name === 'Comment' || node.name === 'DoctypeDecl' || node.name === 'ProcessingInst') {
                addItem({ from: node.from, to: node.to, kind: 'box', name: '', isBlock: true, isOpening: false }, Decoration.replace({
                    widget: new BoxWidget(boxLabel(state, node.name, node.from, node.to)),
                }));

                return false;
            }

            if (node.name === 'MismatchedCloseTag') {
                addItem({ from: node.from, to: node.to, kind: 'tag', name: '', isBlock: false, isOpening: false }, HIDDEN);

                return false;
            }

            if (node.name === 'EntityReference' || node.name === 'CharacterReference') {
                addItem({ from: node.from, to: node.to, kind: 'entity', name: '', isBlock: false, isOpening: false }, Decoration.replace({
                    widget: new TextWidget(decodeHtmlText(state.sliceDoc(node.from, node.to)), 'cm-html-entity'),
                }));

                return false;
            }

            if (TAG_NODES.has(node.name)) {
                return false;
            }

            if (node.name === 'Text') {
                if (preDepth === 0) {
                    hideIndentation(state, node.from, node.to, addItem);
                }

                return false;
            }

            if (node.name !== 'Element') {
                return undefined;
            }

            const element = htmlElementOf(state, node.node);

            if (element == null) {
                return undefined;
            }

            if (BOXED_ELEMENTS.has(element.name) || element.name.includes('-')) {
                addItem(
                    { from: element.from, to: element.to, kind: 'box', name: element.name, isBlock: true, isOpening: false },
                    Decoration.replace({ widget: new BoxWidget(`<${element.name}>`) }),
                );

                return false;
            }

            decorateElement(state, element, ranges, addItem, addTag);

            if (element.name === 'pre') {
                preDepth += 1;
            }

            return undefined;
        },
        leave: (node) => {
            if (node.name === 'Element' && htmlElementOf(state, node.node)?.name === 'pre') {
                preDepth -= 1;
            }
        },
    });

    items.sort((left, right) => left.from - right.from);
    const atomic = items.map((item) => HIDDEN.range(item.from, item.to));

    for (const start of structureLineStarts(state, items)) {
        ranges.push(STRUCTURE_LINE.range(start));
    }

    return {
        items,
        decorations: Decoration.set(ranges, true),
        atomic: Decoration.set(atomic, true),
    };
}

// The lines that hold nothing but hidden tags and indentation,
// such as `<ul>` or `</body>` on a line of its own,
// which the view draws short, so the page doesn't read as rows of blank lines.
function structureLineStarts(state: EditorState, items: ReadonlyArray<HtmlItem>): number[] {
    const hidden = items.filter((item) => item.kind === 'tag' || item.kind === 'indent');
    const starts: number[] = [];
    let first = 0;

    for (let number = 1; number <= state.doc.lines; number += 1) {
        const line = state.doc.line(number);

        while (first < hidden.length && (hidden[first]?.to ?? 0) <= line.from && (hidden[first]?.from ?? 0) < line.from) {
            first += 1;
        }

        let position = line.from;

        for (let index = first; index < hidden.length && position < line.to; index += 1) {
            const item = hidden[index];

            if (item == null || item.from > position) {
                break;
            }

            position = Math.max(position, item.to);
        }

        if (line.length > 0 && position >= line.to) {
            starts.push(line.from);
        }
    }

    return starts;
}

function decorateElement(
    state: EditorState,
    element: HtmlElement,
    ranges: Array<Range<Decoration>>,
    addItem: (item: HtmlItem, decoration: Decoration) => void,
    addTag: (element: HtmlElement, from: number, to: number, isOpening: boolean) => void,
): void {
    const isBlock = HTML_BLOCKS.has(element.name);

    if (element.name === 'img') {
        const image = new ImageWidget(attributeValue(state, element, 'src') ?? '', attributeValue(state, element, 'alt') ?? '');
        addItem(
            { from: element.openFrom, to: element.openTo, kind: 'image', name: 'img', isBlock: false, isOpening: false },
            Decoration.replace({ widget: image }),
        );

        return;
    }

    if (element.name === 'hr') {
        addItem(
            { from: element.openFrom, to: element.openTo, kind: 'marker', name: 'hr', isBlock: true, isOpening: true },
            Decoration.replace({ widget: new InlineRuleWidget() }),
        );

        return;
    }

    const marker = markerText(state, element);

    if (marker == null) {
        addTag(element, element.openFrom, element.openTo, true);
    }
    else {
        addItem(
            { from: element.openFrom, to: element.openTo, kind: 'marker', name: element.name, isBlock, isOpening: true },
            Decoration.replace({ widget: new TextWidget(marker, 'cm-live-marker cm-html-marker') }),
        );
    }

    if (element.closeFrom != null && element.closeTo != null) {
        addTag(element, element.closeFrom, element.closeTo, false);
    }

    if (element.contentTo <= element.contentFrom) {
        return;
    }

    const style = INLINE_STYLES.get(element.name);
    const level = HEADING_LEVELS.get(element.name);

    if (style != null) {
        ranges.push(Decoration.mark({ class: style }).range(element.contentFrom, element.contentTo));
    }

    if (level != null) {
        const heading = Decoration.mark({ class: 'cm-html-heading', attributes: { 'data-level': String(level) } });
        ranges.push(heading.range(element.contentFrom, element.contentTo));
    }

    if (element.name === 'a') {
        const href = attributeValue(state, element, 'href') ?? '';
        const link = Decoration.mark({ class: 'cm-live-link', attributes: href === '' ? {} : { title: href } });
        ranges.push(link.range(element.contentFrom, element.contentTo));
    }

    const line = LINE_STYLES.get(element.name);

    if (line != null) {
        for (let position = element.contentFrom; position <= element.contentTo;) {
            const current = state.doc.lineAt(position);
            ranges.push(line.range(current.from));
            position = current.to + 1;
        }
    }
}

// The number an `<ol>` item shows: the list's `start`,
// counted on from the nearest earlier item with a `value`,
// and counted down in a `reversed` list.
function listItemNumber(state: EditorState, item: HtmlElement, list: HtmlElement): number {
    const ownValue = Number.parseInt(attributeValue(state, item, 'value') ?? '', 10);

    if (!Number.isNaN(ownValue)) {
        return ownValue;
    }

    const isReversed = attributeValue(state, list, 'reversed') != null;
    const step = isReversed ? -1 : 1;
    let offset = 0;

    for (let sibling = item.node.prevSibling; sibling != null; sibling = sibling.prevSibling) {
        const earlier = sibling.name === 'Element' ? htmlElementOf(state, sibling) : null;

        if (earlier?.name !== 'li') {
            continue;
        }

        offset += 1;
        const value = Number.parseInt(attributeValue(state, earlier, 'value') ?? '', 10);

        if (!Number.isNaN(value)) {
            return value + offset * step;
        }
    }

    const start = Number.parseInt(attributeValue(state, list, 'start') ?? '', 10);

    return (Number.isNaN(start) ? (isReversed ? countItems(state, list) : 1) : start) + offset * step;
}

function countItems(state: EditorState, list: HtmlElement): number {
    let count = 0;

    for (let child = list.node.firstChild; child != null; child = child.nextSibling) {
        if (child.name === 'Element' && htmlElementOf(state, child)?.name === 'li') {
            count += 1;
        }
    }

    return count;
}

// A list item's bullet or number, or the edge between table cells; null for an element with no marker.
function markerText(state: EditorState, element: HtmlElement): string | null {
    const parent = element.node.parent;
    const parentElement = parent == null ? null : htmlElementOf(state, parent);

    if (element.name === 'li') {
        if (parentElement?.name !== 'ol') {
            return '•';
        }

        return `${listItemNumber(state, element, parentElement)}.`;
    }

    if (element.name === 'td' || element.name === 'th') {
        for (let sibling = element.node.prevSibling; sibling != null; sibling = sibling.prevSibling) {
            if (sibling.name === 'Element') {
                return '│';
            }
        }
    }

    return null;
}

// Hides the white space that starts each line of the text, which only indents the source.
function hideIndentation(
    state: EditorState,
    from: number,
    to: number,
    addItem: (item: HtmlItem, decoration: Decoration) => void,
): void {
    const text = state.sliceDoc(from, to);

    for (let index = 0; index < text.length;) {
        const atLineStart = index === 0 ? state.doc.lineAt(from).from === from : text.charAt(index - 1) === '\n';
        let end = index;

        while (atLineStart && end < text.length && (text.charAt(end) === ' ' || text.charAt(end) === '\t')) {
            end += 1;
        }

        if (end > index) {
            addItem({ from: from + index, to: from + end, kind: 'indent', name: '', isBlock: false, isOpening: false }, HIDDEN);
        }

        const next = text.indexOf('\n', end);

        if (next < 0) {
            break;
        }

        index = next + 1;
    }
}

function boxLabel(state: EditorState, nodeName: string, from: number, to: number): string {
    if (nodeName === 'Comment') {
        return '<!-- comment -->';
    }

    const text = state.sliceDoc(from, to).replace(/\s+/g, ' ');

    return text.length > MAX_BOX_LABEL ? `${text.slice(0, MAX_BOX_LABEL - 2)}…>` : text;
}

export const htmlLiveField = StateField.define<HtmlLiveValue>({
    create: (state) => {
        const tree = syntaxTree(state);

        return { tree, ...scanHtml(state, tree) };
    },
    update: (value, transaction) => {
        const tree = syntaxTree(transaction.state);

        if (!transaction.docChanged && tree === value.tree) {
            return value;
        }

        return { tree, ...scanHtml(transaction.state, tree) };
    },
    provide: (field) => [
        EditorView.decorations.from(field, (value) => value.decorations),
        atomicRangesOf(field),
    ],
});

// The view's items, in order; empty when the view isn't the HTML Interactive view.
export function htmlItems(state: EditorState): ReadonlyArray<HtmlItem> {
    return state.field(htmlLiveField, false)?.items ?? [];
}
