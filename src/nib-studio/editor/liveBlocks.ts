import { syntaxTree } from '@codemirror/language';
import { RangeSet, StateField, type EditorState, type Extension, type Line, type Range } from '@codemirror/state';
import {
    BlockWrapper,
    Decoration,
    EditorView,
    WidgetType,
    type DecorationSet,
} from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';
import { h } from '../app/dom.js';
import { renderMermaidIntoAsync } from '../views/mermaidBridge.js';
import { atomicRangesOf } from './liveDecorations.js';
import { atomicItems, hiddenItem, type CaretSide, type LiveItem } from './liveItems.js';
import { findTables, type MarkdownTable } from './markdownTables.js';

// Blocks drawn as a box whose first and last lines are part of the box and never shown as text.
export type LiveRegionKind = 'code' | 'mermaid' | 'indentedCode' | 'frontMatter' | 'rule';

export interface LiveRegion {
    readonly kind: LiveRegionKind;
    // From the start of the first line to the end of the last line.
    readonly from: number;
    readonly to: number;
    // The editable lines, from the start of the first to the end of the last; null when the block has none.
    readonly content: { readonly from: number; readonly to: number } | null;
    // The code block's language, as written after the opening fence.
    readonly language: string;
    // The text of the editable lines, such as a diagram's source.
    readonly source: string;
    readonly isClosed: boolean;
}

// A setext heading: text lines over an `===` or `---` underline, which is hidden.
export interface SetextHeading {
    readonly from: number;
    // The end of the last text line, where the hidden underline starts.
    readonly textTo: number;
    readonly to: number;
    readonly level: number;
}

export interface BlockStructure {
    readonly regions: ReadonlyArray<LiveRegion>;
    readonly tables: ReadonlyArray<MarkdownTable>;
    readonly setextHeadings: ReadonlyArray<SetextHeading>;
    // Link reference definitions by lower-case label, to their address.
    readonly references: ReadonlyMap<string, string>;
    readonly frontMatter: LiveRegion | null;
}

interface BlockFieldValue {
    readonly tree: Tree;
    readonly structure: BlockStructure;
    // The diagrams the selection is in, which show their source and a live drawing.
    readonly editedDiagrams: ReadonlyArray<number>;
    readonly decorations: DecorationSet;
    readonly cellMarks: DecorationSet;
    readonly wrappers: RangeSet<BlockWrapper>;
    readonly atomic: DecorationSet;
    // The hidden ranges the caret steps over, sorted.
    readonly items: ReadonlyArray<LiveItem>;
}

// Fired on the language label of a code block; the docked editor bar opens its language menu under the label.
export const CODE_LANGUAGE_MENU_EVENT = 'live-code-language';

export interface CodeLanguageMenuDetail {
    readonly anchor: HTMLElement;
}

const MERMAID_INFO = 'mermaid';
const CONTAINER_BLOCKS = new Set(['Document', 'Blockquote', 'BulletList', 'OrderedList', 'ListItem']);
const FRONT_MATTER_FENCE = '---';
const FRONT_MATTER_CLOSERS = new Set(['---', '...']);
const FRONT_MATTER_MAX_LINES = 400;
const DIAGRAM_HEIGHT = 240;
const DIAGRAM_MARGIN = 8;
const DIAGRAM_RENDER_DELAY_MS = 300;
const MIN_COLUMN_WEIGHT = 3;
const MAX_COLUMN_WEIGHT = 40;

const CODE_LINE = Decoration.line({ class: 'cm-live-code-block' });
const DIAGRAM_SOURCE_LINE = Decoration.line({ class: 'cm-live-code-block', attributes: { 'data-diagram': 'true' } });
const FRONT_MATTER_LINE = Decoration.line({ class: 'cm-live-front-matter-line' });
const TABLE_ROW_LINE = Decoration.line({ class: 'cm-live-table-row' });
const TABLE_HEADER_LINE = Decoration.line({ class: 'cm-live-table-row', attributes: { 'data-header': 'true' } });
const SETEXT_LINES = new Map([1, 2].map((level) => [level, Decoration.line({
    class: 'cm-live-heading',
    attributes: { 'data-level': String(level) },
})]));

let nextDiagramId = 0;

export function liveBlocks(): Extension {
    return blockField;
}

export function liveStructure(state: EditorState): BlockStructure | null {
    return state.field(blockField, false)?.structure ?? null;
}

// The hidden ranges the block structure adds, such as a table's pipes, sorted.
export function blockItems(state: EditorState): ReadonlyArray<LiveItem> {
    return state.field(blockField, false)?.items ?? [];
}

// The box-drawn block around the position, its edges included.
export function regionAt(state: EditorState, position: number): LiveRegion | null {
    const structure = liveStructure(state);

    if (structure == null) {
        return null;
    }

    const inFrontMatter = structure.frontMatter != null
        && structure.frontMatter.from <= position
        && position <= structure.frontMatter.to;

    if (inFrontMatter) {
        return structure.frontMatter;
    }

    return structure.regions.find((region) => region.from <= position && position <= region.to) ?? null;
}

// The diagrams drawn in place of their source for the current selection.
export function renderedDiagrams(state: EditorState): ReadonlyArray<LiveRegion> {
    const value = state.field(blockField, false);

    if (value == null) {
        return [];
    }

    return value.structure.regions.filter((region) => region.kind === 'mermaid' && !value.editedDiagrams.includes(region.from));
}

function findBlockStructure(state: EditorState, tree: Tree = syntaxTree(state)): BlockStructure {
    const frontMatter = findFrontMatter(state);
    const frontMatterEnd = frontMatter?.to ?? -1;
    const regions: LiveRegion[] = [];
    const setextHeadings: SetextHeading[] = [];
    const references = new Map<string, string>();

    tree.iterate({
        enter: (node) => {
            if (node.from <= frontMatterEnd && node.name !== 'Document') {
                return false;
            }

            if (node.name === 'FencedCode') {
                regions.push(fencedRegion(state, node.node));

                return false;
            }

            if (node.name === 'CodeBlock') {
                regions.push(indentedRegion(state, node.from, node.to));

                return false;
            }

            if (node.name === 'HorizontalRule') {
                const line = state.doc.lineAt(node.from);

                if (line.text.trim() === state.sliceDoc(node.from, node.to).trim()) {
                    regions.push(ruleRegion(line));
                }

                return false;
            }

            if (node.name === 'SetextHeading1' || node.name === 'SetextHeading2') {
                const heading = setextHeading(state, node.node, node.name === 'SetextHeading1' ? 1 : 2);

                if (heading != null) {
                    setextHeadings.push(heading);
                }

                return false;
            }

            if (node.name === 'LinkReference') {
                addReference(state, node.node, references);

                return false;
            }

            return CONTAINER_BLOCKS.has(node.name);
        },
    });

    const tables = findTables(state, tree).filter((table) => table.from > frontMatterEnd);

    return { regions, tables, setextHeadings, references, frontMatter };
}

// YAML front matter: `---` on the first line, closed by `---` or `...` on a line of its own.
function findFrontMatter(state: EditorState): LiveRegion | null {
    const { doc } = state;

    if (doc.lines < 2 || doc.line(1).text.trimEnd() !== FRONT_MATTER_FENCE) {
        return null;
    }

    const lastLine = Math.min(doc.lines, FRONT_MATTER_MAX_LINES);

    for (let number = 2; number <= lastLine; number++) {
        const line = doc.line(number);

        if (FRONT_MATTER_CLOSERS.has(line.text.trimEnd())) {
            const content = number > 2 ? { from: doc.line(2).from, to: doc.line(number - 1).to } : null;

            return {
                kind: 'frontMatter',
                from: 0,
                to: line.to,
                content,
                language: 'yaml',
                source: content == null ? '' : state.sliceDoc(content.from, content.to),
                isClosed: true,
            };
        }
    }

    return null;
}

function fencedRegion(state: EditorState, node: SyntaxNode): LiveRegion {
    const opening = state.doc.lineAt(node.from);
    const last = state.doc.lineAt(node.to);
    const marks = node.getChildren('CodeMark');
    const isClosed = marks.length >= 2 && last.number > opening.number;
    const info = node.getChild('CodeInfo');
    const language = info == null ? '' : state.sliceDoc(info.from, info.to).trim();
    const lastContentNumber = isClosed ? last.number - 1 : last.number;
    const content = lastContentNumber > opening.number
        ? { from: state.doc.line(opening.number + 1).from, to: state.doc.line(lastContentNumber).to }
        : null;
    const isMermaid = isClosed && language.toLowerCase() === MERMAID_INFO;
    const text = node.getChild('CodeText');

    return {
        kind: isMermaid ? 'mermaid' : 'code',
        from: opening.from,
        to: last.to,
        content,
        language,
        source: text == null ? '' : state.sliceDoc(text.from, text.to),
        isClosed,
    };
}

function indentedRegion(state: EditorState, from: number, to: number): LiveRegion {
    const first = state.doc.lineAt(from);
    const last = state.doc.lineAt(to);

    return {
        kind: 'indentedCode',
        from: first.from,
        to: last.to,
        content: { from: first.from, to: last.to },
        language: '',
        source: state.sliceDoc(first.from, last.to),
        isClosed: true,
    };
}

function ruleRegion(line: Line): LiveRegion {
    return { kind: 'rule', from: line.from, to: line.to, content: null, language: '', source: '', isClosed: true };
}

function setextHeading(state: EditorState, node: SyntaxNode, level: number): SetextHeading | null {
    const underline = node.getChild('HeaderMark');

    if (underline == null) {
        return null;
    }

    const underlineLine = state.doc.lineAt(underline.from);

    if (underlineLine.number < 2) {
        return null;
    }

    return {
        from: state.doc.lineAt(node.from).from,
        textTo: state.doc.line(underlineLine.number - 1).to,
        to: underlineLine.to,
        level,
    };
}

function addReference(state: EditorState, node: SyntaxNode, references: Map<string, string>): void {
    const label = node.getChild('LinkLabel');
    const url = node.getChild('URL');

    if (label == null || url == null) {
        return;
    }

    const key = normalizeLabel(state.sliceDoc(label.from, label.to));

    if (!references.has(key)) {
        references.set(key, state.sliceDoc(url.from, url.to));
    }
}

// `[Label]` and `label` both become `label`, as reference labels match without case.
export function normalizeLabel(label: string): string {
    return label.replace(/^\[|\]$/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function selectionTouches(state: EditorState, from: number, to: number): boolean {
    return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

function editedDiagramsOf(state: EditorState, structure: BlockStructure): number[] {
    return structure.regions
        .filter((region) => region.kind === 'mermaid' && selectionTouches(state, region.from, region.to))
        .map((region) => region.from);
}

function sameNumbers(left: ReadonlyArray<number>, right: ReadonlyArray<number>): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

interface BlockDecorations {
    readonly decorations: DecorationSet;
    readonly cellMarks: DecorationSet;
    readonly wrappers: RangeSet<BlockWrapper>;
    readonly atomic: DecorationSet;
    readonly items: ReadonlyArray<LiveItem>;
}

class BlockBuilder {
    readonly decorations: Range<Decoration>[] = [];
    readonly cellMarks: Range<Decoration>[] = [];
    readonly wrappers: Range<BlockWrapper>[] = [];
    readonly atomic: Range<Decoration>[] = [];
    readonly items: LiveItem[] = [];

    constructor(readonly state: EditorState) {}

    replace(from: number, to: number, decoration: Decoration): void {
        this.decorations.push(decoration.range(from, to));
        this.atomic.push(decoration.range(from, to));
    }

    hide(from: number, to: number, side: CaretSide): void {
        if (to <= from) {
            return;
        }

        const item = hiddenItem(from, to, side);
        this.items.push(item);
        this.replace(from, to, item.decoration);
    }

    line(position: number, decoration: Decoration): void {
        this.decorations.push(decoration.range(position));
    }

    wrap(from: number, to: number, attributes: Record<string, string>): void {
        this.wrappers.push(BlockWrapper.create({ tagName: 'div', attributes }).range(from, to));
    }

    build(): BlockDecorations {
        return {
            decorations: Decoration.set(this.decorations, true),
            cellMarks: Decoration.set(this.cellMarks, true),
            wrappers: BlockWrapper.set(this.wrappers, true),
            atomic: Decoration.set(this.atomic, true),
            items: atomicItems(this.items),
        };
    }
}

function buildBlockDecorations(state: EditorState, structure: BlockStructure, edited: ReadonlyArray<number>): BlockDecorations {
    const builder = new BlockBuilder(state);

    if (structure.frontMatter != null) {
        decorateFrontMatter(builder, structure.frontMatter);
    }

    for (const region of structure.regions) {
        decorateRegion(builder, region, edited.includes(region.from));
    }

    for (const heading of structure.setextHeadings) {
        decorateSetext(builder, heading);
    }

    for (const table of structure.tables) {
        decorateTable(builder, table);
    }

    return builder.build();
}

function decorateFrontMatter(builder: BlockBuilder, region: LiveRegion): void {
    const { doc } = builder.state;
    const opening = doc.lineAt(region.from);
    const closing = doc.lineAt(region.to);
    builder.wrap(region.from, region.to, { class: 'cm-live-front-matter' });
    builder.replace(opening.from, opening.to, Decoration.replace({ widget: new BoxEdgeWidget('start', 'Front matter'), block: true }));
    builder.replace(closing.from, closing.to, Decoration.replace({ widget: new BoxEdgeWidget('end', ''), block: true }));
    decorateContentLines(builder, region, FRONT_MATTER_LINE, 0);
}

function decorateRegion(builder: BlockBuilder, region: LiveRegion, isEdited: boolean): void {
    const { doc } = builder.state;

    if (region.kind === 'rule') {
        builder.replace(region.from, region.to, Decoration.replace({ widget: new RuleWidget(), block: true }));

        return;
    }

    if (region.kind === 'mermaid' && !isEdited) {
        builder.replace(region.from, region.to, Decoration.replace({ widget: new MermaidWidget(region.source), block: true }));

        return;
    }

    builder.wrap(region.from, region.to, { class: 'cm-live-code-box', 'data-kind': region.kind });

    if (region.kind === 'indentedCode') {
        decorateContentLines(builder, region, CODE_LINE, 4);

        return;
    }

    const opening = doc.lineAt(region.from);
    const indent = /^[ \t]*/.exec(opening.text)?.[0].length ?? 0;
    builder.replace(opening.from, opening.to, Decoration.replace({
        widget: new CodeStartWidget(region.language),
        block: true,
    }));
    decorateContentLines(builder, region, region.kind === 'mermaid' ? DIAGRAM_SOURCE_LINE : CODE_LINE, indent);

    if (region.isClosed) {
        const closing = doc.lineAt(region.to);
        const widget = region.kind === 'mermaid' ? new DiagramEditorWidget(region.source) : new BoxEdgeWidget('end', '');
        builder.replace(closing.from, closing.to, Decoration.replace({ widget, block: true }));
    }
}

// Styles the editable lines and hides the indentation they share with their fence, up to `indent` spaces.
function decorateContentLines(builder: BlockBuilder, region: LiveRegion, decoration: Decoration, indent: number): void {
    if (region.content == null) {
        return;
    }

    const { doc } = builder.state;
    const lastNumber = doc.lineAt(region.content.to).number;

    for (let number = doc.lineAt(region.content.from).number; number <= lastNumber; number++) {
        const line = doc.line(number);
        builder.line(line.from, decoration);

        if (indent > 0) {
            const leading = /^[ \t]*/.exec(line.text)?.[0].length ?? 0;
            builder.hide(line.from, line.from + Math.min(indent, leading), 'after');
        }
    }
}

function decorateSetext(builder: BlockBuilder, heading: SetextHeading): void {
    const { doc } = builder.state;
    const lineDecoration = SETEXT_LINES.get(heading.level)!;
    const lastText = doc.lineAt(heading.textTo).number;

    for (let number = doc.lineAt(heading.from).number; number <= lastText; number++) {
        builder.line(doc.line(number).from, lineDecoration);
    }

    builder.hide(heading.textTo, heading.to, 'before');
}

// Rows become a grid: pipes, padding and the delimiter row hide, and each cell is one flex item.
function decorateTable(builder: BlockBuilder, table: MarkdownTable): void {
    builder.wrap(table.from, table.to, { class: 'cm-live-table' });
    const weights = columnWeights(table);

    table.rows.forEach((row, rowIndex) => {
        builder.line(row.from, rowIndex === 0 ? TABLE_HEADER_LINE : TABLE_ROW_LINE);
        const firstDivider = row.dividers[0];

        if (row.hasLeadingPipe && firstDivider != null) {
            builder.hide(row.from, firstDivider.to, 'after');
        }
        else {
            builder.hide(row.from, row.from + row.indent.length, 'after');
        }

        for (const divider of row.dividers) {
            const isLeading = row.hasLeadingPipe && divider === firstDivider;
            const isTrailing = row.hasTrailingPipe && divider === row.dividers.at(-1);

            if (!isLeading && !isTrailing) {
                builder.hide(divider.from, divider.to, 'both');
            }
        }

        const lastDivider = row.dividers.at(-1);

        if (row.hasTrailingPipe && lastDivider != null) {
            builder.hide(lastDivider.from, row.to, 'before');
        }
        else {
            const lastCell = row.cells.at(-1);
            builder.hide(lastCell?.to ?? row.to, row.to, 'before');
        }

        row.cells.forEach((cell, column) => {
            if (cell.textTo > cell.textFrom) {
                builder.hide(cell.from, cell.textFrom, 'after');
                builder.hide(cell.textTo, cell.to, 'before');
            }

            const style = cellStyle(weights[column] ?? MIN_COLUMN_WEIGHT, table.alignments[column] ?? null);

            if (cell.to > cell.from) {
                builder.cellMarks.push(Decoration.mark({
                    class: 'cm-live-table-cell',
                    attributes: { style },
                }).range(cell.from, cell.to));
            }
            else {
                builder.decorations.push(Decoration.widget({ widget: new EmptyCellWidget(style), side: 1 }).range(cell.from));
            }
        });

        const missing = table.columnCount - row.cells.length;

        if (missing > 0) {
            const styles = weights.slice(row.cells.length).map((weight, offset) => cellStyle(
                weight,
                table.alignments[row.cells.length + offset] ?? null,
            ));
            builder.decorations.push(Decoration.widget({ widget: new FillerCellsWidget(styles), side: 1 }).range(row.to));
        }
    });

    const header = table.rows[0];

    if (header != null) {
        builder.hide(header.to, table.delimiterRow.to, 'before');
    }
}

// Columns share the width by their longest text, within bounds, so every row lines up.
function columnWeights(table: MarkdownTable): number[] {
    return Array.from({ length: table.columnCount }, (_, column) => {
        const longest = Math.max(0, ...table.rows.map((row) => {
            const cell = row.cells[column];

            return cell == null ? 0 : cell.textTo - cell.textFrom;
        }));

        return Math.min(MAX_COLUMN_WEIGHT, Math.max(MIN_COLUMN_WEIGHT, longest));
    });
}

function cellStyle(weight: number, alignment: string | null): string {
    return alignment == null ? `flex-grow: ${weight}` : `flex-grow: ${weight}; text-align: ${alignment}`;
}

function computeValue(state: EditorState, tree: Tree, structure: BlockStructure, edited: number[]): BlockFieldValue {
    return { tree, structure, editedDiagrams: edited, ...buildBlockDecorations(state, structure, edited) };
}

// Block widgets, wrappers and decorations that hide line breaks have to come from state, not from a view plugin.
const blockField = StateField.define<BlockFieldValue>({
    create: (state) => {
        const tree = syntaxTree(state);
        const structure = findBlockStructure(state, tree);

        return computeValue(state, tree, structure, editedDiagramsOf(state, structure));
    },
    update: (value, transaction) => {
        const tree = syntaxTree(transaction.state);
        const treeChanged = tree !== value.tree;

        if (!transaction.docChanged && !treeChanged && transaction.selection == null) {
            return value;
        }

        const structure = transaction.docChanged || treeChanged ? findBlockStructure(transaction.state, tree) : value.structure;
        const edited = editedDiagramsOf(transaction.state, structure);

        if (!transaction.docChanged && !treeChanged && sameNumbers(edited, value.editedDiagrams)) {
            return value;
        }

        return computeValue(transaction.state, tree, structure, edited);
    },
    provide: (field) => [
        EditorView.decorations.from(field, (value) => value.decorations),
        EditorView.outerDecorations.from(field, (value) => value.cellMarks),
        EditorView.blockWrappers.from(field, (value) => value.wrappers),
        atomicRangesOf(field),
    ],
});

// Puts the caret at the start of the block's editable lines.
function enterRegion(view: EditorView, element: HTMLElement): LiveRegion | null {
    const position = view.posAtDOM(element);
    const region = regionAt(view.state, position);

    if (region?.content == null) {
        return region;
    }

    view.dispatch({ selection: { anchor: region.content.from }, userEvent: 'select.pointer' });
    view.focus();

    return region;
}

// The top of a code box, with the language label in its corner; the label opens the language menu.
class CodeStartWidget extends WidgetType {
    constructor(readonly language: string) {
        super();
    }

    override eq(other: CodeStartWidget): boolean {
        return other.language === this.language;
    }

    toDOM(view: EditorView): HTMLElement {
        const label = h('button', {
            class: 'cm-live-code-language',
            text: this.language === '' ? 'Plain text' : this.language,
            attrs: {
                type: 'button',
                tabindex: -1,
                title: 'Change the language',
                'aria-haspopup': 'menu',
            },
        });
        label.addEventListener('mousedown', (event) => {
            event.preventDefault();
            enterRegion(view, label);
            label.dispatchEvent(new CustomEvent<CodeLanguageMenuDetail>(CODE_LANGUAGE_MENU_EVENT, {
                bubbles: true,
                detail: { anchor: label },
            }));
        });

        return h('div', { class: 'cm-live-code-start', children: [label] });
    }
}

type BoxEdge = 'start' | 'end';

class BoxEdgeWidget extends WidgetType {
    constructor(readonly edge: BoxEdge, readonly label: string) {
        super();
    }

    override eq(other: BoxEdgeWidget): boolean {
        return other.edge === this.edge && other.label === this.label;
    }

    toDOM(): HTMLElement {
        return h('div', {
            class: this.edge === 'start' ? 'cm-live-code-start' : 'cm-live-code-end',
            children: this.label === '' ? [] : [h('span', { class: 'cm-live-box-label', text: this.label })],
        });
    }
}

class RuleWidget extends WidgetType {
    override eq(): boolean {
        return true;
    }

    toDOM(): HTMLElement {
        return h('div', { class: 'cm-live-rule', attrs: { 'aria-hidden': 'true' } });
    }
}

class EmptyCellWidget extends WidgetType {
    constructor(readonly style: string) {
        super();
    }

    override eq(other: EmptyCellWidget): boolean {
        return other.style === this.style;
    }

    toDOM(): HTMLElement {
        return h('span', { class: 'cm-live-table-cell', attrs: { style: this.style } });
    }
}

// Cells a short row leaves out, drawn empty so the columns still line up.
class FillerCellsWidget extends WidgetType {
    constructor(readonly styles: ReadonlyArray<string>) {
        super();
    }

    override eq(other: FillerCellsWidget): boolean {
        return other.styles.join('|') === this.styles.join('|');
    }

    toDOM(): HTMLElement {
        const cells = this.styles.map((style) => h('span', {
            class: 'cm-live-table-cell',
            attrs: { style, 'data-filler': 'true' },
        }));

        return h('span', { class: 'cm-live-table-filler', children: cells });
    }
}

// A diagram drawn in place of its block while the caret is elsewhere; clicking it opens the source.
class MermaidWidget extends WidgetType {
    constructor(readonly source: string) {
        super();
    }

    override eq(other: MermaidWidget): boolean {
        return other.source === this.source;
    }

    override get estimatedHeight(): number {
        return DIAGRAM_HEIGHT;
    }

    toDOM(view: EditorView): HTMLElement {
        const placeholder = h('div', { class: 'md-mermaid' });
        const wrapper = h('div', {
            class: 'cm-live-mermaid',
            attrs: { title: 'Click to edit the diagram' },
            children: [placeholder],
        });
        wrapper.addEventListener('mousedown', (event) => {
            if ((event.target as Element | null)?.closest('button') != null) {
                return;
            }

            event.preventDefault();
            enterRegion(view, wrapper);
        });
        nextDiagramId += 1;
        void renderDiagramAsync(view, placeholder, this.source, `live-${nextDiagramId}`);

        return wrapper;
    }
}

async function renderDiagramAsync(view: EditorView, placeholder: HTMLElement, source: string, id: string): Promise<void> {
    await renderMermaidIntoAsync(placeholder, source, id);
    view.requestMeasure();
}

interface DiagramEditorState {
    timer: ReturnType<typeof setTimeout> | null;
    source: string;
}

const diagramEditors = new WeakMap<HTMLElement, DiagramEditorState>();

// The bottom of a diagram's code box while its source is edited: the diagram drawn live beside the source,
// or under it on narrow screens. It draws again a moment after the source stops changing.
class DiagramEditorWidget extends WidgetType {
    constructor(readonly source: string) {
        super();
    }

    override eq(other: DiagramEditorWidget): boolean {
        return other.source === this.source;
    }

    toDOM(view: EditorView): HTMLElement {
        const placeholder = h('div', { class: 'md-mermaid' });
        const panel = h('div', { class: 'cm-live-diagram-panel', children: [placeholder] });
        const spacer = h('div', { class: 'cm-live-diagram-spacer' });
        const element = h('div', { class: 'cm-live-code-end', attrs: { 'data-diagram': 'true' }, children: [panel, spacer] });
        diagramEditors.set(element, { timer: null, source: this.source });
        void this.drawAsync(view, element);

        return element;
    }

    override updateDOM(element: HTMLElement, view: EditorView): boolean {
        const editor = diagramEditors.get(element);

        if (editor == null) {
            return false;
        }

        editor.source = this.source;

        if (editor.timer != null) {
            clearTimeout(editor.timer);
        }

        editor.timer = setTimeout(() => {
            editor.timer = null;
            void this.drawAsync(view, element);
        }, DIAGRAM_RENDER_DELAY_MS);
        measureDiagramOverhang(view, element);

        return true;
    }

    override destroy(element: HTMLElement): void {
        const timer = diagramEditors.get(element)?.timer;

        if (timer != null) {
            clearTimeout(timer);
        }
    }

    private async drawAsync(view: EditorView, element: HTMLElement): Promise<void> {
        const editor = diagramEditors.get(element);
        const panel = element.querySelector<HTMLElement>('.cm-live-diagram-panel');

        if (editor == null || panel == null) {
            return;
        }

        // The old drawing stays until the new one is ready, so the panel doesn't flicker while typing.
        const placeholder = h('div', { class: 'md-mermaid' });
        nextDiagramId += 1;
        await renderMermaidIntoAsync(placeholder, editor.source, `live-edit-${nextDiagramId}`);

        if (!element.isConnected && panel.childElementCount > 0) {
            return;
        }

        panel.replaceChildren(placeholder);
        measureDiagramOverhang(view, element);
    }
}

// Beside the source, the diagram can reach below the box; the spacer under the source makes room for it.
export function measureDiagramOverhang(view: EditorView, element: HTMLElement): void {
    view.requestMeasure({
        key: element,
        read: () => {
            const box = element.closest('.cm-live-code-box');
            const panel = element.querySelector<HTMLElement>('.cm-live-diagram-panel');
            const spacer = element.querySelector<HTMLElement>('.cm-live-diagram-spacer');

            if (box == null || panel == null || spacer == null || getComputedStyle(panel).position !== 'absolute') {
                return 0;
            }

            const boxBottom = box.getBoundingClientRect().bottom - spacer.getBoundingClientRect().height;

            return Math.max(0, Math.ceil(panel.getBoundingClientRect().bottom + DIAGRAM_MARGIN - boxBottom));
        },
        write: (overhang) => {
            const spacer = element.querySelector<HTMLElement>('.cm-live-diagram-spacer');
            const height = `${overhang}px`;

            if (spacer != null && spacer.style.height !== height) {
                spacer.style.height = height;
                view.requestMeasure();
            }
        },
    });
}
