import { escapeHtmlAttribute, escapeHtmlText } from '../html/escapeHtml.js';
import type { XmlNode } from './xmlParser.js';

// Formats JSON values and XML nodes as coloured tokens on indented lines, for query results.
// `formatted` indents with two spaces like `JSON.stringify(value, null, 2)`; `compact` puts everything on one line.
export type ValueLayout = 'formatted' | 'compact';

export type ValueTokenKind =
    | 'key'
    | 'string'
    | 'number'
    | 'boolean'
    | 'null'
    | 'punct'
    | 'tag'
    | 'attribute'
    | 'attribute-value'
    | 'text';

export interface ValueToken {
    readonly kind: ValueTokenKind;
    readonly text: string;
}

export interface ValueLine {
    // Indent steps of two spaces.
    readonly depth: number;
    readonly tokens: ReadonlyArray<ValueToken>;
}

export interface FormatLimits {
    // Stops after this many lines.
    readonly maxLines?: number;
    // Cuts a longer line short and ends it with `…`.
    readonly maxLineLength?: number;
}

export interface FormattedValue {
    readonly lines: ReadonlyArray<ValueLine>;
    // False when a limit cut the value short.
    readonly isComplete: boolean;
}

export type JsonValueKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

const INDENT = '  ';
const ELLIPSIS = '…';

export function formatJsonValue(value: unknown, layout: ValueLayout, limits: FormatLimits = {}): FormattedValue {
    const writer = new LineWriter(layout, limits);
    writeJson(writer, value, 0);

    return writer.finish();
}

// The text a formatted JSON value shows, the same as `JSON.stringify`.
export function jsonValueText(value: unknown, layout: ValueLayout): string {
    return JSON.stringify(value, null, layout === 'formatted' ? 2 : undefined) ?? 'null';
}

export function jsonValueKind(value: unknown): JsonValueKind {
    if (Array.isArray(value)) {
        return 'array';
    }

    if (value === null || value === undefined) {
        return 'null';
    }

    if (typeof value === 'object') {
        return 'object';
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return typeof value as JsonValueKind;
    }

    return 'null';
}

// The type of a value, with the number of keys or items of an object or array, such as `array · 3 items`.
export function describeJsonValue(value: unknown): string {
    const kind = jsonValueKind(value);

    if (kind === 'array') {
        return `array · ${countLabel((value as unknown[]).length, 'item')}`;
    }

    if (kind === 'object') {
        return `object · ${countLabel(Object.keys(value as object).length, 'key')}`;
    }

    return kind;
}

export function countJsonLines(value: unknown, layout: ValueLayout): number {
    if (layout === 'compact') {
        return 1;
    }

    const children = jsonChildren(value);

    if (children == null || children.length === 0) {
        return 1;
    }

    return children.reduce<number>((total, child) => total + countJsonLines(child, layout), 2);
}

// An element with its attributes, text and children; the `#document` node formats its root element.
export function formatXmlNode(node: XmlNode, layout: ValueLayout, limits: FormatLimits = {}): FormattedValue {
    const writer = new LineWriter(layout, limits);
    writeXmlNode(writer, node, 0);

    return writer.finish();
}

export function formatXmlAttribute(name: string, value: string, limits: FormatLimits = {}): FormattedValue {
    const writer = new LineWriter('compact', limits);
    writeAttribute(writer, name, value);

    return writer.finish();
}

// Text as it reads, unescaped, without its leading and trailing whitespace;
// `formatted` keeps one trimmed line per line of text.
export function formatXmlText(text: string, layout: ValueLayout, limits: FormatLimits = {}): FormattedValue {
    const writer = new LineWriter(layout, limits);
    textLines(text, layout).forEach((line, index) => {
        if (index > 0) {
            writer.newline(0);
        }

        writer.write('text', line);
    });

    return writer.finish();
}

export function countXmlLines(node: XmlNode, layout: ValueLayout): number {
    if (layout === 'compact') {
        return 1;
    }

    if (node.name === DOCUMENT_NAME) {
        return node.children.reduce((total, child) => total + countXmlLines(child, layout), 0);
    }

    const text = textLines(node.text, layout);

    if (node.children.length === 0 && text.length <= 1) {
        return 1;
    }

    return node.children.reduce((total, child) => total + countXmlLines(child, layout), 2 + text.length);
}

export function countXmlTextLines(text: string, layout: ValueLayout): number {
    return Math.max(1, textLines(text, layout).length);
}

export function valueLinesToText(lines: ReadonlyArray<ValueLine>): string {
    return lines
        .map((line) => INDENT.repeat(line.depth) + line.tokens.map((token) => token.text).join(''))
        .join('\n');
}

const DOCUMENT_NAME = '#document';

class LineWriter {
    private readonly lines: ValueLine[] = [];
    private tokens: ValueToken[] = [];
    private depth = 0;
    private length = 0;
    private isLineCut = false;
    private isStopped = false;
    private isCut = false;

    constructor(private readonly layout: ValueLayout, private readonly limits: FormatLimits) {}

    // True once a limit means nothing more will be written.
    get stopped(): boolean {
        return this.isStopped;
    }

    isCompact(): boolean {
        return this.layout === 'compact';
    }

    write(kind: ValueTokenKind, text: string): void {
        if (this.isStopped || this.isLineCut) {
            return;
        }

        const maxLength = this.limits.maxLineLength;

        if (maxLength != null && this.length + text.length > maxLength) {
            const room = Math.max(0, maxLength - this.length);

            if (room > 0) {
                this.tokens.push({ kind, text: text.slice(0, room) });
            }

            this.tokens.push({ kind: 'punct', text: ELLIPSIS });
            this.isLineCut = true;
            this.isCut = true;
            // A compact value is one line, so nothing after the cut shows.
            this.isStopped = this.layout === 'compact';

            return;
        }

        this.tokens.push({ kind, text });
        this.length += text.length;
    }

    // Starts a line at this depth; in the compact layout lines run on.
    newline(depth: number): void {
        if (this.isStopped || this.layout === 'compact') {
            return;
        }

        this.lines.push({ depth: this.depth, tokens: this.tokens });

        if (this.limits.maxLines != null && this.lines.length >= this.limits.maxLines) {
            this.isStopped = true;
            this.isCut = true;

            return;
        }

        this.tokens = [];
        this.depth = depth;
        this.length = depth * INDENT.length;
        this.isLineCut = false;
    }

    finish(): FormattedValue {
        if (!this.isStopped || this.layout === 'compact') {
            this.lines.push({ depth: this.depth, tokens: this.tokens });
        }

        return { lines: this.lines, isComplete: !this.isCut };
    }
}

function writeJson(writer: LineWriter, value: unknown, depth: number): void {
    if (writer.stopped) {
        return;
    }

    if (Array.isArray(value)) {
        writeJsonContainer(writer, depth, ['[', ']'], value.map((item) => ({ key: null, value: item })));

        return;
    }

    if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value).map(([key, item]) => ({ key, value: item as unknown }));
        writeJsonContainer(writer, depth, ['{', '}'], entries);

        return;
    }

    writeJsonPrimitive(writer, value);
}

function writeJsonContainer(
    writer: LineWriter,
    depth: number,
    brackets: readonly [string, string],
    entries: ReadonlyArray<{ readonly key: string | null; readonly value: unknown }>,
): void {
    const [open, close] = brackets;

    if (entries.length === 0) {
        writer.write('punct', `${open}${close}`);

        return;
    }

    writer.write('punct', open);

    entries.forEach((entry, index) => {
        if (writer.stopped) {
            return;
        }

        writer.newline(depth + 1);

        if (entry.key != null) {
            writer.write('key', JSON.stringify(entry.key));
            writer.write('punct', writer.isCompact() ? ':' : ': ');
        }

        writeJson(writer, entry.value, depth + 1);

        if (index < entries.length - 1) {
            writer.write('punct', ',');
        }
    });

    writer.newline(depth);
    writer.write('punct', close);
}

function writeJsonPrimitive(writer: LineWriter, value: unknown): void {
    if (typeof value === 'string') {
        writer.write('string', JSON.stringify(value));

        return;
    }

    if (typeof value === 'number') {
        writer.write(Number.isFinite(value) ? 'number' : 'null', Number.isFinite(value) ? String(value) : 'null');

        return;
    }

    if (typeof value === 'boolean') {
        writer.write('boolean', String(value));

        return;
    }

    writer.write('null', 'null');
}

function jsonChildren(value: unknown): unknown[] | null {
    if (Array.isArray(value)) {
        return value;
    }

    if (value !== null && typeof value === 'object') {
        return Object.values(value);
    }

    return null;
}

function writeXmlNode(writer: LineWriter, node: XmlNode, depth: number): void {
    if (node.name !== DOCUMENT_NAME) {
        writeXmlElement(writer, node, depth);

        return;
    }

    node.children.forEach((child, index) => {
        if (index > 0) {
            writer.newline(depth);
        }

        writeXmlElement(writer, child, depth);
    });
}

function writeXmlElement(writer: LineWriter, node: XmlNode, depth: number): void {
    if (writer.stopped) {
        return;
    }

    writer.write('punct', '<');
    writer.write('tag', node.name);

    for (const [name, value] of Object.entries(node.attributes)) {
        writer.write('punct', ' ');
        writeAttribute(writer, name, value);
    }

    const text = textLines(node.text, writer.isCompact() ? 'compact' : 'formatted');

    if (node.children.length === 0 && text.length === 0) {
        writer.write('punct', '/>');

        return;
    }

    writer.write('punct', '>');

    if (node.children.length === 0 && text.length === 1) {
        writer.write('text', escapeHtmlText(text[0] ?? ''));
        writeClosingTag(writer, node.name);

        return;
    }

    for (const line of text) {
        writer.newline(depth + 1);
        writer.write('text', escapeHtmlText(line));
    }

    for (const child of node.children) {
        if (writer.stopped) {
            return;
        }

        writer.newline(depth + 1);
        writeXmlElement(writer, child, depth + 1);
    }

    writer.newline(depth);
    writeClosingTag(writer, node.name);
}

function writeClosingTag(writer: LineWriter, name: string): void {
    writer.write('punct', '</');
    writer.write('tag', name);
    writer.write('punct', '>');
}

function writeAttribute(writer: LineWriter, name: string, value: string): void {
    writer.write('attribute', name);
    writer.write('punct', '="');
    writer.write('attribute-value', escapeHtmlAttribute(value));
    writer.write('punct', '"');
}

// The non-blank lines of a text, trimmed; the compact layout joins them with single spaces.
function textLines(text: string, layout: ValueLayout): string[] {
    const trimmed = text.trim();

    if (trimmed === '') {
        return [];
    }

    if (layout === 'compact') {
        return [trimmed.replace(/\s+/g, ' ')];
    }

    return trimmed
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '');
}

// `1 item`, `2 items`, `1,240 items`; nouns that don't just take an `s`, such as `match`, give their plural.
export function countLabel(count: number, noun: string, plural = `${noun}s`): string {
    return `${count.toLocaleString('en-US')} ${count === 1 ? noun : plural}`;
}
