import { syntaxTree } from '@codemirror/language';
import type { ChangeSpec, EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

// An element of the HTML source, with the ranges of its tags.
export interface HtmlElement {
    // The tag name in lower case.
    readonly name: string;
    readonly from: number;
    readonly to: number;
    // The opening tag, or the whole tag of a void or self-closing element.
    readonly openFrom: number;
    readonly openTo: number;
    readonly nameFrom: number;
    readonly nameTo: number;
    // The closing tag; null when the element closes itself or is closed by what follows it, as `<li>` can be.
    readonly closeFrom: number | null;
    readonly closeTo: number | null;
    readonly closeNameFrom: number | null;
    readonly closeNameTo: number | null;
    // A void or self-closing element, such as `<img>` or `<br>`, which holds nothing.
    readonly isVoid: boolean;
    // What lies between the tags: from the end of the opening tag to the closing tag,
    // or to the element's end.
    readonly contentFrom: number;
    readonly contentTo: number;
    readonly node: SyntaxNode;
}

// Elements that stand on lines of their own; their tags are block edges for Enter, Backspace and Delete.
export const HTML_BLOCKS: ReadonlySet<string> = new Set([
    'html', 'body', 'main', 'header', 'footer', 'section', 'article', 'nav', 'aside', 'div', 'address', 'center', 'hgroup',
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'figure', 'figcaption', 'details', 'summary',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'caption', 'colgroup', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'hr',
]);

// Elements shown as a labelled box in the Interactive view and edited only in the Editor:
// what isn't text to read, and what holds no text of the page, such as `<head>`, styles and scripts.
export const BOXED_ELEMENTS: ReadonlySet<string> = new Set([
    'head', 'title', 'meta', 'link', 'base', 'style', 'script', 'template', 'noscript',
    'svg', 'math', 'iframe', 'object', 'embed', 'canvas', 'video', 'audio', 'map',
    'form', 'select', 'textarea', 'button', 'input', 'datalist', 'output', 'progress', 'meter', 'dialog',
]);

// Blocks that Enter splits and Backspace or Delete at their edge joins with a neighbour.
export const TEXT_BLOCKS: ReadonlySet<string> = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'dt', 'dd']);

export const HEADING_LEVELS: ReadonlyMap<string, number> = new Map([['h1', 1], ['h2', 2], ['h3', 3], ['h4', 4], ['h5', 5], ['h6', 6]]);

const TAG_NODES = new Set(['OpenTag', 'SelfClosingTag']);

// The element a syntax node of the `Element` type stands for, or null for one too broken to read.
export function htmlElementOf(state: EditorState, node: SyntaxNode): HtmlElement | null {
    const open = node.firstChild;

    if (node.name !== 'Element' || open == null || !TAG_NODES.has(open.name)) {
        return null;
    }

    const tagName = open.getChild('TagName');

    if (tagName == null) {
        return null;
    }

    const close = node.lastChild != null && node.lastChild.name === 'CloseTag' ? node.lastChild : null;
    const closeName = close?.getChild('TagName') ?? null;

    return {
        name: state.sliceDoc(tagName.from, tagName.to).toLowerCase(),
        from: node.from,
        to: node.to,
        openFrom: open.from,
        openTo: open.to,
        nameFrom: tagName.from,
        nameTo: tagName.to,
        closeFrom: close?.from ?? null,
        closeTo: close?.to ?? null,
        closeNameFrom: closeName?.from ?? null,
        closeNameTo: closeName?.to ?? null,
        isVoid: open.name === 'SelfClosingTag',
        contentFrom: open.to,
        contentTo: close?.from ?? node.to,
        node,
    };
}

// The elements whose content holds the position, innermost first.
export function enclosingElements(state: EditorState, position: number): HtmlElement[] {
    const found: HtmlElement[] = [];

    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, 1); node != null; node = node.parent) {
        if (node.name !== 'Element') {
            continue;
        }

        const element = htmlElementOf(state, node);

        if (element != null && !element.isVoid && element.contentFrom <= position && position <= element.contentTo) {
            found.push(element);
        }
    }

    return found;
}

// The innermost element of one of the names around the position, or null.
export function enclosingElementNamed(state: EditorState, position: number, names: ReadonlySet<string>): HtmlElement | null {
    return enclosingElements(state, position).find((element) => names.has(element.name)) ?? null;
}

// The element children of an element, in order.
export function childElements(state: EditorState, parent: HtmlElement): HtmlElement[] {
    const children: HtmlElement[] = [];

    for (let child = parent.node.firstChild; child != null; child = child.nextSibling) {
        const element = child.name === 'Element' ? htmlElementOf(state, child) : null;

        if (element != null) {
            children.push(element);
        }
    }

    return children;
}

// The element just before or after this one among its siblings, with only white space between them;
// null otherwise.
export function adjacentElement(state: EditorState, element: HtmlElement, direction: -1 | 1): HtmlElement | null {
    const step = (node: SyntaxNode): SyntaxNode | null => (direction < 0 ? node.prevSibling : node.nextSibling);

    for (let node = step(element.node); node != null; node = step(node)) {
        if (node.name === 'Element') {
            return htmlElementOf(state, node);
        }

        if (node.name !== 'Text' || state.sliceDoc(node.from, node.to).trim() !== '') {
            return null;
        }
    }

    return null;
}

// The value of an attribute of the element's opening tag, with its quotes taken off and its entities decoded;
// null when the tag has no such attribute.
export function attributeValue(state: EditorState, element: HtmlElement, name: string): string | null {
    const attribute = findAttribute(state, element, name);

    if (attribute == null) {
        return null;
    }

    const value = attribute.getChild('AttributeValue') ?? attribute.getChild('UnquotedAttributeValue');

    return value == null ? '' : decodeHtmlText(unquote(state.sliceDoc(value.from, value.to)));
}

// The attribute's syntax node in the element's opening tag.
export function findAttribute(state: EditorState, element: HtmlElement, name: string): SyntaxNode | null {
    const open = element.node.firstChild;

    for (let child = open?.firstChild ?? null; child != null; child = child.nextSibling) {
        const attributeName = child.name === 'Attribute' ? child.getChild('AttributeName') : null;

        if (attributeName != null && state.sliceDoc(attributeName.from, attributeName.to).toLowerCase() === name) {
            return child;
        }
    }

    return null;
}

// Gives an element another tag name, in its opening and closing tags, keeping its attributes.
export function renameChanges(element: HtmlElement, name: string): ChangeSpec[] {
    const changes: ChangeSpec[] = [{ from: element.nameFrom, to: element.nameTo, insert: name }];

    if (element.closeNameFrom != null && element.closeNameTo != null) {
        changes.push({ from: element.closeNameFrom, to: element.closeNameTo, insert: name });
    }

    return changes;
}

// The tags of a list, whose items are `<li>`.
export const LIST_ELEMENTS: ReadonlySet<string> = new Set(['ul', 'ol']);

// What attribute and entity texts read as, kept while they repeat; emptied when it grows past this,
// so typing in a long attribute doesn't fill it.
const DECODED_LIMIT = 500;
const decoded = new Map<string, string>();

// What an entity or attribute text reads as, `&amp;` as `&`; parsed in an inert document,
// so nothing in it runs.
export function decodeHtmlText(text: string): string {
    if (!text.includes('&')) {
        return text;
    }

    const known = decoded.get(text);

    if (known == null && decoded.size >= DECODED_LIMIT) {
        decoded.clear();
    }

    if (known != null) {
        return known;
    }

    const page = new DOMParser().parseFromString(`<!doctype html><body>${text.replace(/</g, '&lt;')}`, 'text/html');
    const reading = page.body.textContent ?? text;
    decoded.set(text, reading);

    return reading;
}

function unquote(value: string): string {
    const first = value.charAt(0);

    return (first === '"' || first === '\'') && value.endsWith(first) && value.length >= 2 ? value.slice(1, -1) : value;
}
