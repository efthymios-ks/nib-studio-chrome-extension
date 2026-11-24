import {
    TEXT_FORMAT,
    type DocBlock,
    type DocImage,
    type DocInline,
    type DocListMark,
    type DocParagraph,
    type DocPicture,
    type DocTable,
} from '../../common/office/docModel.js';
import { picturePlaceholder } from '../../common/office/docxRenderer.js';
import { h } from '../app/dom.js';

// Inline formatting as nested elements, outermost first.
const FORMAT_TAGS: ReadonlyArray<readonly [number, 'strong' | 'em' | 'u' | 's' | 'sup' | 'sub']> = [
    [TEXT_FORMAT.bold, 'strong'],
    [TEXT_FORMAT.italic, 'em'],
    [TEXT_FORMAT.underline, 'u'],
    [TEXT_FORMAT.strike, 's'],
    [TEXT_FORMAT.superscript, 'sup'],
    [TEXT_FORMAT.subscript, 'sub'],
];

// Formats the browser can't draw, which their placeholder names.
const NAMED_FORMATS: ReadonlySet<string> = new Set(['emf', 'wmf', 'pict', 'tiff']);

// The URL a page loads an image from; each image gets one URL however often it shows.
export type PictureUrlOf = (image: DocImage) => string;

export interface PictureUrls {
    readonly urlOf: PictureUrlOf;
    // Lets go of every URL handed out, once the page that shows them is gone.
    revoke(): void;
}

interface OpenList {
    readonly element: HTMLOListElement | HTMLUListElement;
    readonly mark: DocListMark;
}

// Blob URLs for the pictures of one page.
export function createPictureUrls(): PictureUrls {
    const urls = new Map<DocImage, string>();

    return {
        urlOf: (image) => {
            const known = urls.get(image);

            if (known != null) {
                return known;
            }

            const url = URL.createObjectURL(new Blob([image.bytes], { type: image.mimeType }));
            urls.set(image, url);

            return url;
        },
        revoke: () => {
            for (const url of urls.values()) {
                URL.revokeObjectURL(url);
            }

            urls.clear();
        },
    };
}

// Builds the elements of a legacy Word document, the same elements the DOCX preview shows, so one stylesheet serves both.
// Without `urlOf`, every picture shows as a placeholder.
export function renderDocBlocks(blocks: ReadonlyArray<DocBlock>, urlOf: PictureUrlOf | null = null): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const paragraphs: DocParagraph[] = [];

    const flushParagraphs = (): void => {
        fragment.append(renderParagraphs(paragraphs.splice(0), urlOf));
    };

    for (const block of blocks) {
        if (block.kind === 'paragraph') {
            paragraphs.push(block);
            continue;
        }

        flushParagraphs();
        fragment.append(block.kind === 'table' ? renderTable(block, urlOf) : h('hr', { class: 'document-page-break' }));
    }

    flushParagraphs();

    return fragment;
}

// Paragraphs, with list items gathered into nested lists by level.
function renderParagraphs(paragraphs: ReadonlyArray<DocParagraph>, urlOf: PictureUrlOf | null): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const open: OpenList[] = [];

    for (const paragraph of paragraphs) {
        const mark = paragraph.list;

        if (mark == null) {
            open.length = 0;
            fragment.append(renderParagraph(paragraph, urlOf));
            continue;
        }

        while (open.length > 0 && (open.at(-1)?.mark.level ?? 0) > mark.level) {
            open.pop();
        }

        const top = open.at(-1);

        if (top != null && top.mark.level === mark.level && !isSameList(top.mark, mark)) {
            open.pop();
        }

        if (open.at(-1)?.mark.level !== mark.level) {
            const list = createList(mark);
            const parent = open.at(-1)?.element.lastElementChild;
            (parent ?? fragment).append(list);
            open.push({ element: list, mark });
        }

        open.at(-1)?.element.append(h('li', { children: renderInlines(paragraph.inlines, urlOf) }));
    }

    return fragment;
}

function isSameList(left: DocListMark, right: DocListMark): boolean {
    return left.id === right.id && (left.format === 'bullet') === (right.format === 'bullet');
}

function createList(mark: DocListMark): HTMLOListElement | HTMLUListElement {
    if (mark.format === 'bullet') {
        return h('ul');
    }

    return h('ol', {
        dataset: { format: mark.format },
        attrs: { start: mark.start === 1 ? null : mark.start },
    });
}

function renderParagraph(paragraph: DocParagraph, urlOf: PictureUrlOf | null): HTMLElement {
    const children = paragraph.inlines.length === 0 ? [h('br')] : renderInlines(paragraph.inlines, urlOf);
    const element = paragraphElement(paragraph);
    element.append(...children);

    if (paragraph.alignment !== 'start') {
        element.dataset['align'] = paragraph.alignment;
    }

    return element;
}

function paragraphElement(paragraph: DocParagraph): HTMLElement {
    if (paragraph.role === 'title') {
        return h('h1', { class: 'document-title' });
    }

    if (paragraph.role === 'subtitle') {
        return h('p', { class: 'document-subtitle' });
    }

    if (paragraph.role === 'heading') {
        const level = Math.min(6, Math.max(1, paragraph.level));

        return document.createElement(`h${level}`);
    }

    return h('p');
}

// Floating pictures lead their anchor paragraph as blocks, wherever in it they are anchored.
function renderInlines(inlines: ReadonlyArray<DocInline>, urlOf: PictureUrlOf | null): Node[] {
    const isFloating = (inline: DocInline): boolean => inline.kind === 'picture' && inline.layout === 'floating';
    const ordered = [...inlines.filter(isFloating), ...inlines.filter((inline) => !isFloating(inline))];

    return ordered.map((inline) => {
        if (inline.kind === 'line-break') {
            return h('br');
        }

        if (inline.kind === 'picture') {
            return renderPicture(inline, urlOf);
        }

        return FORMAT_TAGS.reduceRight<Node>(
            (child, [bit, tag]) => ((inline.format & bit) === 0 ? child : h(tag, { children: [child] })),
            document.createTextNode(inline.text),
        );
    });
}

// The image at the size the document gives it, cropped as the document crops it; a placeholder when the browser
// can't draw it, or when its bytes turn out not to decode.
function renderPicture(picture: DocPicture, urlOf: PictureUrlOf | null): HTMLElement {
    const label = picture.format != null && NAMED_FORMATS.has(picture.format)
        ? `Picture (${picture.format.toUpperCase()})`
        : 'Picture';

    // A TIFF still here didn't decode to PNG, and the browser can't draw it.
    if (picture.image == null || urlOf == null || picture.image.mimeType === 'image/tiff') {
        return picturePlaceholder(document, label);
    }

    const image = h('img', {
        class: 'document-picture-image',
        dataset: { layout: picture.layout },
        attrs: {
            src: urlOf(picture.image),
            alt: picture.description ?? 'Picture',
            width: picture.width == null ? null : Math.max(1, Math.round(picture.width)),
            height: picture.height == null ? null : Math.max(1, Math.round(picture.height)),
        },
    });
    const { crop } = picture;

    if (crop != null) {
        const inset = [crop.top, crop.right, crop.bottom, crop.left]
            .map((share) => `${(share * 100).toFixed(2)}%`)
            .join(' ');
        image.style.setProperty('object-view-box', `inset(${inset})`);
    }

    image.addEventListener('error', () => image.replaceWith(picturePlaceholder(document, label)), { once: true });

    return image;
}

function renderTable(table: DocTable, urlOf: PictureUrlOf | null): HTMLTableElement {
    const headerCount = table.rows.findIndex((row) => !row.isHeader);
    const headerRows = headerCount < 0 ? table.rows : table.rows.slice(0, headerCount);
    const bodyRows = table.rows.slice(headerRows.length);
    const row = (cells: DocTable['rows'][number]['cells'], tag: 'td' | 'th'): HTMLTableRowElement => h('tr', {
        children: cells.map((cell) => h(tag, { children: [renderParagraphs(cell.paragraphs, urlOf)] })),
    });

    return h('table', {
        children: [
            headerRows.length === 0 ? null : h('thead', { children: headerRows.map((header) => row(header.cells, 'th')) }),
            bodyRows.length === 0 ? null : h('tbody', { children: bodyRows.map((body) => row(body.cells, 'td')) }),
        ],
    });
}
