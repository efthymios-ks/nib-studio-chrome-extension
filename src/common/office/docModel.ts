// The content of a legacy Word document as the preview shows it: paragraphs, tables and breaks, without layout.

export const TEXT_FORMAT = Object.freeze({
    bold: 1,
    italic: 2,
    underline: 4,
    strike: 8,
    superscript: 16,
    subscript: 32,
});

export type DocInline =
    | { readonly kind: 'text'; readonly text: string; readonly format: number }
    | { readonly kind: 'line-break' }
    | DocPicture;

// The formats a Word file stores pictures in. The browser draws the bitmaps but not the metafiles or TIFF,
// which the preview decodes itself.
export type DocPictureFormat = 'png' | 'jpeg' | 'gif' | 'bmp' | 'tiff' | 'emf' | 'wmf' | 'pict';

// A picture's bytes in a format the browser draws, or TIFF for the preview to decode, read once and shared by every
// place that shows it.
export interface DocImage {
    readonly mimeType: string;
    readonly bytes: Uint8Array<ArrayBuffer>;
}

// How much of the image each side crops away, as a share of its width or height.
export interface DocCrop {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
}

export interface DocPicture {
    readonly kind: 'picture';
    // An inline picture flows with the text; a floating one shows as a block at its anchor paragraph.
    readonly layout: 'inline' | 'floating';
    // What the document stores, when its picture was found; it names the placeholder of a picture that can't show.
    readonly format: DocPictureFormat | null;
    // Null shows a placeholder: a metafile, a shape without a picture, damaged data or a picture past the size limit.
    readonly image: DocImage | null;
    // The size the document shows the picture at, in CSS pixels at 100%; null keeps the image's own size.
    readonly width: number | null;
    readonly height: number | null;
    readonly crop: DocCrop | null;
    // The alternative text the author gave the picture.
    readonly description: string | null;
}

export type DocParagraphRole = 'body' | 'title' | 'subtitle' | 'heading';

export type DocAlignment = 'start' | 'center' | 'end' | 'justify';

export type DocListFormat = 'bullet' | 'decimal' | 'upper-roman' | 'lower-roman' | 'upper-alpha' | 'lower-alpha';

export interface DocListMark {
    // Which list the item belongs to, so separate lists stay apart.
    readonly id: number;
    // 0 for the outermost level.
    readonly level: number;
    readonly format: DocListFormat;
    readonly start: number;
}

export interface DocParagraph {
    readonly kind: 'paragraph';
    readonly role: DocParagraphRole;
    // 1 to 6 for headings, 0 otherwise.
    readonly level: number;
    readonly alignment: DocAlignment;
    readonly list: DocListMark | null;
    readonly inlines: ReadonlyArray<DocInline>;
}

export interface DocTableCell {
    readonly paragraphs: ReadonlyArray<DocParagraph>;
}

export interface DocTableRow {
    readonly isHeader: boolean;
    readonly cells: ReadonlyArray<DocTableCell>;
}

export interface DocTable {
    readonly kind: 'table';
    readonly rows: ReadonlyArray<DocTableRow>;
}

interface DocPageBreak {
    readonly kind: 'page-break';
}

export type DocBlock = DocParagraph | DocTable | DocPageBreak;
