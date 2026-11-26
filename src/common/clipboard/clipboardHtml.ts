import type { Config } from 'dompurify';
import { purifyHtml } from '../html/purifyHtml.js';
import { dataUrlByteLength } from '../markdown/localImages.js';
import { htmlToPlainText } from './plainText.js';

// Formatted content for the clipboard: HTML for a paste that keeps the formatting,
// and its text for a paste that can't take HTML.
export interface RichText {
    readonly html: string;
    readonly text: string;
}

// A pasted document keeps its text, headings, lists, tables, links and pictures; it never takes scripts, handlers,
// `javascript:` links, style sheets, frames, objects or forms.
const CLIPBOARD_CONFIG: Config = {
    FORBID_TAGS: ['style', 'link', 'meta', 'base', 'form', 'template', 'noscript', 'dialog'],
    FORBID_ATTR: ['autofocus', 'contenteditable', 'tabindex', 'draggable'],
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
};

// Elements a copy leaves out whole: controls, and what never shows on the page.
const LEFT_OUT_SELECTOR = [
    'button', 'input', 'select', 'textarea', 'script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', '[hidden]',
].join(', ');

const HIDDEN_STYLE = /(?:^|;)\s*display\s*:\s*none\b/i;

// Addresses that lead somewhere from whatever a copy is pasted into. The browser writes any other address, such as
// a workspace file's or a heading's, as one inside the studio, which leads nowhere from there.
const PORTABLE_LINK = /^(?:https?:|mailto:|tel:|ftp:)/i;

// Sanitises HTML for the clipboard.
export function sanitizeClipboardHtml(html: string): string {
    return purifyHtml(html, CLIPBOARD_CONFIG);
}

// The rich text of a rendered document: what doesn't show and the controls go, links that lead nowhere outside the
// studio keep their text alone, tables take borders and cell padding so they paste as grids, the HTML is sanitised,
// and the plain text is the text it shows.
export function documentRichText(html: string): RichText {
    const template = document.createElement('template');
    template.innerHTML = html;
    const root = template.content;
    removeUnshown(root);
    unlinkLocalLinks(root);
    outlineTables(root);
    const clean = sanitizeClipboardHtml(template.innerHTML);
    const shown = document.createElement('template');
    shown.innerHTML = clean;

    return { html: clean, text: htmlToPlainText(shown.content) };
}

// Keeps the pictures written into a copy as data: URLs within `maxBytes` in all, in document order;
// a picture past it gives way to a line saying it was left out, and a smaller one after it may still fit.
export function capInlineImages(root: ParentNode, maxBytes: number): void {
    let used = 0;

    for (const image of [...root.querySelectorAll('img')]) {
        const source = image.getAttribute('src') ?? '';

        if (!source.startsWith('data:')) {
            continue;
        }

        const bytes = dataUrlByteLength(source);

        if (used + bytes <= maxBytes) {
            used += bytes;
            continue;
        }

        const note = image.ownerDocument.createElement('span');
        note.textContent = `[Picture left out: a copy holds at most ${Math.round(maxBytes / (1024 * 1024))} MB of pictures]`;
        image.replaceWith(note);
    }
}

function removeUnshown(root: ParentNode): void {
    for (const element of [...root.querySelectorAll(LEFT_OUT_SELECTOR)]) {
        element.remove();
    }

    for (const element of [...root.querySelectorAll('[style]')]) {
        if (HIDDEN_STYLE.test(element.getAttribute('style') ?? '')) {
            element.remove();
        }
    }
}

function unlinkLocalLinks(root: ParentNode): void {
    for (const link of root.querySelectorAll('a[href]')) {
        if (!PORTABLE_LINK.test((link.getAttribute('href') ?? '').trim())) {
            link.removeAttribute('href');
        }
    }
}

// Word, Outlook and Google Docs draw a table without borders unless it asks for them.
function outlineTables(root: ParentNode): void {
    for (const table of root.querySelectorAll('table')) {
        setMissing(table, 'border', '1');
        setMissing(table, 'cellspacing', '0');
        setMissing(table, 'cellpadding', '4');
        const style = (table.getAttribute('style') ?? '').trim();

        if (!/border-collapse/i.test(style)) {
            const separator = style === '' || style.endsWith(';') ? '' : ';';
            table.setAttribute('style', `${style}${separator} border-collapse: collapse;`.trim());
        }
    }
}

function setMissing(element: Element, name: string, value: string): void {
    if (!element.hasAttribute(name)) {
        element.setAttribute(name, value);
    }
}
