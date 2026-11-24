import { purifyHtml } from '../../common/html/purifyHtml.js';
import { LIST_ELEMENTS } from './htmlStructure.js';

interface InlineStyle {
    readonly bold: boolean;
    readonly italic: boolean;
    readonly strike: boolean;
}

type InlineConverter = (element: Element, style: InlineStyle) => string;

type BlockConverter = (element: Element) => string;

type Alignment = 'left' | 'center' | 'right' | null;

// Element contents that never belong in the Markdown, such as Word's style sheet.
const FORBIDDEN_TAGS = ['style', 'script', 'template', 'title', 'meta', 'link', 'head', 'noscript', 'iframe', 'object', 'embed'];

const BLOCK_TAGS = new Set([
    'address', 'article', 'aside', 'blockquote', 'center', 'dd', 'details', 'dialog', 'div', 'dl', 'dt', 'fieldset',
    'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li',
    'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'ul',
]);

const BLOCK_SELECTOR = [...BLOCK_TAGS].join(', ');

// Markup that carries formatting worth keeping; without any, the clipboard's plain text is pasted instead.
const FORMATTING_SELECTOR = [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 's', 'del', 'strike', 'a[href]', 'ul', 'ol',
    'blockquote', 'pre', 'code', 'table', 'img', 'hr', 'input[type="checkbox"]', '[style*="font-weight"]',
    '[style*="font-style"]', '[style*="line-through"]',
].join(', ');

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'ftp']);

const PLAIN: InlineStyle = { bold: false, italic: false, strike: false };
const CODE_TAGS = new Set(['code', 'kbd', 'samp', 'tt']);
const LANGUAGE_PATTERN = /(?:^|\s)(?:lang|language|highlight-source)-([\w#+-]+)/;
const LIST_MARKER_TEXT = /^\s*(?:\d+|[a-z]{1,4})[.)]\s*$/i;

// Converts clipboard HTML, such as a web page, Word or Google Docs selection, to Markdown.
// The HTML is sanitized and read in an inert document, so nothing in it runs or loads.
// Returns null when the HTML has no formatting to keep, or looks like a code editor's copy,
// so plain text is better.
export function htmlToMarkdown(html: string): string | null {
    const clean = purifyHtml(html, { FORBID_TAGS: FORBIDDEN_TAGS });
    const body = new DOMParser().parseFromString(clean, 'text/html').body;

    if (isCodeEditorCopy(body) || body.querySelector(FORMATTING_SELECTOR) == null) {
        return null;
    }

    nestWordLists(body);
    const markdown = convertBlocks(body, '\n\n')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return markdown === '' ? null : markdown;
}

// Code editors copy their text as styled lines with whitespace kept as is.
function isCodeEditorCopy(body: HTMLElement): boolean {
    const only = body.children.length === 1 ? body.firstElementChild : null;
    const style = only?.getAttribute('style') ?? '';

    return only != null && /white-space:\s*pre/i.test(style) && only.querySelector('pre, table, ul, ol, h1, h2, h3') == null;
}

function tagOf(node: Node): string {
    return node.nodeType === Node.ELEMENT_NODE ? (node as Element).tagName.toLowerCase() : '';
}

function isBlock(node: Node): boolean {
    return BLOCK_TAGS.has(tagOf(node));
}

// An inline wrapper around blocks, such as the <b> Google Docs puts around a whole selection,
// acts as a block.
function holdsBlocks(node: Node): boolean {
    return node.nodeType === Node.ELEMENT_NODE && (node as Element).querySelector(BLOCK_SELECTOR) != null;
}

// Converts the children of an element, gathering runs of inline content into paragraphs.
function convertBlocks(parent: Node, separator: string): string {
    const blocks: string[] = [];
    let inline: Node[] = [];

    const flush = (): void => {
        const paragraph = finishParagraph(inline.map((node) => convertInline(node, PLAIN)).join(''));

        if (paragraph !== '') {
            blocks.push(paragraph);
        }

        inline = [];
    };

    for (const child of [...parent.childNodes]) {
        if (!isBlock(child) && !holdsBlocks(child)) {
            inline.push(child);
            continue;
        }

        flush();
        const block = convertBlock(child as Element);

        if (block.trim() !== '') {
            blocks.push(block);
        }
    }

    flush();

    return blocks.join(separator);
}

const BLOCK_CONVERTERS: Readonly<Record<string, BlockConverter>> = Object.freeze({
    h1: (element: Element) => convertHeading(element, 1),
    h2: (element: Element) => convertHeading(element, 2),
    h3: (element: Element) => convertHeading(element, 3),
    h4: (element: Element) => convertHeading(element, 4),
    h5: (element: Element) => convertHeading(element, 5),
    h6: (element: Element) => convertHeading(element, 6),
    blockquote: (element: Element) => prefixLines(convertBlocks(element, '\n\n'), '> ', '>'),
    ul: convertList,
    ol: convertList,
    li: (element: Element) => convertListItem(element, '- '),
    pre: convertPre,
    table: convertTable,
    hr: () => '---',
});

function convertBlock(element: Element): string {
    const converter = BLOCK_CONVERTERS[tagOf(element)];

    return converter == null ? convertBlocks(element, '\n\n') : converter(element);
}

function convertHeading(element: Element, level: number): string {
    const text = collapseSpaces(convertChildrenInline(element, PLAIN).replace(/\\\n/g, ' ')).trim();

    return text === '' ? '' : `${'#'.repeat(level)} ${text}`;
}

function convertList(list: Element): string {
    const isOrdered = tagOf(list) === 'ol';
    const start = Number.parseInt(list.getAttribute('start') ?? '1', 10);
    const items: string[] = [];
    let number = Number.isNaN(start) ? 1 : start;
    let lastMarkerWidth = 2;

    for (const child of [...list.children]) {
        const tag = tagOf(child);

        // Google Docs puts a nested list straight inside its parent list.
        if (LIST_ELEMENTS.has(tag)) {
            const nested = indentLines(convertList(child), lastMarkerWidth);
            const last = items.pop();
            items.push(last == null ? nested : `${last}\n${nested}`);
            continue;
        }

        const marker = isOrdered ? `${number}. ` : '- ';
        items.push(convertListItem(child, marker));
        lastMarkerWidth = marker.length;
        number += 1;
    }

    return items.join('\n');
}

// One item; its paragraphs and nested lists sit under the marker, so the list stays tight.
function convertListItem(item: Element, marker: string): string {
    const checked = taskState(item);
    const lines = convertBlocks(item, '\n').replace(/\n{2,}/g, '\n').split('\n');
    const box = checked == null ? '' : `[${checked ? 'x' : ' '}] `;
    const rest = lines.slice(1).map((line) => (line === '' ? '' : `${' '.repeat(marker.length)}${line}`));

    return [`${marker}${box}${lines[0] ?? ''}`, ...rest].join('\n');
}

// Whether the item is a ticked task, an open task, or not a task (null), removing a leading checkbox.
function taskState(item: Element): boolean | null {
    const ariaChecked = item.getAttribute('aria-checked');

    if (item.getAttribute('role') === 'checkbox' && ariaChecked != null) {
        return ariaChecked === 'true';
    }

    const checkbox = item.querySelector('input[type="checkbox"]');

    if (checkbox == null || checkbox.closest('li') !== item || textBefore(item, checkbox).trim() !== '') {
        return null;
    }

    checkbox.remove();

    return checkbox.hasAttribute('checked');
}

// The text inside the container that comes before the target element.
function textBefore(container: Element, target: Element): string {
    const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let text = '';

    for (let node = walker.nextNode(); node != null && node !== target; node = walker.nextNode()) {
        if (node.nodeType === Node.TEXT_NODE) {
            text += (node as Text).data;
        }
    }

    return text;
}

function convertPre(pre: Element): string {
    for (const lineBreak of [...pre.querySelectorAll('br')]) {
        lineBreak.replaceWith(pre.ownerDocument.createTextNode('\n'));
    }

    const code = pre.textContent?.replace(/\n$/, '') ?? '';
    const classes = `${pre.className} ${pre.querySelector('code')?.className ?? ''} ${pre.parentElement?.className ?? ''}`;
    const language = LANGUAGE_PATTERN.exec(classes)?.[1] ?? '';
    const fence = '`'.repeat(Math.max(3, longestBacktickRun(code) + 1));

    return `${fence}${language}\n${code}\n${fence}`;
}

// A GitHub-flavoured table; its first row is the header, as that format needs one.
function convertTable(table: Element): string {
    const rowElements = [...table.querySelectorAll(':scope > tr, :scope > * > tr')];
    const cellsOf = (row: Element): Element[] => [...row.children].filter((cell) => ['td', 'th'].includes(tagOf(cell)));
    const spanOf = (cell: Element): number => {
        const span = Number.parseInt(cell.getAttribute('colspan') ?? '1', 10);

        return Number.isNaN(span) ? 1 : Math.max(1, span);
    };
    const rows = rowElements.map((row) => cellsOf(row).flatMap((cell) => [
        convertCell(cell),
        ...Array.from({ length: spanOf(cell) - 1 }, () => ''),
    ]));
    const header = rows[0];

    if (header == null) {
        return '';
    }

    const width = Math.max(...rows.map((row) => row.length));
    const alignments = cellsOf(rowElements[0]!).flatMap((cell) => {
        const alignment = cellAlignment(cell);

        return Array.from({ length: spanOf(cell) }, () => alignment);
    });
    const line = (cells: ReadonlyArray<string>): string => {
        const padded = Array.from({ length: width }, (_, index) => cells[index] ?? '');

        return `| ${padded.join(' | ')} |`;
    };
    const delimiter = Array.from({ length: width }, (_, index) => alignmentDelimiter(alignments[index] ?? null));

    return [line(header), `| ${delimiter.join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

function convertCell(cell: Element): string {
    return collapseSpaces(convertBlocks(cell, ' ').replace(/\\\n|\n/g, ' '))
        .trim()
        .replace(/(?<!\\)\|/g, '\\|');
}

function cellAlignment(cell: Element): Alignment {
    const value = (cell.getAttribute('align') ?? /text-align:\s*(\w+)/i.exec(cell.getAttribute('style') ?? '')?.[1] ?? '')
        .toLowerCase();

    if (value === 'center' || value === 'right' || value === 'left') {
        return value;
    }

    return null;
}

function alignmentDelimiter(alignment: Alignment): string {
    if (alignment === 'center') {
        return ':---:';
    }

    if (alignment === 'right') {
        return '---:';
    }

    return alignment === 'left' ? ':---' : '---';
}

const INLINE_CONVERTERS: Readonly<Record<string, InlineConverter>> = Object.freeze({
    br: () => '\\\n',
    a: convertLink,
    img: (element: Element) => convertImage(element),
    input: () => '',
    wbr: () => '',
});

function convertInline(node: Node, style: InlineStyle): string {
    if (node.nodeType === Node.TEXT_NODE) {
        return escapeText(normaliseSpaces((node as Text).data)).replace(/\u00a0/g, '&nbsp;');
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
        return '';
    }

    const element = node as Element;
    const tag = tagOf(element);
    const converter = INLINE_CONVERTERS[tag];

    if (converter != null) {
        return converter(element, style);
    }

    if (CODE_TAGS.has(tag) && element.closest('pre') == null) {
        return codeSpan(element.textContent ?? '');
    }

    if (isBlock(element)) {
        return ` ${convertBlocks(element, ' ')} `;
    }

    return convertStyled(element, style);
}

// Chrome copies the spaces beside formatting, and runs of spaces, as no-break spaces, which become plain spaces here.
// A no-break space between two words of one text, as in `10&nbsp;km`, was meant, and stays one.
function normaliseSpaces(text: string): string {
    const isWordAt = (index: number): boolean => /\S/.test(text[index] ?? ' ');

    return text
        .replace(/\u00a0/g, (space, offset: number) => (isWordAt(offset - 1) && isWordAt(offset + 1) ? space : ' '))
        .replace(/[\t\n\r ]+/g, ' ');
}

function convertChildrenInline(element: Element, style: InlineStyle): string {
    return [...element.childNodes].map((child) => convertInline(child, style)).join('');
}

// Bold, italic and strikethrough,
// from tags such as <strong> or from inline styles as Google Docs writes them.
function convertStyled(element: Element, style: InlineStyle): string {
    const tag = tagOf(element);
    const css = element.getAttribute('style') ?? '';
    const weight = /font-weight:\s*([\w]+)/i.exec(css)?.[1]?.toLowerCase();
    const isBold = weight == null
        ? tag === 'strong' || tag === 'b'
        : weight === 'bold' || weight === 'bolder' || Number(weight) >= 600;
    const isItalic = tag === 'em' || tag === 'i' || /font-style:\s*(italic|oblique)/i.test(css);
    const isStrike = tag === 's' || tag === 'del' || tag === 'strike' || /text-decoration[\w-]*:[^;]*line-through/i.test(css);
    const inner: InlineStyle = {
        bold: style.bold || isBold,
        italic: style.italic || isItalic,
        strike: style.strike || isStrike,
    };
    let text = convertChildrenInline(element, inner);

    if (isStrike && !style.strike) {
        text = wrapInline(text, '~~');
    }

    if (isItalic && !style.italic) {
        text = wrapInline(text, '*');
    }

    if (isBold && !style.bold) {
        text = wrapInline(text, '**');
    }

    return text;
}

// Keeps spaces outside the markers, where Markdown needs them, and leaves empty runs unmarked.
function wrapInline(text: string, marker: string): string {
    const trimmed = text.trim();

    if (trimmed === '') {
        return text;
    }

    const leading = /^\s*/.exec(text)?.[0] ?? '';
    const trailing = /\s*$/.exec(text)?.[0] ?? '';

    return `${leading}${marker}${trimmed}${marker}${trailing}`;
}

function convertLink(element: Element, style: InlineStyle): string {
    const text = convertChildrenInline(element, style);
    const href = element.getAttribute('href')?.trim() ?? '';

    if (href === '' || href.startsWith('#') || text.trim() === '' || !isSafeUrl(href, false)) {
        return text;
    }

    return `[${text.trim()}](${destination(href)})`;
}

// A web image stays a Markdown image link that is never fetched; a `data:` image keeps its data.
function convertImage(element: Element): string {
    const source = element.getAttribute('src')?.trim() ?? '';

    if (source === '' || !isSafeUrl(source, true)) {
        return '';
    }

    const alt = escapeText((element.getAttribute('alt') ?? '').replace(/\s+/g, ' ').trim());

    return `![${alt}](${destination(source)})`;
}

// A relative address or one with a web, mail or phone scheme; for images also inline `data:` images.
// Checked as well as sanitized, so a `javascript:` address never reaches the Markdown.
function isSafeUrl(url: string, isImage: boolean): boolean {
    const compact = url.replace(/[\u0000- ]/g, '');
    const scheme = /^([a-z][a-z\d+.-]*):/i.exec(compact)?.[1]?.toLowerCase();

    if (scheme == null) {
        return true;
    }

    if (scheme === 'data') {
        return isImage && /^data:image\//i.test(compact);
    }

    return SAFE_SCHEMES.has(scheme);
}

function destination(url: string): string {
    return /[\s()<>]/.test(url) ? `<${url.replace(/</g, '%3C').replace(/>/g, '%3E')}>` : url;
}

function codeSpan(text: string): string {
    const code = text.replace(/[\r\n]+/g, ' ');

    if (code.trim() === '') {
        return code;
    }

    const fence = '`'.repeat(longestBacktickRun(code) + 1);
    const padding = code.startsWith('`') || code.endsWith('`') ? ' ' : '';

    return `${fence}${padding}${code}${padding}${fence}`;
}

// Escapes what Markdown would read as syntax; an underscore inside a word stays as is.
function escapeText(text: string): string {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/[*`[\]<]/g, (character) => `\\${character}`)
        .replace(/~{2,}/g, (run) => run.replace(/~/g, '\\~'))
        .replace(/&(?=#?\w+;)/g, '\\&')
        .replace(/_/g, (underscore, offset: number, whole: string) => {
            const isInsideWord = /[\p{L}\p{N}]/u.test(whole[offset - 1] ?? '') && /[\p{L}\p{N}]/u.test(whole[offset + 1] ?? '');

            return isInsideWord ? underscore : '\\_';
        });
}

const LINE_START_ESCAPES: ReadonlyArray<readonly [RegExp, string]> = [
    [/^(\s*)(#{1,6})(\s|$)/, '$1\\$2$3'],
    [/^(\s*)>/, '$1\\>'],
    [/^(\s*)([-+])(\s)/, '$1\\$2$3'],
    [/^(\s*)(\d+)([.)])(\s)/, '$1$2\\$3$4'],
    [/^(\s*)([=-])(\2*\s*)$/, '$1\\$2$3'],
];

// Escapes text that would start a heading, quote or list at the start of a line.
function finishParagraph(text: string): string {
    return collapseSpaces(text)
        .trim()
        .split('\n')
        .map((line) => LINE_START_ESCAPES.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), line.trimStart()))
        .join('\n');
}

function collapseSpaces(text: string): string {
    return text.replace(/ {2,}/g, ' ');
}

function prefixLines(text: string, prefix: string, emptyPrefix: string): string {
    return text
        .split('\n')
        .map((line) => (line === '' ? emptyPrefix : `${prefix}${line}`))
        .join('\n');
}

function indentLines(text: string, width: number): string {
    return text
        .split('\n')
        .map((line) => (line === '' ? '' : `${' '.repeat(width)}${line}`))
        .join('\n');
}

// The longest run of backticks in code, which a fence around it must be longer than.
function longestBacktickRun(code: string): number {
    return Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
}

// Word writes list items as paragraphs styled `mso-list`, with the marker in a span to ignore;
// they become real nested lists before conversion.
function nestWordLists(body: HTMLElement): void {
    const page = body.ownerDocument;
    const paragraphs = [...body.querySelectorAll('p')].filter((paragraph) => wordListLevel(paragraph) != null);
    const handled = new Set<Element>();

    for (const first of paragraphs) {
        if (handled.has(first)) {
            continue;
        }

        const group: Element[] = [];
        let current: Element | null = first;

        while (current != null && wordListLevel(current) != null) {
            group.push(current);
            handled.add(current);
            current = current.nextElementSibling;
        }

        const stack: Array<{ level: number; list: Element }> = [];
        let root: Element | null = null;

        for (const paragraph of group) {
            const level = wordListLevel(paragraph) ?? 1;
            const markers = [...paragraph.querySelectorAll('[style*="mso-list"]')]
                .filter((span) => /mso-list:\s*ignore/i.test(span.getAttribute('style') ?? ''));
            const isOrdered = LIST_MARKER_TEXT.test(markers.map((span) => span.textContent ?? '').join(''));
            markers.forEach((span) => span.remove());

            while (stack.length > 0 && (stack.at(-1)?.level ?? 0) > level) {
                stack.pop();
            }

            if (stack.length === 0 || (stack.at(-1)?.level ?? 0) < level) {
                const list = page.createElement(isOrdered ? 'ol' : 'ul');
                const parentItem = stack.at(-1)?.list.lastElementChild;

                if (parentItem == null) {
                    root ??= list;
                }
                else {
                    parentItem.append(list);
                }

                stack.push({ level, list });
            }

            const item = page.createElement('li');
            item.append(...paragraph.childNodes);
            stack.at(-1)?.list.append(item);
        }

        if (root != null) {
            group[0]?.before(root);
        }

        group.forEach((paragraph) => paragraph.remove());
    }
}

function wordListLevel(element: Element): number | null {
    if (tagOf(element) !== 'p') {
        return null;
    }

    const style = element.getAttribute('style') ?? '';

    if (!/mso-list:/i.test(style) || /mso-list:\s*ignore/i.test(style)) {
        return null;
    }

    const level = /level(\d+)/i.exec(style)?.[1];

    return level == null ? 1 : Number(level);
}
