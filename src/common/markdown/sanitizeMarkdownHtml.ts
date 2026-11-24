import { purifyHtml } from '../html/purifyHtml.js';
import {
    imageSourceKind,
    LOCAL_SOURCE_ATTRIBUTE,
    LOCAL_SRCSET_ATTRIBUTE,
    parseSrcset,
    remoteImageLabel,
} from './localImages.js';

export interface MarkdownHtmlOptions {
    // 'block' swaps web images for a placeholder; 'keep' leaves their address,
    // for pages that leave the studio.
    readonly remoteImages: 'block' | 'keep';
}

// The class of the placeholder that stands for an image that can't show, in the preview and in exports.
export const MARKDOWN_IMAGE_PLACEHOLDER_CLASS = 'md-image-blocked';

// The renderer's own heading ids travel in this attribute,
// past the sanitizer's guard against ids such as `title`.
export const HEADING_ID_ATTRIBUTE = 'data-heading-id';

// What the renderer writes, and the HTML READMEs use, much as GitHub allows it.
const MARKDOWN_TAGS = Object.freeze([
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'blockquote', 'pre', 'code',
    'em', 'strong', 'b', 'i', 'u', 's', 'del', 'ins', 'strike', 'mark', 'small', 'sub', 'sup', 'kbd', 'samp', 'var', 'tt',
    'abbr', 'cite', 'dfn', 'q', 'time', 'wbr', 'bdo', 'ruby', 'rt', 'rp',
    'a', 'img', 'picture', 'source', 'figure', 'figcaption',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'div', 'span', 'details', 'summary', 'button',
]);

const MARKDOWN_ATTRIBUTES = Object.freeze([
    'href', 'src', 'srcset', 'media', 'alt', 'title', 'width', 'height', 'align', 'valign',
    'colspan', 'rowspan', 'span', 'scope', 'headers', 'abbr', 'border', 'cellpadding', 'cellspacing', 'nowrap',
    'open', 'name', 'id', 'lang', 'dir', 'start', 'reversed', 'value', 'type', 'datetime', 'cite', 'class',
    'aria-label', 'aria-hidden',
    'data-code', 'data-mermaid-id', HEADING_ID_ATTRIBUTE,
]);

// Classes the renderer gives code blocks and diagrams; raw HTML can't borrow the studio's own classes.
const RENDERER_CLASSES = new Set(['md-code-wrap', 'md-code', 'md-code-copy', 'md-mermaid']);
const LANGUAGE_CLASS = /^language-[\w#+.-]+$/;
const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

// Sanitizes rendered Markdown, raw HTML included: no scripts, handlers, styles, frames, objects, forms or
// `javascript:` addresses. Web images become placeholders unless kept, and images read from the workspace
// carry their address in `data-local-src` until the page reads them.
export function sanitizeMarkdownHtml(html: string, options: MarkdownHtmlOptions): string {
    const clean = purifyHtml(html, {
        ALLOWED_TAGS: [...MARKDOWN_TAGS],
        ALLOWED_ATTR: [...MARKDOWN_ATTRIBUTES],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false,
        KEEP_CONTENT: true,
    });
    const template = document.createElement('template');
    template.innerHTML = clean;
    const root = template.content;

    applyHeadingIds(root);
    keepRendererClasses(root);
    prepareImages(root, options);
    preparePictureSources(root, options);

    return template.innerHTML;
}

function applyHeadingIds(root: DocumentFragment): void {
    for (const element of [...root.querySelectorAll(`[${HEADING_ID_ATTRIBUTE}]`)]) {
        const id = element.getAttribute(HEADING_ID_ATTRIBUTE) ?? '';
        element.removeAttribute(HEADING_ID_ATTRIBUTE);

        if (HEADING_TAGS.has(element.tagName) && id !== '') {
            element.setAttribute('id', id);
        }
    }
}

function keepRendererClasses(root: DocumentFragment): void {
    for (const element of [...root.querySelectorAll('[class]')]) {
        const kept = [...element.classList].filter((name) => RENDERER_CLASSES.has(name) || LANGUAGE_CLASS.test(name));

        if (kept.length === 0) {
            element.removeAttribute('class');
        }
        else {
            element.setAttribute('class', kept.join(' '));
        }
    }
}

function prepareImages(root: DocumentFragment, options: MarkdownHtmlOptions): void {
    for (const image of [...root.querySelectorAll('img')]) {
        const source = image.getAttribute('src') ?? '';
        const kind = imageSourceKind(source);

        if (kind === 'inline' || (kind === 'web' && options.remoteImages === 'keep')) {
            continue;
        }

        if (kind === 'web') {
            image.replaceWith(blockedImage(image, source));
            continue;
        }

        image.removeAttribute('src');
        image.setAttribute(LOCAL_SOURCE_ATTRIBUTE, source);
    }
}

// A `<picture>` source keeps its `srcset` when every candidate loads as written,
// waits for the workspace when some must be read from it, and goes when one is a blocked web image.
function preparePictureSources(root: DocumentFragment, options: MarkdownHtmlOptions): void {
    for (const source of [...root.querySelectorAll('source')]) {
        const srcset = source.getAttribute('srcset') ?? '';
        const kinds = parseSrcset(srcset).map((candidate) => imageSourceKind(candidate.url));
        source.removeAttribute('src');

        if (source.parentElement?.localName !== 'picture' || kinds.length === 0) {
            source.remove();
            continue;
        }

        if (kinds.includes('web')) {
            if (options.remoteImages === 'block') {
                source.remove();
            }

            continue;
        }

        if (kinds.includes('local')) {
            source.removeAttribute('srcset');
            source.setAttribute(LOCAL_SRCSET_ATTRIBUTE, srcset);
        }
    }
}

// The placeholder of a web image, titled with its alt text, or its address when it has none,
// as other placeholders are.
function blockedImage(image: HTMLImageElement, source: string): HTMLElement {
    const alt = image.getAttribute('alt') ?? '';
    const placeholder = image.ownerDocument.createElement('span');
    placeholder.className = MARKDOWN_IMAGE_PLACEHOLDER_CLASS;
    placeholder.setAttribute('title', alt === '' ? source : alt);
    placeholder.textContent = remoteImageLabel(source);

    return placeholder;
}
