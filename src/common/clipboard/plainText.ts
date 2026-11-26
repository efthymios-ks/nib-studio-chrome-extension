// Elements that make a paragraph of their own, set apart from what is around them by a blank line.
const PARAGRAPH_TAGS = new Set([
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote', 'table', 'ul', 'ol', 'dl', 'figure', 'hr', 'details',
]);

// Elements that start and end a line of their own.
const LINE_TAGS = new Set([
    'div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'address', 'li', 'tr', 'dt', 'dd',
    'figcaption', 'caption', 'summary', 'thead', 'tbody', 'tfoot', 'center', 'fieldset', 'legend', 'form',
]);

// Elements whose text never shows on the page.
const UNSHOWN_TAGS = new Set([
    'script', 'style', 'template', 'noscript', 'head', 'title', 'meta', 'link', 'button', 'select', 'textarea',
    'input', 'iframe', 'object', 'embed', 'svg', 'math', 'canvas', 'audio', 'video',
]);

// Elements whose own white space, between their rows, cells or items, never shows.
const STRUCTURE_TAGS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup', 'ul', 'ol', 'dl']);

const LIST_INDENT = '  ';

// The text of a rendered document as it reads, for the plain text that goes with formatted content on the clipboard:
// paragraphs and headings set apart by a blank line, list items on lines of their own with `-` or their number,
// table rows one per line with their cells tab-separated, and preformatted text as written.
export function htmlToPlainText(root: ParentNode): string {
    const writer = new TextWriter();
    writeChildren(root, writer, { preformatted: false, listDepth: 0 });

    return writer.finish();
}

interface WalkContext {
    readonly preformatted: boolean;
    readonly listDepth: number;
}

function writeChildren(parent: ParentNode, writer: TextWriter, context: WalkContext): void {
    const isStructure = parent instanceof Element && STRUCTURE_TAGS.has(parent.localName);

    for (const node of parent.childNodes) {
        if (node.nodeType === 3) {
            if (!isStructure) {
                writer.text(node.textContent ?? '', context.preformatted);
            }

            continue;
        }

        if (node.nodeType === 1) {
            writeElement(node as Element, writer, context);
        }
    }
}

function writeElement(element: Element, writer: TextWriter, context: WalkContext): void {
    const tag = element.localName;

    if (UNSHOWN_TAGS.has(tag) || element.hasAttribute('hidden')) {
        return;
    }

    if (tag === 'br') {
        writer.lineBreak();

        return;
    }

    if (tag === 'li') {
        writeListItem(element, writer, context);

        return;
    }

    if (tag === 'td' || tag === 'th') {
        writeCell(element, writer);

        return;
    }

    const isList = tag === 'ul' || tag === 'ol';
    const breaks = blockBreaks(tag, isList && context.listDepth > 0);
    const inner: WalkContext = {
        preformatted: context.preformatted || tag === 'pre',
        listDepth: isList ? context.listDepth + 1 : context.listDepth,
    };
    writer.separate(breaks);
    writeChildren(element, writer, inner);
    writer.separate(breaks);
}

// How many line breaks set an element apart: two for a paragraph, one for a line, none for inline text.
// A list inside a list item is one more line of it.
function blockBreaks(tag: string, isNestedList: boolean): number {
    if (isNestedList) {
        return 1;
    }

    if (PARAGRAPH_TAGS.has(tag)) {
        return 2;
    }

    return LINE_TAGS.has(tag) ? 1 : 0;
}

// A cell keeps to its row: the paragraphs and lines in it join with a space, and a tab parts it from the cell before.
function writeCell(cell: Element, writer: TextWriter): void {
    const content = new TextWriter();
    writeChildren(cell, content, { preformatted: false, listDepth: 0 });

    if (cell.previousElementSibling != null) {
        writer.raw('\t');
    }

    writer.raw(content.finish().replace(/\s*\n\s*/g, ' '));
}

function writeListItem(item: Element, writer: TextWriter, context: WalkContext): void {
    const list = item.parentElement;
    const isOrdered = list?.localName === 'ol';
    const siblings = list == null ? [item] : [...list.children].filter((child) => child.localName === 'li');
    const start = Number.parseInt(list?.getAttribute('start') ?? '1', 10);
    const number = (Number.isFinite(start) ? start : 1) + siblings.indexOf(item);
    const marker = isOrdered ? `${number}. ` : '- ';
    writer.separate(1);
    writer.raw(LIST_INDENT.repeat(Math.max(0, context.listDepth - 1)) + marker);
    writeChildren(item, writer, context);
    writer.separate(1);
}

// Builds the text a piece at a time: runs of white space fold to one space outside preformatted text,
// and line breaks between blocks are added only once text follows them.
class TextWriter {
    private readonly parts: string[] = [];
    private pendingBreaks = 0;
    private atLineStart = true;
    private endsWithSpace = false;

    text(value: string, preformatted: boolean): void {
        if (preformatted) {
            this.put(value);

            return;
        }

        const folded = value.replace(/[ \t\n\r\f]+/g, ' ');
        const trimmed = this.atLineStart || this.endsWithSpace || this.pendingBreaks > 0 ? folded.replace(/^ /, '') : folded;

        if (trimmed !== '') {
            this.put(trimmed);
        }
    }

    // Text that goes in as it is, such as a list item's marker or the tab between two cells.
    raw(value: string): void {
        this.put(value);
    }

    // A `<br>`: a line break even with no text after it yet.
    lineBreak(): void {
        this.flushBreaks();
        this.parts.push('\n');
        this.atLineStart = true;
        this.endsWithSpace = false;
    }

    // Asks for at least this many line breaks before the next text.
    separate(breaks: number): void {
        if (breaks > 0 && this.parts.length > 0) {
            this.pendingBreaks = Math.max(this.pendingBreaks, breaks);
        }
    }

    finish(): string {
        return this.parts
            .join('')
            .split('\n')
            .map((line) => line.replace(/ +$/, ''))
            .join('\n')
            .replace(/^\n+|\n+$/g, '');
    }

    private put(value: string): void {
        if (value === '') {
            return;
        }

        this.flushBreaks();
        this.parts.push(value);
        this.atLineStart = value.endsWith('\n');
        this.endsWithSpace = value.endsWith(' ');
    }

    // Writes the line breaks asked for, less those the text already ends with, such as a code block's last one.
    private flushBreaks(): void {
        const wanted = this.pendingBreaks;
        this.pendingBreaks = 0;

        if (wanted === 0 || this.parts.length === 0) {
            return;
        }

        const written = trailingBreaks(this.parts);

        if (wanted > written) {
            this.parts.push('\n'.repeat(wanted - written));
        }

        this.atLineStart = true;
        this.endsWithSpace = false;
    }
}

function trailingBreaks(parts: ReadonlyArray<string>): number {
    let count = 0;

    for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index] ?? '';
        const match = /\n*$/.exec(part)?.[0].length ?? 0;
        count += match;

        if (match < part.length) {
            break;
        }
    }

    return count;
}
