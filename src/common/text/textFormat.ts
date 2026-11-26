import MarkdownIt from 'markdown-it';
import * as Papa from 'papaparse';
import { isCollection, isMap, isSeq } from 'yaml';
import { detectDelimiter } from '../csv/csvParser.js';
import { parseXml } from '../paths/xmlParser.js';
import { parseYamlStream } from '../yaml/yamlParser.js';

// Tells what kind of document a text is from its content alone, as for text pasted from the clipboard.
// Each check is strict, so a sentence stays plain text rather than YAML and a single line never makes a table.

export type TextFormatId = 'json' | 'html' | 'xml' | 'yaml' | 'tsv' | 'csv' | 'markdown' | 'text';

// The extension a file of each format opens by, without the dot.
export const TEXT_FORMAT_EXTENSIONS: Readonly<Record<TextFormatId, string>> = Object.freeze({
    json: 'json',
    html: 'html',
    xml: 'xml',
    yaml: 'yaml',
    tsv: 'tsv',
    csv: 'csv',
    markdown: 'md',
    text: 'txt',
});

interface FormatCheck {
    readonly format: TextFormatId;
    readonly matches: (text: string) => boolean;
}

// Order is priority: JSON is also YAML, and HTML can also be XML.
const FORMAT_CHECKS: ReadonlyArray<FormatCheck> = [
    { format: 'json', matches: isJsonDocument },
    { format: 'html', matches: isHtmlDocument },
    { format: 'xml', matches: isXmlDocument },
    { format: 'yaml', matches: isYamlDocument },
    { format: 'tsv', matches: isTsvTable },
    { format: 'csv', matches: isCsvTable },
    { format: 'markdown', matches: isMarkdownDocument },
];

export function detectTextFormat(text: string): TextFormatId {
    return FORMAT_CHECKS.find((check) => check.matches(text))?.format ?? 'text';
}

// An object or an array; a bare number, string or `true` is plain text.
function isJsonDocument(text: string): boolean {
    const trimmed = text.trim();

    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return false;
    }

    try {
        const value: unknown = JSON.parse(trimmed);

        return typeof value === 'object' && value !== null;
    }
    catch {
        return false;
    }
}

// Elements a pasted page or fragment starts with. Lowercase only, so a component such as `<Button>` isn't one,
// and without one-letter names such as `<a>` and `<b>`, which small XML samples use too.
const HTML_START_ELEMENTS = new Set([
    'article', 'aside', 'blockquote', 'body', 'details', 'div', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5',
    'h6', 'head', 'header', 'html', 'main', 'nav', 'ol', 'p', 'pre', 'script', 'section', 'span', 'style', 'table',
    'template', 'ul',
]);

const LEADING_COMMENTS = /^\uFEFF?(?:\s*<!--[\s\S]*?-->)*\s*/;

function isHtmlDocument(text: string): boolean {
    const markup = text.replace(LEADING_COMMENTS, '');

    if (/^<!doctype\s+html\b/i.test(markup) || /^<html[\s>]/i.test(markup)) {
        return true;
    }

    const element = /^<([a-z][a-z0-9]*)[\s/>]/.exec(markup)?.[1];

    return element != null && HTML_START_ELEMENTS.has(element) && markup.trimEnd().endsWith('>') && markup.includes('</');
}

function isXmlDocument(text: string): boolean {
    return text.trimStart().startsWith('<') && parseXml(text).ok;
}

// A line that starts an entry of a mapping: a key without spaces followed by a colon, in a list item or not.
const YAML_KEY_LINE = /^\s*(?:-\s+)?(?:[\w$][\w$./-]*|"[^"\n]*"|'[^'\n]*')\s*:(?:\s|$)/;

// Longer texts aren't read as YAML to tell, which would take too long.
const YAML_CHECK_MAX_LENGTH = 1_000_000;

// At least two keys, no errors, and every document a mapping or a list holding mappings or lists,
// so a sentence with a colon, a stack trace or a plain list stays plain text.
function isYamlDocument(text: string): boolean {
    if (text.length > YAML_CHECK_MAX_LENGTH) {
        return false;
    }

    const keyLines = text.split('\n').filter((line) => YAML_KEY_LINE.test(line));

    if (keyLines.length < 2) {
        return false;
    }

    const stream = parseYamlStream(text);

    if (stream.issues.some((issue) => issue.severity === 'error')) {
        return false;
    }

    const contents = stream.documents
        .map((document) => document.contents)
        .filter((content) => content != null);

    return contents.length > 0 && contents.every(isStructured);
}

function isStructured(content: unknown): boolean {
    if (isMap(content)) {
        return true;
    }

    return isSeq(content) && content.items.some((item) => isCollection(item));
}

// How many rows are read to tell a table.
const TABLE_SAMPLE_ROWS = 50;

// Two rows or more, each with the same number of fields, two or more, and no unbalanced quotes.
// A column empty on every row is no column: lines of code indented with a tab, or ending in `;`, split that way.
function readsAsTable(text: string, delimiter: string): ReadonlyArray<ReadonlyArray<string>> | null {
    const result = Papa.parse<string[]>(text, { delimiter, preview: TABLE_SAMPLE_ROWS, skipEmptyLines: 'greedy' });
    const rows = result.data;
    const width = rows[0]?.length ?? 0;

    if (result.errors.length > 0 || rows.length < 2 || width < 2 || rows.some((row) => row.length !== width)) {
        return null;
    }

    const columns = Array.from({ length: width }, (_, column) => column);
    const hasEmptyColumn = columns.some((column) => rows.every((row) => row[column]?.trim() === ''));

    return hasEmptyColumn ? null : rows;
}

function isTsvTable(text: string): boolean {
    return readsAsTable(text, '\t') != null;
}

// Prose puts a space after its commas; a table seldom does.
function isCsvTable(text: string): boolean {
    const delimiter = detectDelimiter(text);

    if (delimiter !== ',' && delimiter !== ';') {
        return false;
    }

    const rows = readsAsTable(text, delimiter);

    if (rows == null) {
        return false;
    }

    const laterFields = rows.flatMap((row) => row.slice(1));
    const spaced = laterFields.filter((field) => field.startsWith(' ')).length;

    return spaced * 2 < laterFields.length;
}

const MARKDOWN_PARSER = new MarkdownIt();

const MARKDOWN_SAMPLE_LENGTH = 64 * 1024;

const BLOCK_SIGNALS: Readonly<Record<string, string>> = Object.freeze({
    heading_open: 'heading',
    blockquote_open: 'quote',
    fence: 'fence',
    table_open: 'table',
});

const INLINE_SIGNALS: Readonly<Record<string, string>> = Object.freeze({
    link_open: 'link',
    image: 'image',
    strong_open: 'emphasis',
    em_open: 'emphasis',
    s_open: 'emphasis',
    code_inline: 'code',
});

// A fenced code block or a table, or two kinds of Markdown, such as a heading and a list;
// a lone heading reads as a comment line in a script just as well.
function isMarkdownDocument(text: string): boolean {
    const sample = text.slice(0, MARKDOWN_SAMPLE_LENGTH);

    if (sample.split('\n').filter((line) => line.trim() !== '').length < 2) {
        return false;
    }

    const kinds = markdownKinds(sample);

    return kinds.has('fence') || kinds.has('table') || kinds.size >= 2;
}

function markdownKinds(text: string): Set<string> {
    const kinds = new Set<string>();
    let listItems = 0;

    for (const token of MARKDOWN_PARSER.parse(text, {})) {
        const block = BLOCK_SIGNALS[token.type];

        if (block != null) {
            kinds.add(block);
        }

        if (token.type === 'list_item_open') {
            listItems += 1;
        }

        for (const child of token.children ?? []) {
            const inline = INLINE_SIGNALS[child.type];

            if (inline != null) {
                kinds.add(inline);
            }
        }
    }

    // A single item reads as a line that happens to start with a dash or a number.
    if (listItems >= 2) {
        kinds.add('list');
    }

    return kinds;
}
