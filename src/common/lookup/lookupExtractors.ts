import { extension } from '../fs/fileEntry.js';
import { resolveFileType } from '../fs/fileTypes.js';
import { decodeCodePage, isDoubleByteCodePage } from '../office/codePage.js';
import { hasCompoundSignature } from '../office/compoundFile.js';
import type { DocBlock, DocParagraph } from '../office/docModel.js';
import { readDocFile } from '../office/docReader.js';
import { readWorkbookEncryption } from '../office/encryption/officeEncryption.js';
import { extractRtfText } from '../office/rtfText.js';
import { decodePlainText, sniffWordContainer, type WordContainer } from '../office/wordFormat.js';
import { readWorkbook, visibleSheetsOf } from '../office/xlsxLoader.js';
import { openZipPackage, type ZipPackage } from '../office/zipPackage.js';
import { decodeTextBytes } from '../text/textEncoding.js';
import { decodeReferences, type TextSection } from './lookupText.js';

// How Lookup reads the text of each kind of file, picked by its extension, with the studio's own readers:
// another kind is one more entry in EXTRACTORS.

// Larger files are looked up by name only.
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export type Extraction =
    // The text, and whether its lines are the file's own, so a match has a line number;
    // a workbook's lines are its rows, sheet after sheet, and its sections say where each sheet starts.
    | { readonly kind: 'text'; readonly text: string; readonly keepsLines: boolean; readonly sections?: ReadonlyArray<TextSection> }
    // Protected with a password; its text can be read only from the plain bytes of a tab that unlocked it.
    | { readonly kind: 'locked' }
    // Nothing to search but the name.
    | { readonly kind: 'name-only' };

// What reading a file takes, known from its name and size before any byte is read.
export type ReadPlan =
    | 'name-only'
    // A PDF, whose text pdf.js reads on the page's side.
    | 'pdf'
    // A file of an unknown type, read only when its first bytes look like text.
    | 'sniff'
    | 'read';

export interface ExtractOptions {
    // The Windows code page that text which isn't UTF-8 is read in, such as 1253 for Greek.
    readonly codePage: number;
    // The bytes are the plain ones a password gave, so they are read without checking for a password again.
    readonly isUnlocked?: boolean;
}

interface Extractor {
    readonly extensions: ReadonlyArray<string>;
    readonly extract: (bytes: Uint8Array, options: ExtractOptions) => Extraction;
}

const EXTRACTORS: ReadonlyArray<Extractor> = [
    {
        extensions: ['docx', 'docm', 'dotx', 'dotm', 'doc'],
        extract: (bytes, options) => readWordText(bytes, options),
    },
    {
        extensions: ['xlsx', 'xls', 'xlsm', 'xlsb', 'xltx', 'xltm', 'ods'],
        extract: (bytes, options) => readWorkbookText(bytes, options),
    },
    {
        extensions: ['pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm'],
        extract: (bytes) => readPackageText(bytes, SLIDE_PARTS),
    },
    {
        extensions: ['odt', 'odp', 'odg'],
        extract: (bytes) => readPackageText(bytes, OPEN_DOCUMENT_PARTS),
    },
    {
        extensions: ['html', 'htm', 'xhtml'],
        extract: (bytes, options) => linedText(htmlText(decodeText(bytes, options.codePage))),
    },
];

const EXTRACTOR_BY_EXTENSION: ReadonlyMap<string, Extractor> = new Map(
    EXTRACTORS.flatMap((extractor) => extractor.extensions.map((name) => [name, extractor] as const)),
);

export function readPlanFor(name: string, size: number): ReadPlan {
    if (size > MAX_FILE_BYTES) {
        return 'name-only';
    }

    const type = resolveFileType(name);

    if (type.id === 'pdf') {
        return 'pdf';
    }

    if (EXTRACTOR_BY_EXTENSION.has(extension(name)) || type.isText) {
        return 'read';
    }

    // Images, audio, video, fonts, archives and presentations in the old binary format keep only their names.
    return type.id === 'unknown' ? 'sniff' : 'name-only';
}

// The text of a file Lookup reads by its bytes; a file of an unknown type that passed the sniff reads as text.
export function extractText(name: string, bytes: Uint8Array, options: ExtractOptions): Extraction {
    const extractor = EXTRACTOR_BY_EXTENSION.get(extension(name));

    if (extractor != null) {
        return extractor.extract(bytes, options);
    }

    return linedText(decodeText(bytes, options.codePage));
}

// Text read as the editor reads it: by its byte order mark, else as UTF-8, else in the single-byte code page
// it reads best in, with `codePage`, the browser's own, winning a tie. One difference: when the browser's own
// code page takes two bytes a character, such as Shift_JIS, text that isn't UTF-8 reads in it here,
// while the editor weighs single-byte code pages only.
export function decodeText(bytes: Uint8Array, codePage: number): string {
    const decoded = decodeTextBytes(bytes, codePage);

    if (decoded.encoding.startsWith('windows-') && isDoubleByteCodePage(codePage)) {
        return decodeCodePage(bytes, codePage);
    }

    return decoded.text;
}

function linedText(text: string): Extraction {
    return { kind: 'text', text, keepsLines: true };
}

function documentText(text: string): Extraction {
    return { kind: 'text', text, keepsLines: false };
}

const HIDDEN_HTML = /<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/giu;
const HTML_COMMENT = /<!--[\s\S]*?-->/gu;
const TAG = /<[^>]*>/gu;
const LINE_BREAKS = /\r\n|\r|\n/gu;

// Markup turns into white space that keeps its line breaks, so the text keeps the lines of the page's source.
function blankOut(markup: string): string {
    const breaks = markup.match(LINE_BREAKS);

    return breaks == null ? ' ' : breaks.join('');
}

// The text of a page without its tags, scripts, styles and comments.
export function htmlText(source: string): string {
    return decodeReferences(source
        .replace(HTML_COMMENT, blankOut)
        .replace(HIDDEN_HTML, blankOut)
        .replace(TAG, blankOut));
}

// The ends of paragraphs, cells and line breaks in Office and OpenDocument XML, where words part.
const BLOCK_ENDS = /<\/(?:w:p|w:tc|a:p|text:p|text:h|table:table-cell)>|<(?:w:tab|w:br|w:cr|a:br|text:s|text:tab|text:line-break)\b[^>]*\/>/gu;
// Field codes and deleted text, which Word doesn't show.
const UNSHOWN_TEXT = /<(w:instrText|w:delText)\b[^>]*>[\s\S]*?<\/\1>/gu;

// The text of an Office or OpenDocument XML part: runs join up, and paragraphs and cells part with a space.
export function markupText(xml: string): string {
    return decodeReferences(xml
        .replace(UNSHOWN_TEXT, '')
        .replace(BLOCK_ENDS, ' ')
        .replace(TAG, ''));
}

// The parts of a package whose text Lookup reads, in this order, each kind in its natural order.
type PackageParts = ReadonlyArray<RegExp>;

const WORD_PARTS: PackageParts = [
    /^word\/document\.xml$/u,
    /^word\/header\d*\.xml$/u,
    /^word\/footer\d*\.xml$/u,
    /^word\/footnotes\.xml$/u,
    /^word\/endnotes\.xml$/u,
];

const SLIDE_PARTS: PackageParts = [
    /^ppt\/slides\/slide\d+\.xml$/u,
    /^ppt\/notesSlides\/notesSlide\d+\.xml$/u,
];

const OPEN_DOCUMENT_PARTS: PackageParts = [
    /^content\.xml$/u,
];

function partsText(zip: ZipPackage, parts: PackageParts): string {
    const names = [...zip.entries.keys()];

    return parts
        .flatMap((part) => names
            .filter((name) => part.test(name))
            .sort((left, right) => left.localeCompare(right, undefined, { numeric: true })))
        .map((name) => markupText(zip.readText(name) ?? ''))
        .join(' ');
}

// A package protected with a password is an OLE compound file holding the encrypted package rather than a ZIP.
function readPackageText(bytes: Uint8Array, parts: PackageParts): Extraction {
    if (hasCompoundSignature(bytes)) {
        return { kind: 'locked' };
    }

    const zip = openZipPackage(bytes);

    return zip == null ? { kind: 'name-only' } : documentText(partsText(zip, parts));
}

type WordReader = (bytes: Uint8Array, options: ExtractOptions) => Extraction;

// Each kind of content a file with a Word name can hold, as the Word preview tells them apart.
const WORD_READERS: Readonly<Partial<Record<WordContainer, WordReader>>> = Object.freeze({
    ooxml: (bytes: Uint8Array) => readPackageText(bytes, WORD_PARTS),
    compound: (bytes: Uint8Array) => readCompoundWordText(bytes),
    rtf: (bytes: Uint8Array) => documentText(extractRtfText(decodePlainText(bytes))),
    html: (bytes: Uint8Array, options: ExtractOptions) => documentText(htmlText(decodeText(bytes, options.codePage))),
    text: (bytes: Uint8Array, options: ExtractOptions) => documentText(decodeText(bytes, options.codePage)),
});

function readWordText(bytes: Uint8Array, options: ExtractOptions): Extraction {
    const reader = WORD_READERS[sniffWordContainer(bytes)];

    return reader == null ? { kind: 'name-only' } : reader(bytes, options);
}

// A Word 97–2003 document, or an encrypted DOCX, which is a compound file too.
function readCompoundWordText(bytes: Uint8Array): Extraction {
    const result = readDocFile(bytes);

    if (result.ok) {
        return documentText(blocksText(result.document.blocks));
    }

    return result.problem === 'encrypted' ? { kind: 'locked' } : { kind: 'name-only' };
}

function blocksText(blocks: ReadonlyArray<DocBlock>): string {
    return blocks
        .map((block) => {
            if (block.kind === 'paragraph') {
                return paragraphText(block);
            }

            if (block.kind === 'table') {
                return block.rows
                    .flatMap((row) => row.cells.flatMap((cell) => cell.paragraphs.map(paragraphText)))
                    .join(' ');
            }

            return '';
        })
        .join('\n');
}

function paragraphText(paragraph: DocParagraph): string {
    return paragraph.inlines
        .map((inline) => {
            if (inline.kind === 'text') {
                return inline.text;
            }

            return inline.kind === 'line-break' ? ' ' : '';
        })
        .join('');
}

// Every visible sheet, a line per row, so a match reads in the context of its row and names its sheet and row.
// The line breaks inside a cell become spaces, so each row stays one line.
function readWorkbookText(bytes: Uint8Array, options: ExtractOptions): Extraction {
    if (options.isUnlocked !== true && readWorkbookEncryption(bytes) != null) {
        return { kind: 'locked' };
    }

    try {
        const lines: string[] = [];
        const sections: TextSection[] = [];

        for (const sheet of visibleSheetsOf(readWorkbook(bytes))) {
            sections.push({ name: sheet.name, firstLine: lines.length + 1, firstNumber: sheet.firstRow });

            for (const row of sheet.rows) {
                lines.push(row
                    .map((cell) => (cell == null ? '' : String(cell).replace(LINE_BREAKS, ' ')))
                    .filter((cell) => cell !== '')
                    .join(' '));
            }
        }

        return { kind: 'text', text: lines.join('\n'), keepsLines: true, sections };
    }
    catch {
        return { kind: 'name-only' };
    }
}
