import { escapeHtmlText } from '../../common/html/escapeHtml.js';
import { purifyHtml } from '../../common/html/purifyHtml.js';
import { CONVERTED_PAGE_GENERATOR, MERMAID_SOURCE_ATTRIBUTE } from '../../common/markdown/markdownToHtml.js';
import { LIST_ELEMENTS } from './htmlStructure.js';

interface InlineStyle {
    readonly bold: boolean;
    readonly italic: boolean;
    readonly strike: boolean;
}

// A paste keeps what reads as Markdown. A page converted whole also keeps its in-page links, link and image titles,
// table captions, line breaks in table cells and the simple HTML GitHub-flavoured Markdown allows, such as <details>.
interface ConversionMode {
    readonly isDocument: boolean;
}

type InlineConverter = (element: Element, style: InlineStyle, mode: ConversionMode) => string;

type BlockConverter = (element: Element, mode: ConversionMode) => string;

type Alignment = 'left' | 'center' | 'right' | null;

const PASTE: ConversionMode = Object.freeze({ isDocument: false });

const DOCUMENT: ConversionMode = Object.freeze({ isDocument: true });

// Element contents that never belong in the Markdown, such as Word's style sheet.
const FORBIDDEN_TAGS = ['style', 'script', 'template', 'title', 'meta', 'link', 'head', 'noscript', 'iframe', 'object', 'embed'];

// A page converted whole also leaves out its form controls and what it draws or plays, with their contents;
// the text around them, such as a form's labels, stays.
const DOCUMENT_FORBIDDEN_TAGS = [
    'button', 'select', 'textarea', 'datalist', 'output', 'progress', 'meter',
    'svg', 'math', 'canvas', 'video', 'audio',
];

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

// Inline HTML that GitHub-flavoured Markdown keeps, which a page converted whole keeps around its Markdown.
const KEPT_INLINE_TAGS = new Set(['sub', 'sup', 'kbd', 'mark', 'ins']);

const PLAIN: InlineStyle = { bold: false, italic: false, strike: false };
const CODE_TAGS = new Set(['code', 'kbd', 'samp', 'tt']);
const LANGUAGE_PATTERN = /(?:^|\s)(?:lang|language|highlight-source)-([\w#+-]+)/;
const LIST_MARKER_TEXT = /^\s*(?:\d+|[a-z]{1,4})[.)]\s*$/i;
// A list item whose text starts as a task's box does, which stays a task.
const TASK_TEXT = /^\\\[([ xX])\\\] /;
// A line that opens or closes a fenced code block, inside quotes and list items too.
const FENCE_LINE = /^[\s>]*(?:(?:[-*+]|\d+[.)])\s+)?(`{3,})/;

// Converts clipboard HTML, such as a web page, Word or Google Docs selection, to Markdown.
// The HTML is sanitised and read in an inert document, so nothing in it runs or loads.
// Returns null when the HTML has no formatting to keep, or looks like a code editor's copy,
// so plain text is better.
export function htmlToMarkdown(html: string): string | null {
    const clean = purifyHtml(html, { FORBID_TAGS: FORBIDDEN_TAGS });
    const body = new DOMParser().parseFromString(clean, 'text/html').body;

    if (isCodeEditorCopy(body) || body.querySelector(FORMATTING_SELECTOR) == null) {
        return null;
    }

    nestWordLists(body);
    const markdown = tidyMarkdown(convertBlocks(body, '\n\n', PASTE));

    return markdown === '' ? null : markdown;
}

// Converts a whole HTML page, such as an .html file, to Markdown that ends in a line break; a page with no text gives ''.
// The page is sanitised and read in an inert document, so nothing in it runs or loads: its head, scripts, styles,
// comments, event handlers and form controls are dropped. Its title heads the Markdown when the page has no <h1>.
export function htmlDocumentToMarkdown(html: string): string {
    const page = new DOMParser().parseFromString(html, 'text/html');
    unwrapDiagramSources(page.body);
    const clean = purifyHtml(page.body.innerHTML, {
        FORBID_TAGS: [...FORBIDDEN_TAGS, ...DOCUMENT_FORBIDDEN_TAGS],
        ADD_FORBID_CONTENTS: DOCUMENT_FORBIDDEN_TAGS,
    });
    const body = new DOMParser().parseFromString(clean, 'text/html').body;
    nestWordLists(body);
    const blocks = [titleHeading(page, body), convertBlocks(body, '\n\n', DOCUMENT)]
        .filter((block) => block !== '');
    const markdown = tidyMarkdown(blocks.join('\n\n'));

    return markdown === '' ? '' : `${markdown}\n`;
}

// A diagram whose picture carries its Mermaid source becomes a `<pre class="mermaid">` of that source,
// as the sanitiser drops an attribute holding `-->`, which most diagrams do.
function unwrapDiagramSources(body: HTMLElement): void {
    for (const holder of [...body.querySelectorAll(`[${MERMAID_SOURCE_ATTRIBUTE}]`)]) {
        const pre = body.ownerDocument.createElement('pre');
        pre.className = 'mermaid';
        pre.textContent = holder.getAttribute(MERMAID_SOURCE_ATTRIBUTE) ?? '';
        holder.replaceWith(pre);
    }
}

// The page's title as its top heading, for a page without an <h1>; none when the title repeats the first heading,
// or when Nib Studio wrote the page, whose title comes from its first heading or file name.
function titleHeading(page: Document, body: HTMLElement): string {
    const title = singleLine(page.querySelector('title')?.textContent ?? '');
    const generator = [...page.querySelectorAll('meta[name]')]
        .find((meta) => meta.getAttribute('name')?.toLowerCase() === 'generator')
        ?.getAttribute('content');
    const firstHeading = singleLine(body.querySelector('h1, h2, h3, h4, h5, h6')?.textContent ?? '');

    if (
        title === ''
        || body.querySelector('h1') != null
        || generator === CONVERTED_PAGE_GENERATOR
        || title === firstHeading
    ) {
        return '';
    }

    return `# ${escapeText(title)}`;
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
function convertBlocks(parent: Node, separator: string, mode: ConversionMode): string {
    const blocks: string[] = [];
    let inline: Node[] = [];

    const flush = (): void => {
        const paragraph = finishParagraph(inline.map((node) => convertInline(node, PLAIN, mode)).join(''));

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
        const block = convertBlock(child as Element, mode);

        if (block.trim() !== '') {
            blocks.push(block);
        }
    }

    flush();

    return blocks.join(separator);
}

const BLOCK_CONVERTERS: Readonly<Record<string, BlockConverter>> = Object.freeze({
    h1: (element: Element, mode: ConversionMode) => convertHeading(element, 1, mode),
    h2: (element: Element, mode: ConversionMode) => convertHeading(element, 2, mode),
    h3: (element: Element, mode: ConversionMode) => convertHeading(element, 3, mode),
    h4: (element: Element, mode: ConversionMode) => convertHeading(element, 4, mode),
    h5: (element: Element, mode: ConversionMode) => convertHeading(element, 5, mode),
    h6: (element: Element, mode: ConversionMode) => convertHeading(element, 6, mode),
    blockquote: convertQuote,
    ul: convertList,
    ol: convertList,
    li: (element: Element, mode: ConversionMode) => convertListItem(element, '- ', mode),
    pre: convertPre,
    table: convertTable,
    details: convertDetails,
    hr: () => '---',
});

function convertBlock(element: Element, mode: ConversionMode): string {
    const diagram = mermaidSource(element);

    if (diagram != null) {
        return fencedCode(diagram, 'mermaid');
    }

    const converter = BLOCK_CONVERTERS[tagOf(element)];

    return converter == null ? convertBlocks(element, '\n\n', mode) : converter(element, mode);
}

// A diagram's Mermaid source: the text of a `<pre class="mermaid">`, which Mermaid's own script draws on a web page,
// and which a diagram on a page Nib Studio wrote becomes.
function mermaidSource(element: Element): string | null {
    if (tagOf(element) !== 'pre' || !element.classList.contains('mermaid') || element.firstElementChild != null) {
        return null;
    }

    return dedent(element.textContent ?? '');
}

function convertQuote(quote: Element, mode: ConversionMode): string {
    return prefixLines(convertBlocks(quote, '\n\n', mode), '> ', '>');
}

function convertHeading(element: Element, level: number, mode: ConversionMode): string {
    const text = collapseSpaces(convertChildrenInline(element, PLAIN, mode).replace(/\\\n/g, ' ')).trim();

    return text === '' ? '' : `${'#'.repeat(level)} ${text}`;
}

function convertList(list: Element, mode: ConversionMode): string {
    const isOrdered = tagOf(list) === 'ol';
    const start = Number.parseInt(list.getAttribute('start') ?? '1', 10);
    const items: string[] = [];
    let number = Number.isNaN(start) ? 1 : start;
    let lastMarkerWidth = 2;

    for (const child of [...list.children]) {
        const tag = tagOf(child);

        // Google Docs puts a nested list straight inside its parent list.
        if (LIST_ELEMENTS.has(tag)) {
            const nested = indentLines(convertList(child, mode), lastMarkerWidth);
            const last = items.pop();
            items.push(last == null ? nested : `${last}\n${nested}`);
            continue;
        }

        const marker = isOrdered ? `${number}. ` : '- ';
        items.push(convertListItem(child, marker, mode));
        lastMarkerWidth = marker.length;
        number += 1;
    }

    return items.join('\n');
}

// One item; its paragraphs and nested lists sit under the marker, so the list stays tight.
function convertListItem(item: Element, marker: string, mode: ConversionMode): string {
    const checked = taskState(item);
    const lines = convertBlocks(item, '\n', mode).replace(/\n{2,}/g, '\n').split('\n');
    const box = checked == null ? '' : `[${checked ? 'x' : ' '}] `;
    // An item written as a task, whose box stayed text, as a page drawn from Markdown has it, stays a task.
    const first = checked == null ? (lines[0] ?? '').replace(TASK_TEXT, '[$1] ') : lines[0] ?? '';
    const rest = lines.slice(1).map((line) => (line === '' ? '' : `${' '.repeat(marker.length)}${line}`));

    return [`${marker}${box}${first}`, ...rest].join('\n');
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

    return fencedCode(code, language);
}

function fencedCode(code: string, language: string): string {
    const fence = '`'.repeat(Math.max(3, longestBacktickRun(code) + 1));

    return `${fence}${language}\n${code}\n${fence}`;
}

// A disclosure. GitHub-flavoured Markdown keeps it as HTML around Markdown, with its summary as text,
// so a page converted whole keeps it so; a paste keeps the text.
function convertDetails(details: Element, mode: ConversionMode): string {
    if (!mode.isDocument) {
        return convertBlocks(details, '\n\n', mode);
    }

    const summary = [...details.children].find((child) => tagOf(child) === 'summary');
    summary?.remove();
    const open = details.hasAttribute('open') ? ' open' : '';
    const summaryText = escapeHtmlText(singleLine(summary?.textContent ?? ''));
    const label = summary == null ? '' : `<summary>${summaryText}</summary>\n`;

    return `<details${open}>\n${label}\n${convertBlocks(details, '\n\n', mode)}\n\n</details>`;
}

// A GitHub-flavoured table; its first row is the header, as that format needs one.
function convertTable(table: Element, mode: ConversionMode): string {
    const rowElements = [...table.querySelectorAll(':scope > tr, :scope > * > tr')];
    const cellsOf = (row: Element): Element[] => [...row.children].filter((cell) => ['td', 'th'].includes(tagOf(cell)));
    const spanOf = (cell: Element): number => {
        const span = Number.parseInt(cell.getAttribute('colspan') ?? '1', 10);

        return Number.isNaN(span) ? 1 : Math.max(1, span);
    };
    const rows = rowElements.map((row) => cellsOf(row).flatMap((cell) => [
        convertCell(cell, mode),
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
    const markdown = [line(header), `| ${delimiter.join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
    const caption = mode.isDocument ? table.querySelector(':scope > caption') : null;
    const captionText = caption == null ? '' : finishParagraph(convertChildrenInline(caption, PLAIN, mode));

    return captionText === '' ? markdown : `${captionText}\n\n${markdown}`;
}

// A cell's text on one line; a line break in it stays a <br> on a page converted whole, and a space in a paste.
function convertCell(cell: Element, mode: ConversionMode): string {
    const lineBreak = mode.isDocument ? '<br>' : ' ';
    const text = convertBlocks(cell, ' ', mode).replace(/\\\n/g, lineBreak).replace(/\n/g, ' ');

    return collapseSpaces(text)
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
    img: (element: Element, _style: InlineStyle, mode: ConversionMode) => convertImage(element, mode),
    input: () => '',
    wbr: () => '',
});

function convertInline(node: Node, style: InlineStyle, mode: ConversionMode): string {
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
        return converter(element, style, mode);
    }

    if (mode.isDocument && KEPT_INLINE_TAGS.has(tag)) {
        const inner = convertChildrenInline(element, style, mode);

        return inner.trim() === '' ? inner : `<${tag}>${inner}</${tag}>`;
    }

    if (CODE_TAGS.has(tag) && element.closest('pre') == null) {
        return codeSpan(element.textContent ?? '');
    }

    if (isBlock(element)) {
        return ` ${convertBlocks(element, ' ', mode)} `;
    }

    return convertStyled(element, style, mode);
}

// Chrome copies the spaces beside formatting, and runs of spaces, as no-break spaces, which become plain spaces here.
// A no-break space between two words of one text, as in `10&nbsp;km`, was meant, and stays one.
function normaliseSpaces(text: string): string {
    const isWordAt = (index: number): boolean => /\S/.test(text[index] ?? ' ');

    return text
        .replace(/\u00a0/g, (space, offset: number) => (isWordAt(offset - 1) && isWordAt(offset + 1) ? space : ' '))
        .replace(/[\t\n\r ]+/g, ' ');
}

function convertChildrenInline(element: Element, style: InlineStyle, mode: ConversionMode): string {
    return [...element.childNodes].map((child) => convertInline(child, style, mode)).join('');
}

// Bold, italic and strikethrough,
// from tags such as <strong> or from inline styles as Google Docs writes them.
function convertStyled(element: Element, style: InlineStyle, mode: ConversionMode): string {
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
    let text = convertChildrenInline(element, inner, mode);

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

// A link; on a page converted whole, a link to a place on the page stays, and a web address shown as itself
// becomes an autolink.
function convertLink(element: Element, style: InlineStyle, mode: ConversionMode): string {
    const text = convertChildrenInline(element, style, mode);
    const href = element.getAttribute('href')?.trim() ?? '';
    const isInPageLink = href.startsWith('#');

    if (
        href === ''
        || (isInPageLink && !mode.isDocument)
        || text.trim() === ''
        || !isSafeUrl(href, false)
    ) {
        return text;
    }

    if (mode.isDocument && /^https?:\/\/[^\s<>]+$/i.test(href) && (element.textContent ?? '').trim() === href) {
        return `<${href}>`;
    }

    return `[${text.trim()}](${destination(href)}${titleOf(element, mode)})`;
}

// A web image stays a Markdown image link that is never fetched; a `data:` image keeps its data.
function convertImage(element: Element, mode: ConversionMode): string {
    const source = element.getAttribute('src')?.trim() ?? '';

    if (source === '' || !isSafeUrl(source, true)) {
        return '';
    }

    const alt = escapeText((element.getAttribute('alt') ?? '').replace(/\s+/g, ' ').trim());

    return `![${alt}](${destination(source)}${titleOf(element, mode)})`;
}

// A link's or image's title on a page converted whole, as Markdown writes it after the address.
function titleOf(element: Element, mode: ConversionMode): string {
    const title = mode.isDocument ? singleLine(element.getAttribute('title') ?? '') : '';

    return title === '' ? '' : ` "${title.replace(/["\\]/g, '\\$&')}"`;
}

// A relative address or one with a web, mail or phone scheme; for images also inline `data:` images.
// Checked as well as sanitised, so a `javascript:` address never reaches the Markdown.
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

// Drops spaces at the ends of lines and runs of blank lines, leaving the lines of fenced code blocks as they are.
function tidyMarkdown(markdown: string): string {
    const lines: string[] = [];
    let fence = '';

    for (const line of markdown.split('\n')) {
        const marker = FENCE_LINE.exec(line)?.[1];

        if (fence !== '') {
            lines.push(line);

            if (marker != null && marker.length >= fence.length && /^[\s>]*`+\s*$/.test(line)) {
                fence = '';
            }

            continue;
        }

        const tidy = line.replace(/[ \t]+$/, '');

        if (tidy === '' && lines.at(-1) === '') {
            continue;
        }

        lines.push(tidy);
        fence = marker ?? '';
    }

    return lines.join('\n').trim();
}

function collapseSpaces(text: string): string {
    return text.replace(/ {2,}/g, ' ');
}

function singleLine(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

// Drops the blank lines around the text and the indent all its lines share.
function dedent(text: string): string {
    const lines = text.replace(/^\s*\n/, '').replace(/\n\s*$/, '').split('\n');
    const indents = lines
        .filter((line) => line.trim() !== '')
        .map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0);
    const indent = Math.min(...indents);

    return Number.isFinite(indent) ? lines.map((line) => line.slice(indent)).join('\n') : lines.join('\n');
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
