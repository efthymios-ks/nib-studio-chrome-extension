import { extension } from '../fs/fileEntry.js';
import { errorMessage } from '../errorMessage.js';
import type { DocBlock, DocInline } from './docModel.js';
import { OLD_WORD_MESSAGE, readDocFile, WORD_PROBLEM_TITLES, type DocVersion } from './docReader.js';
import { renderDocxToHtmlAsync, sanitizeHtml } from './docxRenderer.js';
import type { OfficeEncryption } from './encryption/officeEncryptionTypes.js';
import { readOoxmlDetails } from './ooxmlDetails.js';
import { sanitizePage, type PageGeometry } from './pageGeometry.js';
import { extractRtfText } from './rtfText.js';
import { decodePlainText, sniffWordContainer, type WordContainer } from './wordFormat.js';
import type { WordProperties } from './wordProperties.js';
import { openZipPackage } from './zipPackage.js';

// What the Word preview shows: HTML from a DOCX or a web page, blocks read from a .doc or from text,
// or a message saying why the file can't be shown.
export type WordContent =
    | { readonly kind: 'html'; readonly source: 'docx' | 'web'; readonly html: string; readonly page: PageGeometry }
    | {
        readonly kind: 'blocks';
        readonly source: 'doc' | 'text';
        readonly blocks: ReadonlyArray<DocBlock>;
        readonly page: PageGeometry;
    }
    | { readonly kind: 'message'; readonly title: string; readonly message: string };

export interface WordDocumentView {
    readonly content: WordContent;
    // The file's real format for the Info panel, such as "Word 97–2003 document (DOC)".
    readonly formatLabel: string;
    readonly properties: WordProperties | null;
    // A line above the page, such as that an RTF file shows as plain text.
    readonly note: string | null;
    // An encrypted file's encryption: its content is then a message, and the preview asks for the password.
    readonly encryption?: OfficeEncryption;
}

const OOXML_LABELS: Readonly<Record<string, string>> = Object.freeze({
    docx: 'Word document (DOCX)',
    docm: 'Word macro-enabled document (DOCM)',
    dotx: 'Word template (DOTX)',
    dotm: 'Word macro-enabled template (DOTM)',
});

// The Info panel's type for an older Word file names its version, as its message does.
const OLD_WORD_LABEL = 'Word for Windows 1.0–2.0 document (DOC)';

// The Info panel's type of a compound Word file, by its version and whether it is a template.
interface DocLabels {
    readonly document: string;
    readonly template: string;
}

const DOC_LABELS: Readonly<Record<DocVersion, DocLabels>> = Object.freeze({
    word97: { document: 'Word 97–2003 document (DOC)', template: 'Word 97–2003 template (DOT)' },
    word6: { document: 'Word 6.0/95 document (DOC)', template: 'Word 6.0/95 template (DOT)' },
});

const WORD6_NOTE = 'This document is in the Word 6.0/95 format; its text shows without styles, lists or pictures.';

const OTHER_PACKAGES: Readonly<Record<string, string>> = Object.freeze({
    excel: 'It is an Excel workbook.',
    powerpoint: 'It is a PowerPoint presentation.',
    other: 'It is a ZIP archive without a Word document in it.',
});

type ContainerLoader = (bytes: Uint8Array, fileName: string) => Promise<WordDocumentView> | WordDocumentView;

// Each kind of content a file with a Word name can hold, whatever its extension says.
const LOADERS: Readonly<Record<WordContainer, ContainerLoader>> = Object.freeze({
    ooxml: loadOoxmlAsync,
    compound: loadCompound,
    'early-word': () => messageView({
        title: WORD_PROBLEM_TITLES['old-format'],
        message: OLD_WORD_MESSAGE,
        formatLabel: OLD_WORD_LABEL,
    }),
    rtf: (bytes) => textView({
        text: extractRtfText(decodePlainText(bytes)),
        formatLabel: 'Rich Text Format (RTF)',
        note: 'This file is in Rich Text Format; its text shows without formatting.',
    }),
    html: (bytes) => ({
        content: { kind: 'html', source: 'web', html: sanitizeHtml(decodePlainText(bytes)), page: sanitizePage(null) },
        formatLabel: 'Web page (HTML)',
        properties: null,
        note: 'This file is a web page with a Word name; it shows without its styles and pictures.',
    }),
    xml: () => messageView({
        title: 'This document is Word XML',
        message: 'Word 2003 XML and flat XML documents don\'t preview here. Open the file in Word and save it as .docx to preview it.',
        formatLabel: 'XML',
    }),
    text: (bytes) => textView({
        text: decodePlainText(bytes),
        formatLabel: 'Plain text',
        note: 'This file holds plain text, not a Word document.',
    }),
    empty: () => messageView({ title: 'This document is empty', message: 'The file has no content.', formatLabel: 'Empty file' }),
    binary: () => messageView({
        title: WORD_PROBLEM_TITLES['not-word'],
        message: 'Its content isn\'t a Word format the preview reads; it may be damaged.',
        formatLabel: 'Unknown',
    }),
});

// Reads a file with a Word name by what its bytes hold, so a renamed DOCX, RTF or text file still shows.
export async function loadWordDocumentAsync(bytes: Uint8Array, fileName: string): Promise<WordDocumentView> {
    return await LOADERS[sniffWordContainer(bytes)](bytes, fileName);
}

async function loadOoxmlAsync(bytes: Uint8Array, fileName: string): Promise<WordDocumentView> {
    const label = OOXML_LABELS[extension(fileName)] ?? OOXML_LABELS['docx'] ?? '';
    const zip = openZipPackage(bytes);

    if (zip == null) {
        return messageView({
            title: WORD_PROBLEM_TITLES.damaged,
            message: 'The file is damaged: its ZIP directory can\'t be read.',
            formatLabel: label,
        });
    }

    const details = readOoxmlDetails(zip);

    if (details.kind !== 'word') {
        return messageView({
            title: WORD_PROBLEM_TITLES['not-word'],
            message: OTHER_PACKAGES[details.kind] ?? '',
            formatLabel: 'ZIP archive',
            properties: details.properties,
        });
    }

    try {
        const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        const rendered = await renderDocxToHtmlAsync(arrayBuffer, { imageSizes: details.imageSizes });

        return {
            content: { kind: 'html', source: 'docx', html: rendered.html, page: sanitizePage(details.page) },
            formatLabel: label,
            properties: details.properties,
            note: null,
        };
    }
    catch (error) {
        const reason = errorMessage(error);

        return messageView({
            title: WORD_PROBLEM_TITLES.damaged,
            message: `The file is damaged: ${reason}`,
            formatLabel: label,
            properties: details.properties,
        });
    }
}

const PROBLEM_LABELS: Readonly<Record<string, string>> = Object.freeze({
    'not-word': 'Office file',
    'old-format': OLD_WORD_LABEL,
});

function loadCompound(bytes: Uint8Array, fileName: string): WordDocumentView {
    const result = readDocFile(bytes);

    if (!result.ok) {
        const view = messageView({
            title: result.title,
            message: result.message,
            formatLabel: problemLabel(result.problem, result.version, fileName),
            properties: result.properties,
        });

        return result.encryption == null ? view : { ...view, encryption: result.encryption };
    }

    const { version, blocks, page, isTemplate } = result.document;
    const labels = DOC_LABELS[version];
    const pictures = countPictures(blocks);

    return {
        content: { kind: 'blocks', source: 'doc', blocks, page },
        formatLabel: isTemplate ? labels.template : labels.document,
        properties: pictures === 0 ? result.properties : { ...result.properties, pictures },
        note: version === 'word6' ? WORD6_NOTE : null,
    };
}

// The type a file that can't be shown gets in the Info panel. An encrypted DOCX is a compound file with no FIB to give
// a version, so its name says which kind of Word file it is.
function problemLabel(problem: string, version: DocVersion | null, fileName: string): string {
    const label = PROBLEM_LABELS[problem];

    if (label != null) {
        return label;
    }

    if (version == null && problem === 'encrypted') {
        return OOXML_LABELS[extension(fileName)] ?? OOXML_LABELS['docx'] ?? '';
    }

    return DOC_LABELS[version ?? 'word97'].document;
}

// The pictures the document stores, those that show as placeholders included; drawn shapes without a picture aren't.
function countPictures(blocks: ReadonlyArray<DocBlock>): number {
    const inParagraph = (inlines: ReadonlyArray<DocInline>): number => (
        inlines.filter((inline) => inline.kind === 'picture' && inline.format != null).length
    );

    return blocks.reduce((total, block) => {
        if (block.kind === 'paragraph') {
            return total + inParagraph(block.inlines);
        }

        if (block.kind === 'table') {
            const cells = block.rows.flatMap((row) => row.cells.flatMap((cell) => cell.paragraphs));

            return total + cells.reduce((sum, paragraph) => sum + inParagraph(paragraph.inlines), 0);
        }

        return total;
    }, 0);
}

interface MessageViewInput {
    readonly title: string;
    readonly message: string;
    readonly formatLabel: string;
    // What the file says about itself, when it could be read although its content can't be shown.
    readonly properties?: WordProperties | null;
}

function messageView({ title, message, formatLabel, properties }: MessageViewInput): WordDocumentView {
    return { content: { kind: 'message', title, message }, formatLabel, properties: properties ?? null, note: null };
}

interface TextViewInput {
    readonly text: string;
    readonly formatLabel: string;
    readonly note: string;
}

// Plain text as paragraphs, one per line.
function textView({ text, formatLabel, note }: TextViewInput): WordDocumentView {
    const blocks: DocBlock[] = text.split(/\r\n|\r|\n/).map((line) => ({
        kind: 'paragraph',
        role: 'body',
        level: 0,
        alignment: 'start',
        list: null,
        inlines: line === '' ? [] : [{ kind: 'text', text: line, format: 0 }],
    }));

    return { content: { kind: 'blocks', source: 'text', blocks, page: sanitizePage(null) }, formatLabel, properties: null, note };
}
