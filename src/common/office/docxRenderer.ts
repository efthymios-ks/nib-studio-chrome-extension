import DOMPurify from 'dompurify';
import type { ImageSize } from './ooxmlDetails.js';

// Mammoth ships CJS without bundled types, so this declares the surface used here.
interface MammothResult {
    readonly value: string;
}

interface MammothInput {
    readonly arrayBuffer?: ArrayBuffer;
    readonly buffer?: unknown;
}

interface MammothImage {
    readonly contentType: string;
    readAsBase64String(): Promise<string>;
}

type ImageConverter = unknown;

interface MammothOptions {
    readonly styleMap: ReadonlyArray<string>;
    readonly idPrefix: string;
    readonly convertImage?: ImageConverter;
}

interface MammothLike {
    convertToHtml(input: MammothInput, options?: MammothOptions): Promise<MammothResult>;
    readonly images?: {
        imgElement(convert: (image: MammothImage) => Promise<Record<string, string>>): ImageConverter;
    };
}

interface DocxHtmlResult {
    readonly html: string;
}

interface DocxRenderOptions {
    // The size each picture is shown at in the document, keyed by its file's length in bytes; see readOoxmlDetails.
    readonly imageSizes?: ReadonlyMap<number, ReadonlyArray<ImageSize>>;
}

// Word's built-in styles mammoth leaves as plain paragraphs, mapped to the elements the page styles.
const DOCX_STYLE_MAP: ReadonlyArray<string> = [
    'p[style-name=\'Title\'] => h1.document-title:fresh',
    'p.Title => h1.document-title:fresh',
    'p[style-name=\'Subtitle\'] => p.document-subtitle:fresh',
    'p.Subtitle => p.document-subtitle:fresh',
    'p[style-name=\'Quote\'] => blockquote > p:fresh',
    'p.Quote => blockquote > p:fresh',
    'p[style-name=\'Intense Quote\'] => blockquote.document-quote-intense > p:fresh',
    'p.IntenseQuote => blockquote.document-quote-intense > p:fresh',
    'p[style-name=\'Caption\'] => p.document-caption:fresh',
    'p.Caption => p.document-caption:fresh',
    'p[style-name=\'heading 7\'] => h6:fresh',
    'p[style-name=\'heading 8\'] => h6:fresh',
    'p[style-name=\'heading 9\'] => h6:fresh',
    'p[style-name=\'Heading 7\'] => h6:fresh',
    'p[style-name=\'Heading 8\'] => h6:fresh',
    'p[style-name=\'Heading 9\'] => h6:fresh',
    'r[style-name=\'Emphasis\'] => em',
    'r[style-name=\'Intense Emphasis\'] => em',
    'br[type=\'page\'] => hr.document-page-break',
    'u => u',
];

// Ids of bookmarks and notes start with this, so they never clash with the studio's own.
const DOCX_ID_PREFIX = 'word-';

// Pictures Chrome can show from a data: URI; others, such as EMF and WMF, show as a placeholder.
const DISPLAYABLE_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|bmp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,/i;

// Converts with mammoth, which emits semantic HTML without inline styles or fonts; pictures come inline as data: URIs,
// at the size the document gives them, and the result is sanitized.
export async function renderDocxToHtmlAsync(input: ArrayBuffer, options: DocxRenderOptions = {}): Promise<DocxHtmlResult> {
    const mammoth = await loadMammothAsync();
    const sizeOf = imageSizeLookup(options.imageSizes ?? new Map());
    const convertImage = mammoth.images?.imgElement(async (image) => {
        const data = await image.readAsBase64String();
        const size = sizeOf(base64ByteLength(data));
        const attributes: Record<string, string> = { src: `data:${image.contentType};base64,${data}` };

        if (size != null) {
            attributes['width'] = String(Math.round(size.width));
            attributes['height'] = String(Math.round(size.height));
        }

        return attributes;
    });
    const result = await mammoth.convertToHtml(buildMammothInput(input), {
        styleMap: DOCX_STYLE_MAP,
        idPrefix: DOCX_ID_PREFIX,
        ...(convertImage == null ? {} : { convertImage }),
    });

    return { html: sanitizeHtml(result.value) };
}

// Takes each picture's size in document order; a picture used more often than the document places it keeps the last size.
function imageSizeLookup(sizes: ReadonlyMap<number, ReadonlyArray<ImageSize>>): (byteLength: number) => ImageSize | null {
    const used = new Map<number, number>();

    return (byteLength) => {
        const queue = sizes.get(byteLength);

        if (queue == null || queue.length === 0) {
            return null;
        }

        const index = used.get(byteLength) ?? 0;
        used.set(byteLength, index + 1);

        return queue[Math.min(index, queue.length - 1)] ?? null;
    };
}

export function base64ByteLength(base64: string): number {
    const padding = /=*$/.exec(base64)?.[0].length ?? 0;

    return Math.floor((base64.length * 3) / 4) - padding;
}

// Mammoth's browser bundle expects `{ arrayBuffer }`; its Node entry expects
// `{ buffer }`. Passing both keeps the renderer portable between the real
// Chrome runtime (browser entry) and vitest (Node entry).
function buildMammothInput(arrayBuffer: ArrayBuffer): MammothInput {
    const globalBuffer = (globalThis as { Buffer?: { from(buffer: ArrayBuffer): unknown } }).Buffer;

    if (globalBuffer != null) {
        return { arrayBuffer, buffer: globalBuffer.from(arrayBuffer) };
    }

    return { arrayBuffer };
}

const SANITIZE_CONFIG = {
    ALLOWED_TAGS: [
        'p', 'br', 'hr', 'span', 'div', 'section',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'strong', 'em', 'b', 'i', 'u', 's', 'sub', 'sup', 'mark',
        'ul', 'ol', 'li',
        'blockquote', 'pre', 'code',
        'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
        'a', 'img',
    ],
    ALLOWED_ATTR: ['href', 'name', 'id', 'class', 'colspan', 'rowspan', 'title', 'lang', 'src', 'alt', 'width', 'height'],
    FORBID_TAGS: ['link', 'style', 'script', 'iframe', 'object', 'embed', 'audio', 'video', 'svg', 'math', 'form'],
    FORBID_ATTR: ['srcset', 'style', 'onerror', 'onload', 'formaction'],
    KEEP_CONTENT: true,
};

// Keeps text, tables, lists and data: pictures only. Other pictures become a placeholder, so nothing loads from the
// network or disk, and links to other places keep their address as a tooltip but don't open; in-document links stay.
export function sanitizeHtml(rawHtml: string): string {
    const fragment = DOMPurify.sanitize(rawHtml, { ...SANITIZE_CONFIG, RETURN_DOM_FRAGMENT: true });

    for (const image of [...fragment.querySelectorAll('img')]) {
        if (!DISPLAYABLE_IMAGE.test(image.getAttribute('src') ?? '')) {
            image.replaceWith(picturePlaceholder(image.ownerDocument));
        }
    }

    for (const link of [...fragment.querySelectorAll('a[href]')]) {
        const href = link.getAttribute('href') ?? '';

        if (!href.startsWith('#')) {
            link.removeAttribute('href');
            link.setAttribute('title', href);
            link.setAttribute('data-link', 'external');
        }
    }

    const holder = fragment.ownerDocument.createElement('div');
    holder.append(fragment);

    return holder.innerHTML;
}

// Stands in for a picture the page can't show, in a DOCX and in a .doc alike; the label may name its format.
export function picturePlaceholder(owner: Document, label = 'Picture'): HTMLElement {
    const placeholder = owner.createElement('span');
    placeholder.className = 'document-picture';
    placeholder.setAttribute('role', 'img');
    placeholder.setAttribute('aria-label', label);
    placeholder.textContent = label;

    return placeholder;
}

let mammothPromise: Promise<MammothLike> | null = null;

// Loads mammoth once, on the first document opened.
function loadMammothAsync(): Promise<MammothLike> {
    if (mammothPromise == null) {
        mammothPromise = importMammothAsync();
    }

    return mammothPromise;
}

async function importMammothAsync(): Promise<MammothLike> {
    const module = await import('mammoth') as unknown as { default?: MammothLike } & MammothLike;

    return module.default ?? module;
}
