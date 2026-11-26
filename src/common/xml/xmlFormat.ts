import type { ParseErrorAt } from '../errorMessage.js';
import { parseXml } from '../paths/xmlParser.js';

export type XmlFormatResult = { readonly ok: true; readonly text: string } | ({ readonly ok: false } & ParseErrorAt);

const INDENT = '  ';

// Markup that runs to a fixed ending: comments, CDATA sections and processing instructions, the declaration included.
const FIXED_MARKUP: ReadonlyArray<readonly [string, string]> = [
    ['<!--', '-->'],
    ['<![CDATA[', ']]>'],
    ['<?', '?>'],
];

type XmlToken =
    | { readonly kind: 'text'; readonly start: number; readonly end: number }
    | { readonly kind: 'markup'; readonly start: number; readonly end: number }
    | { readonly kind: 'open'; readonly start: number; readonly end: number; readonly name: string }
    | { readonly kind: 'empty'; readonly start: number; readonly end: number }
    | { readonly kind: 'close'; readonly start: number; readonly end: number };

interface XmlElement {
    readonly kind: 'element';
    readonly open: XmlToken;
    readonly children: XmlItem[];
    close: XmlToken | null;
}

type XmlItem = XmlElement | XmlToken;

// The document laid out with a 2-space indent. An element holding only elements, comments and white space puts each
// of them on a line of its own; an element holding text, or marked `xml:space="preserve"`, keeps its content exactly
// as written, so mixed content and meaningful spaces stay. Tags, attributes, the declaration, comments,
// processing instructions, CDATA sections and the DOCTYPE stay as written.
export function formatXml(text: string): XmlFormatResult {
    const parsed = parseXml(text);

    if (!parsed.ok) {
        return { ok: false, message: parsed.message, line: parsed.line, column: parsed.column };
    }

    const items = buildTree(tokenize(text));

    if (items == null) {
        return { ok: true, text };
    }

    const lines: string[] = [];
    writeItems(text, items, 0, lines);

    return { ok: true, text: lines.join('\n') };
}

function tokenize(text: string): XmlToken[] {
    const tokens: XmlToken[] = [];
    let position = 0;

    while (position < text.length) {
        if (text.charAt(position) !== '<') {
            const next = text.indexOf('<', position);
            const end = next < 0 ? text.length : next;
            tokens.push({ kind: 'text', start: position, end });
            position = end;
            continue;
        }

        const end = markupEnd(text, position);
        tokens.push(tagToken(text, position, end));
        position = end;
    }

    return tokens;
}

// Where the markup starting at `start` ends, just past its closing `>`.
function markupEnd(text: string, start: number): number {
    for (const [opening, closing] of FIXED_MARKUP) {
        if (text.startsWith(opening, start)) {
            const found = text.indexOf(closing, start + opening.length);

            return found < 0 ? text.length : found + closing.length;
        }
    }

    // A tag or a DOCTYPE: quoted values and a DOCTYPE's internal subset may hold `>`.
    let quote: string | null = null;
    let depth = 0;

    for (let index = start + 1; index < text.length; index += 1) {
        const character = text.charAt(index);

        if (quote != null) {
            quote = character === quote ? null : quote;
            continue;
        }

        if (character === '"' || character === '\'') {
            quote = character;
        }
        else if (character === '[') {
            depth += 1;
        }
        else if (character === ']') {
            depth = Math.max(0, depth - 1);
        }
        else if (character === '>' && depth === 0) {
            return index + 1;
        }
    }

    return text.length;
}

function tagToken(text: string, start: number, end: number): XmlToken {
    const second = text.charAt(start + 1);

    if (second === '!' || second === '?') {
        return { kind: 'markup', start, end };
    }

    if (second === '/') {
        return { kind: 'close', start, end };
    }

    if (text.charAt(end - 2) === '/') {
        return { kind: 'empty', start, end };
    }

    const name = /^<([^\s/>]+)/.exec(text.slice(start, end))?.[1] ?? '';

    return { kind: 'open', start, end, name };
}

// Nests the tokens into elements; null when they don't nest, which a well-formed document always does.
function buildTree(tokens: ReadonlyArray<XmlToken>): XmlItem[] | null {
    const root: XmlItem[] = [];
    const open: XmlElement[] = [];

    for (const token of tokens) {
        const children = open.at(-1)?.children ?? root;

        if (token.kind === 'open') {
            const element: XmlElement = { kind: 'element', open: token, children: [], close: null };
            children.push(element);
            open.push(element);
            continue;
        }

        if (token.kind === 'close') {
            const element = open.pop();

            if (element == null) {
                return null;
            }

            element.close = token;
            continue;
        }

        children.push(token);
    }

    return open.length === 0 ? root : null;
}

function writeItems(text: string, items: ReadonlyArray<XmlItem>, depth: number, lines: string[]): void {
    const indent = INDENT.repeat(depth);

    for (const item of items) {
        if (item.kind === 'text') {
            const content = text.slice(item.start, item.end).trim();

            if (content !== '') {
                lines.push(indent + content);
            }

            continue;
        }

        if (item.kind !== 'element') {
            lines.push(indent + text.slice(item.start, item.end));
            continue;
        }

        writeElement(text, item, depth, lines);
    }
}

function writeElement(text: string, element: XmlElement, depth: number, lines: string[]): void {
    const indent = INDENT.repeat(depth);
    const end = element.close?.end ?? element.open.end;

    if (element.children.length === 0 || keepsContent(text, element)) {
        lines.push(indent + text.slice(element.open.start, end));

        return;
    }

    lines.push(indent + text.slice(element.open.start, element.open.end));
    writeItems(text, element.children, depth + 1, lines);

    if (element.close != null) {
        lines.push(indent + text.slice(element.close.start, element.close.end));
    }
}

// Text, a CDATA section or `xml:space="preserve"` makes the content's white space part of the document.
function keepsContent(text: string, element: XmlElement): boolean {
    if (/\sxml:space\s*=\s*["']preserve["']/.test(text.slice(element.open.start, element.open.end))) {
        return true;
    }

    return element.children.some((child) => {
        if (child.kind === 'text') {
            return text.slice(child.start, child.end).trim() !== '';
        }

        return child.kind === 'markup' && text.startsWith('<![CDATA[', child.start);
    });
}
