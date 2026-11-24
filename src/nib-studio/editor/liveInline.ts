import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { StateField, type EditorState, type TransactionSpec } from '@codemirror/state';
import { Decoration, WidgetType, type EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { h } from '../app/dom.js';
import { liveStructure, normalizeLabel, regionAt, type BlockStructure } from './liveBlocks.js';
import { InlineRuleWidget, LiveImageWidget } from './liveDecorations.js';
import { HIDDEN, type CaretSide, type LiveItem } from './liveItems.js';

// Decorates one syntax node; returns whether its children get decorated too.
type NodeDecorator = (scan: InlineScan, node: SyntaxNode) => boolean;

// An empty pair of markers with the caret between them, as Ctrl+B leaves with nothing selected:
// hidden while the caret stays, so the next character typed is formatted.
export interface PendingPair {
    readonly position: number;
    readonly marker: string;
}

const LINK_PARENTS = new Set(['Link', 'Image', 'Autolink', 'LinkReference']);
const LIST_NODES = new Set(['BulletList', 'OrderedList']);
const PAIR_MARKERS = ['***', '**', '*', '~~', '__', '_', '``', '`'];
const LIST_GAP = /^[ \t]+/;

const LINK_MARK = Decoration.mark({ class: 'cm-live-link' });
const INLINE_CODE_MARK = Decoration.mark({ class: 'cm-live-code' });
const TASK_DONE_MARK = Decoration.mark({ class: 'cm-live-task-done' });
const REFERENCE_MARK = Decoration.mark({ class: 'cm-live-reference' });
const QUOTE_LINE = Decoration.line({ class: 'cm-live-quote' });
const HEADING_LINES = new Map([1, 2, 3, 4, 5, 6].map((level) => [level, Decoration.line({
    class: 'cm-live-heading',
    attributes: { 'data-level': String(level) },
})]));

class InlineScan {
    readonly items: LiveItem[] = [];
    private readonly seen = new Set<string>();

    constructor(readonly state: EditorState, readonly structure: BlockStructure | null) {}

    // Nested nodes can ask for the same decoration, such as the line style of a quote inside a quote;
    // it is added once.
    add(from: number, to: number, decoration: Decoration, side?: CaretSide): void {
        const widget = decoration.spec.widget as WidgetType | undefined;
        const key = `${from}:${to}:${decoration.spec.class ?? ''}:${widget?.constructor.name ?? ''}:${decoration === HIDDEN}`;

        if (this.seen.has(key)) {
            return;
        }

        this.seen.add(key);
        this.items.push(side == null ? { from, to, decoration } : { from, to, decoration, side });
    }

    // Hides the text, unless that would take out a line break.
    hide(from: number, to: number, side: CaretSide): void {
        if (to > from && this.state.doc.lineAt(from).number === this.state.doc.lineAt(to).number) {
            this.add(from, to, HIDDEN, side);
        }
    }

    line(position: number, decoration: Decoration): void {
        this.add(position, position, decoration);
    }

    isInFrontMatter(position: number): boolean {
        const frontMatter = this.structure?.frontMatter;

        return frontMatter != null && position <= frontMatter.to;
    }
}

// The inline decorations between `from` and `to`: hidden syntax, widgets, marks and line styles.
export function scanInline(state: EditorState, from: number, to: number): LiveItem[] {
    const scan = new InlineScan(state, liveStructure(state));

    syntaxTree(state).iterate({
        from,
        to,
        enter: (node) => {
            if (node.name !== 'Document' && scan.isInFrontMatter(node.from)) {
                return false;
            }

            const decorator = NODE_DECORATORS[node.name];

            return decorator == null ? true : decorator(scan, node.node);
        },
    });

    const pending = state.field(pendingPairField, false);

    if (pending != null && from <= pending.position && pending.position <= to) {
        const size = pending.marker.length;
        scan.add(pending.position - size, pending.position, HIDDEN, 'after');
        scan.add(pending.position, pending.position + size, HIDDEN, 'before');
    }

    return scan.items;
}

const NODE_DECORATORS: Readonly<Record<string, NodeDecorator>> = Object.freeze({
    ATXHeading1: (scan: InlineScan, node: SyntaxNode) => decorateAtxHeading(scan, node, 1),
    ATXHeading2: (scan: InlineScan, node: SyntaxNode) => decorateAtxHeading(scan, node, 2),
    ATXHeading3: (scan: InlineScan, node: SyntaxNode) => decorateAtxHeading(scan, node, 3),
    ATXHeading4: (scan: InlineScan, node: SyntaxNode) => decorateAtxHeading(scan, node, 4),
    ATXHeading5: (scan: InlineScan, node: SyntaxNode) => decorateAtxHeading(scan, node, 5),
    ATXHeading6: (scan: InlineScan, node: SyntaxNode) => decorateAtxHeading(scan, node, 6),
    StrongEmphasis: decorateInlineMarks,
    Emphasis: decorateInlineMarks,
    Strikethrough: decorateInlineMarks,
    InlineCode: decorateInlineCode,
    Link: decorateLink,
    Autolink: decorateAutolink,
    URL: decorateBareUrl,
    Image: decorateImage,
    Escape: decorateEscape,
    Blockquote: decorateBlockquote,
    QuoteMark: decorateQuoteMark,
    ListMark: decorateListMark,
    Paragraph: decorateParagraph,
    HorizontalRule: decorateNestedRule,
    LinkReference: decorateReferenceDefinition,
    FencedCode: () => false,
    CodeBlock: () => false,
    TableDelimiter: () => false,
    HTMLBlock: () => false,
    HTMLTag: () => false,
    CommentBlock: () => false,
    Comment: () => false,
    ProcessingInstructionBlock: () => false,
});

function headingLine(level: number): Decoration {
    return HEADING_LINES.get(level) ?? Decoration.line({ class: 'cm-live-heading' });
}

// The line start when only indentation comes before `position`, so the indentation hides with the marker;
// otherwise `position`, as after a quote marker, which hides its own space.
function leadingSpaceStart(state: EditorState, position: number): number {
    const line = state.doc.lineAt(position);

    return state.sliceDoc(line.from, position).trim() === '' ? line.from : position;
}

function spacesAfter(state: EditorState, position: number): number {
    const line = state.doc.lineAt(position);

    return LIST_GAP.exec(state.sliceDoc(position, line.to))?.[0].length ?? 0;
}

// The `#` marks hide with the space after them; a lone `#` with nothing after it stays text until a space follows.
function decorateAtxHeading(scan: InlineScan, node: SyntaxNode, level: number): boolean {
    const { state } = scan;
    const line = state.doc.lineAt(node.from);
    scan.line(line.from, headingLine(level));
    const marks = node.getChildren('HeaderMark');
    const opening = marks[0];
    const closing = marks.length > 1 ? marks.at(-1) : undefined;

    if (opening != null) {
        const gap = spacesAfter(state, opening.to);

        if (gap > 0) {
            scan.hide(leadingSpaceStart(state, opening.from), opening.to + gap, 'after');
        }
    }

    if (closing != null) {
        const before = state.sliceDoc(line.from, closing.from);
        scan.hide(line.from + before.trimEnd().length, closing.to, 'before');
    }

    return true;
}

// Bold, italic and strikethrough: the highlight style draws the text, and the markers hide.
function decorateInlineMarks(scan: InlineScan, node: SyntaxNode): boolean {
    hideChildren(scan, node, ['EmphasisMark', 'StrikethroughMark']);

    return true;
}

function decorateInlineCode(scan: InlineScan, node: SyntaxNode): boolean {
    scan.add(node.from, node.to, INLINE_CODE_MARK);
    hideChildren(scan, node, ['CodeMark']);

    return false;
}

function hideChildren(scan: InlineScan, node: SyntaxNode, markNames: ReadonlyArray<string>): void {
    for (const name of markNames) {
        for (const mark of node.getChildren(name)) {
            scan.hide(mark.from, mark.to, 'before');
        }
    }
}

export interface LinkParts {
    // The link text, between `[` and `]`.
    readonly textFrom: number;
    readonly textTo: number;
    // The address, from the link itself or from its reference definition.
    readonly url: string;
}

// The parts of a link node, or null for brackets that link nowhere, such as `[x]` with no definition.
export function linkParts(state: EditorState, node: SyntaxNode, structure: BlockStructure | null): LinkParts | null {
    const labelEnd = closingBracketOf(state, node);

    if (labelEnd == null) {
        return null;
    }

    const textFrom = node.from + 1;
    const textTo = labelEnd.from;
    const url = destinationOf(node, labelEnd);

    if (url != null) {
        return { textFrom, textTo, url: state.sliceDoc(url.from, url.to) };
    }

    if (state.sliceDoc(labelEnd.to, labelEnd.to + 1) === '(') {
        return { textFrom, textTo, url: '' };
    }

    // `[text][label]` looks up its label; `[text][]` and `[text]` look up their text.
    const label = node.getChild('LinkLabel');
    const labelKey = label == null ? '' : normalizeLabel(state.sliceDoc(label.from, label.to));
    const key = labelKey === '' ? normalizeLabel(state.sliceDoc(textFrom, textTo)) : labelKey;
    const referenced = key === '' ? undefined : structure?.references.get(key);

    return referenced == null ? null : { textFrom, textTo, url: referenced };
}

// The `]` that closes the text of a link or the alt text of an image.
function closingBracketOf(state: EditorState, node: SyntaxNode): SyntaxNode | undefined {
    return node.getChildren('LinkMark').find((mark) => state.sliceDoc(mark.from, mark.to) === ']');
}

// The address after the `]`.
// The text before it can hold an address of its own, as in `[https://a.example](https://b.example)`.
function destinationOf(node: SyntaxNode, labelEnd: SyntaxNode): SyntaxNode | undefined {
    return node.getChildren('URL').find((url) => url.from >= labelEnd.to);
}

// Shows the link text as a link with its address on hover; clicking it only places the caret.
function decorateLink(scan: InlineScan, node: SyntaxNode): boolean {
    const parts = linkParts(scan.state, node, scan.structure);

    if (parts == null) {
        return true;
    }

    if (parts.textTo > parts.textFrom) {
        scan.add(parts.textFrom, parts.textTo, linkMark(parts.url));
    }

    scan.hide(node.from, parts.textFrom, 'before');
    scan.hide(parts.textTo, node.to, 'after');

    return true;
}

function linkMark(url: string): Decoration {
    return url === '' ? LINK_MARK : Decoration.mark({ class: 'cm-live-link', attributes: { title: url } });
}

function decorateAutolink(scan: InlineScan, node: SyntaxNode): boolean {
    const url = node.getChild('URL');
    scan.add(node.from, node.to, linkMark(url == null ? '' : scan.state.sliceDoc(url.from, url.to)));
    scan.hide(node.from, node.from + 1, 'before');
    scan.hide(node.to - 1, node.to, 'after');

    return false;
}

function decorateBareUrl(scan: InlineScan, node: SyntaxNode): boolean {
    if (node.parent == null || !LINK_PARENTS.has(node.parent.name)) {
        scan.add(node.from, node.to, linkMark(scan.state.sliceDoc(node.from, node.to)));
    }

    return false;
}

function decorateImage(scan: InlineScan, node: SyntaxNode): boolean {
    const { state } = scan;
    const labelEnd = closingBracketOf(state, node);
    const url = labelEnd == null ? undefined : destinationOf(node, labelEnd);
    const source = url == null ? '' : state.sliceDoc(url.from, url.to);
    const alt = labelEnd == null ? '' : state.sliceDoc(node.from + 2, labelEnd.from);
    scan.add(node.from, node.to, Decoration.replace({ widget: new ImageWidget(source, alt, node.to - node.from) }), 'both');

    return false;
}

function decorateEscape(scan: InlineScan, node: SyntaxNode): boolean {
    scan.hide(node.from, node.from + 1, 'before');

    return false;
}

function decorateBlockquote(scan: InlineScan, node: SyntaxNode): boolean {
    const { state } = scan;
    const lastLine = state.doc.lineAt(node.to).number;

    for (let number = state.doc.lineAt(node.from).number; number <= lastLine; number++) {
        scan.line(state.doc.line(number).from, QUOTE_LINE);
    }

    return true;
}

function decorateQuoteMark(scan: InlineScan, node: SyntaxNode): boolean {
    const gap = Math.min(1, spacesAfter(scan.state, node.to));
    scan.hide(leadingSpaceStart(scan.state, node.from), node.to + gap, 'after');

    return false;
}

function listDepth(node: SyntaxNode): number {
    let depth = -1;

    for (let parent: SyntaxNode | null = node.parent; parent != null; parent = parent.parent) {
        if (LIST_NODES.has(parent.name)) {
            depth++;
        }
    }

    return Math.max(0, depth);
}

// A list item's line, or a continuation line of its text, which lines up with the text rather than the marker.
function listItemLine(depth: number, isContinuation = false): Decoration {
    const attributes: Record<string, string> = { style: `--list-depth: ${depth}` };

    if (isContinuation) {
        attributes['data-continued'] = 'true';
    }

    return Decoration.line({ class: 'cm-live-list-item', attributes });
}

// The number a numbered item shows: the list's first number plus the item's place, as the preview counts.
function itemNumber(state: EditorState, item: SyntaxNode): string {
    const mark = state.sliceDoc(item.firstChild?.from ?? item.from, item.firstChild?.to ?? item.from);
    const delimiter = mark.endsWith(')') ? ')' : '.';
    let first: SyntaxNode = item;
    let index = 0;

    for (let sibling = item.prevSibling; sibling != null; sibling = sibling.prevSibling) {
        if (sibling.name === 'ListItem') {
            first = sibling;
            index++;
        }
    }

    const firstMark = first.getChild('ListMark');
    const start = firstMark == null ? 1 : Number.parseInt(state.sliceDoc(firstMark.from, firstMark.to), 10);

    return `${(Number.isNaN(start) ? 1 : start) + index}${delimiter}`;
}

// A bullet shows as •, a number as the item's number, and a task's `- [ ]` as a checkbox.
// A marker with nothing after it stays text until a space follows, so typing `-` or `1.` doesn't jump.
function decorateListMark(scan: InlineScan, node: SyntaxNode): boolean {
    const { state } = scan;
    const item = node.parent;
    const gap = spacesAfter(state, node.to);

    if (item == null || gap === 0) {
        return false;
    }

    const depth = listDepth(node);
    const start = leadingSpaceStart(state, node.from);
    scan.line(state.doc.lineAt(node.from).from, listItemLine(depth));
    const taskMarker = item.getChild('Task')?.getChild('TaskMarker');

    if (taskMarker != null) {
        const isChecked = state.sliceDoc(taskMarker.from + 1, taskMarker.from + 2).toLowerCase() === 'x';
        const task = taskMarker.parent;
        const taskGap = spacesAfter(state, taskMarker.to);

        if (isChecked && task != null && taskMarker.to + taskGap < task.to) {
            scan.add(taskMarker.to + taskGap, task.to, TASK_DONE_MARK);
        }

        scan.add(start, taskMarker.to + Math.min(1, taskGap), Decoration.replace({ widget: new CheckboxWidget(isChecked) }), 'after');

        return false;
    }

    const widget = item.parent?.name === 'OrderedList' ? new NumberWidget(itemNumber(state, item)) : new BulletWidget();
    scan.add(start, node.to + Math.min(1, gap), Decoration.replace({ widget }), 'after');

    return false;
}

// Continuation lines of a list item line up under its text, their indentation hidden.
function decorateParagraph(scan: InlineScan, node: SyntaxNode): boolean {
    if (node.parent?.name !== 'ListItem') {
        return true;
    }

    const { state } = scan;
    const firstLine = state.doc.lineAt(node.from).number;
    const lastLine = state.doc.lineAt(node.to).number;
    const decoration = listItemLine(listDepth(node.parent.firstChild ?? node), true);

    for (let number = firstLine + 1; number <= lastLine; number++) {
        const line = state.doc.line(number);
        const indent = /^[ \t]*/.exec(line.text)?.[0].length ?? 0;
        scan.line(line.from, decoration);
        scan.hide(line.from, line.from + indent, 'after');
    }

    return true;
}

// A rule inside a quote or list item; a rule on a line of its own is drawn by the block structure.
function decorateNestedRule(scan: InlineScan, node: SyntaxNode): boolean {
    if (regionAt(scan.state, node.from)?.kind !== 'rule') {
        scan.add(node.from, node.to, Decoration.replace({ widget: new InlineRuleWidget() }), 'both');
    }

    return false;
}

// `[label]: address "title"` shows as `label → address`, with the title on hover.
function decorateReferenceDefinition(scan: InlineScan, node: SyntaxNode): boolean {
    const { state } = scan;
    const label = node.getChild('LinkLabel');
    const url = node.getChild('URL');

    if (label == null || url == null) {
        return false;
    }

    const title = node.getChild('LinkTitle');
    scan.hide(label.from, label.from + 1, 'after');
    scan.add(label.to - 1, url.from, Decoration.replace({ widget: new ArrowWidget() }), 'after');
    scan.add(url.from, url.to, title == null
        ? REFERENCE_MARK
        : Decoration.mark({ class: 'cm-live-reference', attributes: { title: state.sliceDoc(title.from + 1, title.to - 1) } }));

    if (title != null) {
        scan.hide(url.to, title.to, 'before');
    }

    return false;
}

// The empty pair of markers around a lone caret, such as `**|**`, or null.
function emptyPairAt(state: EditorState, position: number): PendingPair | null {
    for (const marker of PAIR_MARKERS) {
        const size = marker.length;

        if (
            state.sliceDoc(position - size, position) === marker
            && state.sliceDoc(position, position + size) === marker
            && state.sliceDoc(position - size - 1, position - size) !== marker[0]
            && state.sliceDoc(position + size, position + size + 1) !== marker[0]
        ) {
            return { position, marker };
        }
    }

    return null;
}

// The pair a formatting action left around the caret, kept until the caret moves or text is typed into it.
export const pendingPairField = StateField.define<PendingPair | null>({
    create: () => null,
    update: (value, transaction) => {
        const { state } = transaction;
        const main = state.selection.main;

        if (transaction.isUserEvent('input.format')) {
            return main.empty ? emptyPairAt(state, main.head) : null;
        }

        if (value == null) {
            return null;
        }

        const position = transaction.changes.mapPos(value.position, -1);
        const stillEmpty = emptyPairAt(state, position)?.marker === value.marker;

        return stillEmpty && main.empty && main.head === position ? { position, marker: value.marker } : null;
    },
});

// Ticks or clears the task on the line at `position`, as one undo step; null when the line has no task.
export function toggleTaskAt(state: EditorState, position: number): TransactionSpec | null {
    const line = state.doc.lineAt(position);
    const markers: Array<{ from: number; to: number }> = [];

    syntaxTree(state).iterate({
        from: line.from,
        to: line.to,
        enter: (node) => {
            if (node.name === 'TaskMarker' && node.from >= position) {
                markers.push({ from: node.from, to: node.to });
            }
        },
    });

    const found = markers[0];

    if (found == null) {
        return null;
    }

    const isChecked = state.sliceDoc(found.from + 1, found.from + 2).toLowerCase() === 'x';

    return {
        changes: { from: found.from + 1, to: found.from + 2, insert: isChecked ? ' ' : 'x' },
        annotations: isolateHistory.of('full'),
        userEvent: 'input.toggle',
    };
}

class ImageWidget extends LiveImageWidget {
    constructor(source: string, alt: string, readonly length: number) {
        super(source, alt);
    }

    override eq(other: ImageWidget): boolean {
        return super.eq(other) && other.length === this.length;
    }

    override toDOM(view: EditorView): HTMLElement {
        const element = super.toDOM(view);
        // Clicking an image selects it, so Delete removes it and copying copies it.
        element.addEventListener('mousedown', (event) => {
            event.preventDefault();
            const from = view.posAtDOM(element);
            view.dispatch({ selection: { anchor: from, head: from + this.length }, userEvent: 'select.pointer' });
            view.focus();
        });

        return element;
    }
}

class CheckboxWidget extends WidgetType {
    constructor(readonly isChecked: boolean) {
        super();
    }

    override eq(other: CheckboxWidget): boolean {
        return other.isChecked === this.isChecked;
    }

    toDOM(view: EditorView): HTMLElement {
        const box = h('input', {
            class: 'cm-live-task',
            attrs: {
                type: 'checkbox',
                tabindex: -1,
                'aria-label': this.isChecked ? 'Done task' : 'Open task',
            },
        });
        box.checked = this.isChecked;
        // Keeps focus and the selection in the editor.
        box.addEventListener('mousedown', (event) => event.preventDefault());
        box.addEventListener('click', (event) => {
            event.preventDefault();

            if (view.state.readOnly) {
                return;
            }

            const spec = toggleTaskAt(view.state, view.posAtDOM(box));

            if (spec != null) {
                view.dispatch(spec);
            }
        });

        return h('span', { class: 'cm-live-marker', children: [box] });
    }
}

class BulletWidget extends WidgetType {
    override eq(): boolean {
        return true;
    }

    toDOM(): HTMLElement {
        return h('span', { class: 'cm-live-marker', children: [h('span', { class: 'cm-live-bullet', text: '•' })] });
    }
}

class NumberWidget extends WidgetType {
    constructor(readonly label: string) {
        super();
    }

    override eq(other: NumberWidget): boolean {
        return other.label === this.label;
    }

    toDOM(): HTMLElement {
        return h('span', { class: 'cm-live-marker', children: [h('span', { class: 'cm-live-number', text: this.label })] });
    }
}

class ArrowWidget extends WidgetType {
    override eq(): boolean {
        return true;
    }

    toDOM(): HTMLElement {
        return h('span', { class: 'cm-live-reference-arrow', text: ' → ' });
    }
}
