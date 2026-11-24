import { errorMessage } from '../errorMessage.js';
import { codePageOfLanguage, decodeCodePage, isDoubleByteCodePage, singleByteCharCodes } from './codePage.js';
import { hasCompoundStream, readCompoundStream, tryReadCompoundFile, type CompoundFile } from './compoundFile.js';
import { NO_LISTS, readListTables, type DocListTables } from './docLists.js';
import {
    TEXT_FORMAT,
    type DocAlignment,
    type DocBlock,
    type DocInline,
    type DocParagraph,
    type DocTableCell,
    type DocTableRow,
} from './docModel.js';
import { createPictureReader, NO_PICTURES, type DocPictureReader } from './docPictures.js';
import {
    applyCharacterSprms,
    applyParagraphSprms,
    applySectionSprms,
    applyWord6CharacterSprms,
    resolveToggle,
    type CharacterSprmValues,
    type ParagraphSprmValues,
} from './docSprms.js';
import { readStyleSheet, resolveCharacterStyle, resolveStyle, type DocStyle, type ResolvedStyle } from './docStyles.js';
import { readDocEncryption } from './encryption/docEncryption.js';
import { readPackageEncryption } from './encryption/officeEncryption.js';
import type { OfficeEncryption } from './encryption/officeEncryptionTypes.js';
import { readSummaryProperties } from './olePropertySet.js';
import { sanitizePage, TWIPS_PER_PIXEL, type PageGeometry } from './pageGeometry.js';
import { EARLY_WORD_IDENTS } from './wordFormat.js';
import type { WordProperties } from './wordProperties.js';

// Reads Word 97–2003 binary documents and templates: the FIB, the piece table, the paragraph and character
// formatting pages, the stylesheet, the list tables and the pictures, into paragraphs and tables. See [MS-DOC].
// Word 6.0 and Word 95 files read as text with their character formatting.

type DocProblem = 'encrypted' | 'old-format' | 'not-word' | 'damaged';

// The binary format that saved the file: Word 97 to 2003, or Word 6.0 and Word 95.
export type DocVersion = 'word97' | 'word6';

interface DocDocument {
    readonly version: DocVersion;
    readonly blocks: ReadonlyArray<DocBlock>;
    readonly page: PageGeometry;
    readonly isTemplate: boolean;
}

export type DocReadResult =
    | { readonly ok: true; readonly document: DocDocument; readonly properties: WordProperties | null }
    | {
        readonly ok: false;
        readonly problem: DocProblem;
        readonly title: string;
        readonly message: string;
        readonly properties: WordProperties | null;
        // The version that saved the file, when its FIB tells it.
        readonly version: DocVersion | null;
        // How an encrypted file opens with its password, or why it can't.
        readonly encryption?: OfficeEncryption;
    };

// The titles of the messages a Word file that can't be shown gets, whatever its format.
export const WORD_PROBLEM_TITLES: Readonly<Record<DocProblem, string>> = Object.freeze({
    'encrypted': 'This document is protected with a password',
    'old-format': 'This document uses an older Word format',
    'not-word': 'This file isn\'t a Word document',
    'damaged': 'This document can\'t be read',
});

// The title of an encrypted document whose encryption the preview can't open.
export const UNSUPPORTED_ENCRYPTION_TITLE = 'This document\'s encryption isn\'t supported';

const PASSWORD_MESSAGE = 'Enter its password to open it.';

// The message of files from Word versions older than Word 6, whose structure the preview doesn't read.
export const OLD_WORD_MESSAGE = 'It was saved by Word 2 or earlier, which the preview doesn\'t read. Open it in Word and save it as .docx to preview it.';

class DocReadError extends Error {
    constructor(readonly problem: DocProblem, message: string, readonly version: DocVersion | null = null) {
        super(message);
    }
}

// The identifier of Word 97 and later files, and the one Word 6 and Word 95 files carry.
const WORD_IDENT = 0xa5ec;
const WORD6_IDENT = 0xa5dc;
// Word 6 writes nFib 0x0065, Word 95 0x0067 or 0x0068 and Word 97 0x00C1; a lower nFib is an older Word still.
const FIRST_WORD6_FIB = 0x0065;
const FIRST_WORD97_FIB = 0x00c0;
const FKP_SIZE = 512;
const NO_LIST_INDEX = 0x07ff;

const FIB_FLAGS = Object.freeze({
    template: 0x0001,
    complex: 0x0004,
    encrypted: 0x0100,
    tableStream: 0x0200,
});

// Positions of offset and length pairs in the FIB's FibRgFcLcb blob; a Word 6 FIB holds the first ones in the same order.
const FIB_ENTRIES = Object.freeze({
    styles: 1,
    sections: 6,
    characterPages: 12,
    paragraphPages: 13,
    pieceTable: 33,
    floatingAnchors: 40,
    drawings: 50,
    lists: 73,
    listInstances: 74,
});

// A Word 6 FIB holds its offset and length pairs from here, up to the piece table's.
const WORD6_PAIRS_AT = 0x58;
const WORD6_PAIR_COUNT = FIB_ENTRIES.pieceTable + 1;

const CHARACTER = Object.freeze({
    cellMark: 0x07,
    paragraphMark: 0x0d,
    lineBreak: 0x0b,
    pageBreak: 0x0c,
    columnBreak: 0x0e,
    tab: 0x09,
    picture: 0x01,
    drawing: 0x08,
    fieldBegin: 0x13,
    fieldSeparator: 0x14,
    fieldEnd: 0x15,
    nonBreakingHyphen: 0x1e,
    softHyphen: 0x1f,
    symbol: 0x28,
});

const OTHER_OFFICE_STREAMS: ReadonlyArray<readonly [string, string]> = [
    ['Workbook', 'It is an Excel workbook.'],
    ['Book', 'It is an Excel workbook.'],
    ['PowerPoint Document', 'It is a PowerPoint presentation.'],
    ['VisioDocument', 'It is a Visio drawing.'],
];

export function readDocFile(bytes: Uint8Array): DocReadResult {
    const container = tryReadCompoundFile(bytes);

    if (container == null) {
        return failure('damaged', 'The file is not a complete Office file; it may be damaged or cut short.', null);
    }

    const properties = tryReadProperties(container);

    const packageEncryption = readPackageEncryption(container);

    if (packageEncryption != null) {
        return encryptedFailure(packageEncryption, properties, null);
    }

    const wordDocument = readCompoundStream(container, 'WordDocument');

    if (wordDocument == null) {
        const other = OTHER_OFFICE_STREAMS.find(([name]) => hasCompoundStream(container, name));

        return failure('not-word', `${other?.[1] ?? 'It is an Office file without Word text.'} Only Word documents preview here.`, properties);
    }

    try {
        return { ok: true, document: readWordDocument(container, wordDocument), properties };
    }
    catch (error) {
        if (error instanceof DocReadError && error.problem === 'encrypted') {
            const encryption = readDocEncryption({ bytes, container, wordDocument, isWord6: error.version === 'word6' });

            return encryptedFailure(encryption, properties, error.version);
        }

        if (error instanceof DocReadError) {
            return failure(error.problem, error.message, properties, error.version);
        }

        return failure('damaged', `The file is damaged: ${errorMessage(error)}`, properties);
    }
}

function failure(
    problem: DocProblem,
    message: string,
    properties: WordProperties | null,
    version: DocVersion | null = null,
): DocReadResult {
    return { ok: false, problem, title: WORD_PROBLEM_TITLES[problem], message, properties, version };
}

// An encrypted document asks for its password, or says why its encryption can't be opened.
function encryptedFailure(encryption: OfficeEncryption, properties: WordProperties | null, version: DocVersion | null): DocReadResult {
    const isSupported = encryption.kind === 'password';

    return {
        ok: false,
        problem: 'encrypted',
        title: isSupported ? WORD_PROBLEM_TITLES.encrypted : UNSUPPORTED_ENCRYPTION_TITLE,
        message: isSupported ? PASSWORD_MESSAGE : `${encryption.reason} Open it in Word to read it.`,
        properties,
        version,
        encryption,
    };
}

function tryReadProperties(container: CompoundFile): WordProperties | null {
    try {
        const summary = readCompoundStream(container, '\u0005SummaryInformation');
        const documentSummary = readCompoundStream(container, '\u0005DocumentSummaryInformation');

        return readSummaryProperties(summary, documentSummary);
    }
    catch {
        return null;
    }
}

interface FibEntry {
    readonly offset: number;
    readonly length: number;
}

interface Fib {
    readonly version: DocVersion;
    readonly flags: number;
    // The language the text is written in (an LCID), which gives a Word 6 file's code page.
    readonly languageId: number;
    // A Word 6 file's character set: 0 for Windows, 256 for the Macintosh.
    readonly characterSet: number;
    // Where the text of a Word 6 file without a piece table sits in the WordDocument stream.
    readonly textStart: number;
    readonly textEnd: number;
    readonly mainTextLength: number;
    entry(index: number): FibEntry;
}

function readFib(wordDocument: Uint8Array, view: DataView): Fib {
    if (wordDocument.length < 0x40) {
        throw new DocReadError('damaged', 'The Word text stream is too short to hold a document.');
    }

    const ident = view.getUint16(0, true);
    const nFib = view.getUint16(2, true);

    if (EARLY_WORD_IDENTS.has(ident)) {
        throw new DocReadError('old-format', OLD_WORD_MESSAGE);
    }

    if (ident !== WORD_IDENT && ident !== WORD6_IDENT) {
        throw new DocReadError('damaged', 'Its Word text stream doesn\'t start like a Word document.');
    }

    // The nFib tells the version, whichever of the two identifiers the file carries.
    if (nFib < FIRST_WORD6_FIB) {
        throw new DocReadError('old-format', OLD_WORD_MESSAGE);
    }

    const header = {
        flags: view.getUint16(0x0a, true),
        languageId: view.getUint16(0x06, true),
        characterSet: view.getUint16(0x14, true),
        textStart: view.getUint32(0x18, true),
        textEnd: view.getUint32(0x1c, true),
    };

    const version: DocVersion = nFib < FIRST_WORD97_FIB || ident === WORD6_IDENT ? 'word6' : 'word97';

    // Encryption leaves only the start of the FIB readable, so an encrypted file of any version stops here,
    // before the rest of the FIB, the text and the formatting are read; once unlocked, the plain file is read instead.
    if ((header.flags & FIB_FLAGS.encrypted) !== 0) {
        throw new DocReadError('encrypted', PASSWORD_MESSAGE, version);
    }

    if (version === 'word6') {
        return readWord6Fib(wordDocument, view, header);
    }

    const shortCount = view.getUint16(0x20, true);
    const longCountAt = 0x22 + shortCount * 2;
    const longsAt = longCountAt + 2;
    const longCount = longCountAt + 2 <= wordDocument.length ? view.getUint16(longCountAt, true) : 0;
    const pairCountAt = longsAt + longCount * 4;

    if (longCount < 4 || pairCountAt + 2 > wordDocument.length) {
        throw new DocReadError('damaged', 'Its file information block is damaged.');
    }

    const pairCount = view.getUint16(pairCountAt, true);
    const pairsAt = pairCountAt + 2;

    if (pairsAt + pairCount * 8 > wordDocument.length) {
        throw new DocReadError('damaged', 'Its file information block is cut short.');
    }

    return {
        ...header,
        version: 'word97',
        mainTextLength: view.getInt32(longsAt + 12, true),
        entry: (index) => (index < pairCount ? pairAt(view, pairsAt + index * 8) : NO_ENTRY),
    };
}

type FibHeader = Pick<Fib, 'flags' | 'languageId' | 'characterSet' | 'textStart' | 'textEnd'>;

// A Word 6 FIB has fixed fields: the main text's length, then the offset and length pairs.
function readWord6Fib(wordDocument: Uint8Array, view: DataView, header: FibHeader): Fib {
    const pairsEnd = WORD6_PAIRS_AT + WORD6_PAIR_COUNT * 8;

    if (wordDocument.length < pairsEnd) {
        throw new DocReadError('damaged', 'Its file information block is cut short.');
    }

    return {
        ...header,
        version: 'word6',
        mainTextLength: view.getInt32(0x34, true),
        entry: (index) => (index < WORD6_PAIR_COUNT ? pairAt(view, WORD6_PAIRS_AT + index * 8) : NO_ENTRY),
    };
}

const NO_ENTRY: FibEntry = Object.freeze({ offset: 0, length: 0 });

function pairAt(view: DataView, at: number): FibEntry {
    return { offset: view.getUint32(at, true), length: view.getUint32(at + 4, true) };
}

interface Piece {
    readonly cpStart: number;
    readonly cpEnd: number;
    // Byte offset of the piece's first character in the WordDocument stream.
    readonly offset: number;
    readonly isCompressed: boolean;
    readonly modifiers: Uint8Array | null;
}

// The piece table sits in the table stream, or in a Word 6 file's WordDocument stream.
function readPieceTable(
    table: Uint8Array,
    view: DataView,
    clx: FibEntry,
    version: DocVersion,
): Piece[] {
    const end = Math.min(table.length, clx.offset + clx.length);
    const modifierGroups: Uint8Array[] = [];
    let position = clx.offset;

    while (position < end) {
        const type = table[position];

        if (type === 1 && position + 3 <= end) {
            const size = view.getInt16(position + 1, true);

            if (size < 0 || position + 3 + size > end) {
                break;
            }

            modifierGroups.push(table.subarray(position + 3, position + 3 + size));
            position += 3 + size;
            continue;
        }

        if (type === 2 && position + 5 <= end) {
            const size = view.getUint32(position + 1, true);

            const plc = { offset: position + 5, length: Math.min(size, end - position - 5) };

            return readPieces(view, plc, version === 'word6' ? null : modifierGroups);
        }

        break;
    }

    throw new DocReadError('damaged', 'Its piece table, which says where the text is, is damaged.');
}

// Word 97 marks its 8-bit pieces with a bit of the offset. Without modifier groups the pieces are Word 6 ones:
// all 8-bit text at plain byte offsets, their modifiers in older sprm codes, which are left out.
function readPieces(view: DataView, plc: FibEntry, modifierGroups: ReadonlyArray<Uint8Array> | null): Piece[] {
    const count = Math.floor((plc.length - 4) / 12);

    if (count < 1) {
        throw new DocReadError('damaged', 'Its piece table is empty.');
    }

    const pieces: Piece[] = [];
    const descriptorsAt = plc.offset + (count + 1) * 4;

    for (let index = 0; index < count; index += 1) {
        const cpStart = view.getUint32(plc.offset + index * 4, true);
        const cpEnd = view.getUint32(plc.offset + (index + 1) * 4, true);
        const descriptor = descriptorsAt + index * 8;
        const location = view.getUint32(descriptor + 2, true);
        const modifier = view.getUint16(descriptor + 6, true);
        const isWord6 = modifierGroups == null;
        const isCompressed = isWord6 || (location & 0x40000000) !== 0;
        const offset = isWord6 ? location : location & 0x3fffffff;

        if (cpEnd <= cpStart) {
            continue;
        }

        pieces.push({
            cpStart,
            cpEnd,
            offset: isCompressed && !isWord6 ? offset >>> 1 : offset,
            isCompressed,
            // A Prm1 points at a group of modifiers; a Prm0 holds one packed sprm, which the preview doesn't need.
            modifiers: (modifier & 1) === 1 ? modifierGroups?.[modifier >>> 1] ?? null : null,
        });
    }

    return pieces.sort((left, right) => left.cpStart - right.cpStart);
}

function pieceAt(pieces: ReadonlyArray<Piece>, cp: number): Piece | null {
    let low = 0;
    let high = pieces.length - 1;

    while (low <= high) {
        const middle = (low + high) >>> 1;
        const piece = pieces[middle];

        if (piece == null) {
            return null;
        }

        if (cp < piece.cpStart) {
            high = middle - 1;
        }
        else if (cp >= piece.cpEnd) {
            low = middle + 1;
        }
        else {
            return piece;
        }
    }

    return null;
}

function byteOffsetOf(piece: Piece, cp: number): number {
    return piece.offset + (cp - piece.cpStart) * (piece.isCompressed ? 1 : 2);
}

// The character of each byte of a Word 97 file's 8-bit pieces.
const CP1252_CODES = singleByteCharCodes(1252);

// The main document's characters as UTF-16 codes; `byteCodes` gives the character of each byte of an 8-bit piece.
function readText(
    wordDocument: Uint8Array,
    pieces: ReadonlyArray<Piece>,
    length: number,
    byteCodes: Uint16Array,
): Uint16Array {
    const codes = new Uint16Array(length);

    for (const piece of pieces) {
        const end = Math.min(length, piece.cpEnd);

        for (let cp = Math.max(0, piece.cpStart); cp < end; cp += 1) {
            const at = byteOffsetOf(piece, cp);

            if (piece.isCompressed) {
                if (at >= wordDocument.length) {
                    break;
                }

                codes[cp] = byteCodes[wordDocument[at] ?? 0] ?? 0;
                continue;
            }

            if (at + 1 >= wordDocument.length) {
                break;
            }

            codes[cp] = (wordDocument[at] ?? 0) | ((wordDocument[at + 1] ?? 0) << 8);
        }
    }

    return codes;
}

interface FormattingRun<T> {
    readonly start: number;
    readonly end: number;
    readonly value: T;
}

// The page numbers of the formatting pages a bin table lists: four bytes each, or two in a Word 6 file.
function readPageNumbers(
    table: Uint8Array,
    view: DataView,
    bins: FibEntry,
    version: DocVersion,
): number[] {
    const size = version === 'word6' ? 2 : 4;
    const count = Math.floor((bins.length - 4) / (4 + size));

    if (count < 1 || bins.offset + bins.length > table.length) {
        return [];
    }

    const numbersAt = bins.offset + (count + 1) * 4;

    return Array.from({ length: count }, (_, index) => (
        size === 2 ? view.getUint16(numbersAt + index * 2, true) : view.getUint32(numbersAt + index * 4, true) & 0x3fffff
    ));
}

interface FormattingPages<T> {
    readonly wordDocument: Uint8Array;
    readonly view: DataView;
    // The page numbers a bin table lists.
    readonly pages: ReadonlyArray<number>;
    // The size of each run's entry after the offsets: 1 for character pages, 13 for paragraph pages.
    readonly entrySize: number;
    readonly readEntry: (page: Uint8Array, wordOffset: number) => T;
}

// Reads every run of a set of formatting pages (FKPs): the stream offsets each covers and what it holds.
function readFormattingPages<T>(source: FormattingPages<T>): Array<FormattingRun<T>> {
    const { wordDocument, view, pages, entrySize, readEntry } = source;
    const runs: Array<FormattingRun<T>> = [];

    for (const pageNumber of pages) {
        const pageStart = pageNumber * FKP_SIZE;

        if (pageStart + FKP_SIZE > wordDocument.length) {
            continue;
        }

        const page = wordDocument.subarray(pageStart, pageStart + FKP_SIZE);
        const runCount = page[FKP_SIZE - 1] ?? 0;
        const entriesAt = (runCount + 1) * 4;

        if (entriesAt + runCount * entrySize > FKP_SIZE - 1) {
            continue;
        }

        for (let index = 0; index < runCount; index += 1) {
            runs.push({
                start: view.getUint32(pageStart + index * 4, true),
                end: view.getUint32(pageStart + (index + 1) * 4, true),
                value: readEntry(page, page[entriesAt + index * entrySize] ?? 0),
            });
        }
    }

    return runs.sort((left, right) => left.start - right.start);
}

function readCharacterEntry(page: Uint8Array, wordOffset: number): CharacterSprmValues {
    return applyCharacterSprms({}, characterGrpprl(page, wordOffset));
}

function readWord6CharacterEntry(page: Uint8Array, wordOffset: number): CharacterSprmValues {
    return applyWord6CharacterSprms({}, characterGrpprl(page, wordOffset));
}

// A run's character sprms in a formatting page; an offset of 0 means the run has none.
function characterGrpprl(page: Uint8Array, wordOffset: number): Uint8Array {
    if (wordOffset === 0) {
        return new Uint8Array();
    }

    const at = wordOffset * 2;
    const size = page[at] ?? 0;

    return page.subarray(at + 1, Math.min(FKP_SIZE - 1, at + 1 + size));
}

interface ParagraphEntry {
    readonly styleIndex: number;
    readonly values: ParagraphSprmValues;
}

function readParagraphEntry(page: Uint8Array, wordOffset: number): ParagraphEntry {
    if (wordOffset === 0) {
        return { styleIndex: 0, values: {} };
    }

    const at = wordOffset * 2;
    const firstSize = page[at] ?? 0;
    const data = firstSize !== 0
        ? page.subarray(at + 1, Math.min(FKP_SIZE - 1, at + 1 + firstSize * 2 - 1))
        : page.subarray(at + 2, Math.min(FKP_SIZE - 1, at + 2 + (page[at + 1] ?? 0) * 2));

    if (data.length < 2) {
        return { styleIndex: 0, values: {} };
    }

    return { styleIndex: (data[0] ?? 0) | ((data[1] ?? 0) << 8), values: applyParagraphSprms({}, data.subarray(2)) };
}

function runAt<T>(runs: ReadonlyArray<FormattingRun<T>>, offset: number): FormattingRun<T> | null {
    let low = 0;
    let high = runs.length - 1;
    let found: FormattingRun<T> | null = null;

    while (low <= high) {
        const middle = (low + high) >>> 1;
        const run = runs[middle];

        if (run == null) {
            break;
        }

        if (run.start <= offset) {
            found = run;
            low = middle + 1;
        }
        else {
            high = middle - 1;
        }
    }

    return found != null && offset < found.end ? found : null;
}

// Character formatting laid out by character position, in order, from the pages' stream offsets and the pieces.
function characterSpans(
    pieces: ReadonlyArray<Piece>,
    runs: ReadonlyArray<FormattingRun<CharacterSprmValues>>,
    length: number,
): Array<FormattingRun<CharacterSprmValues>> {
    const spans: Array<FormattingRun<CharacterSprmValues>> = [];

    for (const piece of pieces) {
        const width = piece.isCompressed ? 1 : 2;
        const end = Math.min(length, piece.cpEnd);
        const pieceValues = piece.modifiers == null ? null : applyCharacterSprms({}, piece.modifiers);
        let cp = piece.cpStart;

        while (cp < end) {
            const offset = byteOffsetOf(piece, cp);
            const run = runAt(runs, offset);
            const runEnd = run == null ? offset + width : run.end;
            const next = Math.min(end, Math.max(cp + 1, piece.cpStart + Math.ceil((runEnd - piece.offset) / width)));
            const values = run?.value ?? {};
            spans.push({ start: cp, end: next, value: pieceValues == null ? values : { ...values, ...pieceValues } });
            cp = next;
        }
    }

    return spans;
}

interface ParagraphInfo {
    readonly style: ResolvedStyle;
    readonly values: ParagraphSprmValues;
}

const ALIGNMENTS: ReadonlyArray<DocAlignment> = ['start', 'center', 'end', 'justify', 'justify', 'justify'];

interface ReaderContext {
    readonly wordDocument: Uint8Array;
    readonly pieces: ReadonlyArray<Piece>;
    readonly paragraphRuns: ReadonlyArray<FormattingRun<ParagraphEntry>>;
    readonly styles: ReadonlyArray<DocStyle | null>;
    readonly lists: DocListTables;
    readonly resolvedStyles: Map<number, ResolvedStyle>;
    readonly characterStyles: Map<number, CharacterSprmValues>;
    readonly pictures: DocPictureReader;
}

function readWordDocument(container: CompoundFile, wordDocument: Uint8Array): DocDocument {
    const view = new DataView(wordDocument.buffer, wordDocument.byteOffset, wordDocument.byteLength);
    const fib = readFib(wordDocument, view);

    if (fib.mainTextLength < 0 || fib.mainTextLength > wordDocument.length) {
        throw new DocReadError('damaged', 'Its text length is out of range.', fib.version);
    }

    try {
        return fib.version === 'word6'
            ? readWord6Document(wordDocument, view, fib)
            : readWord97Document(container, wordDocument, view, fib);
    }
    catch (error) {
        // A file that fails once its version is known still says which version it is.
        if (error instanceof DocReadError) {
            throw new DocReadError(error.problem, error.message, fib.version);
        }

        const reason = errorMessage(error);

        throw new DocReadError('damaged', `The file is damaged: ${reason}`, fib.version);
    }
}

function readWord97Document(
    container: CompoundFile,
    wordDocument: Uint8Array,
    view: DataView,
    fib: Fib,
): DocDocument {
    const tableName = (fib.flags & FIB_FLAGS.tableStream) !== 0 ? '1Table' : '0Table';
    const table = readCompoundStream(container, tableName);

    if (table == null) {
        throw new DocReadError('damaged', `Its ${tableName} stream, which holds the document's structure, is missing.`);
    }

    const tableView = new DataView(table.buffer, table.byteOffset, table.byteLength);
    const pieces = readPieceTable(table, tableView, fib.entry(FIB_ENTRIES.pieceTable), 'word97');
    const length = Math.min(fib.mainTextLength, pieces.at(-1)?.cpEnd ?? 0);
    const codes = readText(wordDocument, pieces, length, CP1252_CODES);
    const characterRuns = safely(() => readFormattingPages({
        wordDocument,
        view,
        pages: readPageNumbers(table, tableView, fib.entry(FIB_ENTRIES.characterPages), 'word97'),
        entrySize: 1,
        readEntry: readCharacterEntry,
    }), []);
    const context: ReaderContext = {
        wordDocument,
        pieces,
        paragraphRuns: safely(() => readFormattingPages({
            wordDocument,
            view,
            pages: readPageNumbers(table, tableView, fib.entry(FIB_ENTRIES.paragraphPages), 'word97'),
            entrySize: 13,
            readEntry: readParagraphEntry,
        }), []),
        styles: safely(() => readStyleSheet(table, fib.entry(FIB_ENTRIES.styles)), []),
        lists: safely(() => readListTables(table, fib.entry(FIB_ENTRIES.lists), fib.entry(FIB_ENTRIES.listInstances)), NO_LISTS),
        resolvedStyles: new Map(),
        characterStyles: new Map(),
        pictures: createPictureReader({
            wordDocument,
            table,
            data: readCompoundStream(container, 'Data'),
            anchors: fib.entry(FIB_ENTRIES.floatingAnchors),
            drawings: fib.entry(FIB_ENTRIES.drawings),
        }),
    };

    return {
        version: 'word97',
        blocks: buildBlocks(context, codes, characterSpans(pieces, characterRuns, length)),
        page: safely(() => readPage(wordDocument, table, tableView, fib.entry(FIB_ENTRIES.sections)), sanitizePage(null)),
        isTemplate: (fib.flags & FIB_FLAGS.template) !== 0,
    };
}

// A Word 6 or Word 95 file keeps everything in its WordDocument stream: the text, in one run from the FIB's text start
// unless a piece table says otherwise, and its character formatting in older sprm codes.
// Its styles, lists, page setup and pictures are in older forms the preview leaves out.
function readWord6Document(wordDocument: Uint8Array, view: DataView, fib: Fib): DocDocument {
    const pieces = (fib.flags & FIB_FLAGS.complex) !== 0
        ? readPieceTable(wordDocument, view, fib.entry(FIB_ENTRIES.pieceTable), 'word6')
        : [contiguousPiece(wordDocument, fib)];
    const length = Math.min(fib.mainTextLength, pieces.at(-1)?.cpEnd ?? 0);
    const codePage = codePageOfLanguage(fib.languageId, fib.characterSet);
    // Text in a double-byte code page has fewer characters than bytes, so the formatting's byte offsets don't line up.
    const isDoubleByte = isDoubleByteCodePage(codePage);
    const codes = isDoubleByte
        ? readDoubleByteText(wordDocument, pieces, length, codePage)
        : readText(wordDocument, pieces, length, singleByteCharCodes(codePage));
    const characterRuns = isDoubleByte ? [] : safely(() => readFormattingPages({
        wordDocument,
        view,
        pages: readPageNumbers(wordDocument, view, fib.entry(FIB_ENTRIES.characterPages), 'word6'),
        entrySize: 1,
        readEntry: readWord6CharacterEntry,
    }), []);
    const context: ReaderContext = {
        wordDocument,
        pieces,
        paragraphRuns: [],
        styles: [],
        lists: NO_LISTS,
        resolvedStyles: new Map(),
        characterStyles: new Map(),
        pictures: NO_PICTURES,
    };

    return {
        version: 'word6',
        blocks: buildBlocks(context, codes, characterSpans(pieces, characterRuns, codes.length)),
        page: sanitizePage(null),
        isTemplate: (fib.flags & FIB_FLAGS.template) !== 0,
    };
}

function contiguousPiece(wordDocument: Uint8Array, fib: Fib): Piece {
    if (fib.textStart > fib.textEnd || fib.textEnd > wordDocument.length) {
        throw new DocReadError('damaged', 'Its text is out of range.');
    }

    return { cpStart: 0, cpEnd: fib.textEnd - fib.textStart, offset: fib.textStart, isCompressed: true, modifiers: null };
}

function readDoubleByteText(
    wordDocument: Uint8Array,
    pieces: ReadonlyArray<Piece>,
    length: number,
    codePage: number,
): Uint16Array {
    const text = pieces
        .filter((piece) => piece.cpStart < length)
        .map((piece) => {
            const end = piece.offset + Math.min(length, piece.cpEnd) - piece.cpStart;

            return decodeCodePage(wordDocument.subarray(piece.offset, Math.min(wordDocument.length, end)), codePage);
        })
        .join('');

    return Uint16Array.from({ length: text.length }, (_, index) => text.charCodeAt(index));
}

// Formatting is a bonus over the text, so a part of it that can't be read is left out rather than failing the file.
function safely<T>(read: () => T, fallback: T): T {
    try {
        return read();
    }
    catch {
        return fallback;
    }
}

function readPage(wordDocument: Uint8Array, table: Uint8Array, tableView: DataView, sections: FibEntry): PageGeometry {
    const count = Math.floor((sections.length - 4) / 16);

    if (count < 1 || sections.offset + sections.length > table.length) {
        return sanitizePage(null);
    }

    const descriptor = sections.offset + (count + 1) * 4;
    const sepxAt = tableView.getInt32(descriptor + 2, true);
    const hasSepx = sepxAt >= 0 && sepxAt + 2 <= wordDocument.length;
    const sepxSize = hasSepx ? (wordDocument[sepxAt] ?? 0) | ((wordDocument[sepxAt + 1] ?? 0) << 8) : 0;
    const values = hasSepx ? applySectionSprms({}, wordDocument.subarray(sepxAt + 2, sepxAt + 2 + sepxSize)) : {};

    // Section defaults from [MS-DOC]: an 8.5 by 11-inch page, 1.25-inch side margins and 1-inch top and bottom margins.
    return sanitizePage({
        width: (values.pageWidth ?? 12240) / TWIPS_PER_PIXEL,
        height: (values.pageHeight ?? 15840) / TWIPS_PER_PIXEL,
        marginLeft: (values.marginLeft ?? 1800) / TWIPS_PER_PIXEL,
        marginRight: (values.marginRight ?? 1800) / TWIPS_PER_PIXEL,
        marginTop: (values.marginTop ?? 1440) / TWIPS_PER_PIXEL,
        marginBottom: (values.marginBottom ?? 1440) / TWIPS_PER_PIXEL,
    });
}

function paragraphInfoAt(context: ReaderContext, cp: number): ParagraphInfo {
    const piece = pieceAt(context.pieces, cp);
    const run = piece == null ? null : runAt(context.paragraphRuns, byteOffsetOf(piece, cp));
    const styleIndex = run?.value.styleIndex ?? 0;
    const style = cached(context.resolvedStyles, styleIndex, () => resolveStyle(context.styles, styleIndex));
    const pieceValues = piece?.modifiers == null ? {} : applyParagraphSprms({}, piece.modifiers);

    return {
        style,
        values: { ...style.paragraph, ...run?.value.values, ...pieceValues },
    };
}

function characterStyleOf(context: ReaderContext, index: number | undefined): CharacterSprmValues {
    if (index == null) {
        return {};
    }

    return cached(context.characterStyles, index, () => resolveCharacterStyle(context.styles, index));
}

// Styles resolve once per document, however many paragraphs and runs use them.
function cached<T>(cache: Map<number, T>, key: number, resolve: () => T): T {
    const known = cache.get(key);

    if (known != null) {
        return known;
    }

    const value = resolve();
    cache.set(key, value);

    return value;
}

// Items of the paragraph being read; their formatting resolves once its mark gives the paragraph style.
const LINE_BREAK_CODE = -1;
const INLINE_PICTURE_CODE = -2;
const FLOATING_PICTURE_CODE = -3;

interface PendingItem {
    readonly code: number;
    readonly values: CharacterSprmValues;
    // The character's position in the main text, which a floating picture's anchor names.
    readonly cp: number;
}

function buildInlines(context: ReaderContext, items: ReadonlyArray<PendingItem>, info: ParagraphInfo): DocInline[] {
    const inlines: DocInline[] = [];
    // Headings carry their look in the heading itself, so only body paragraphs pass the style's formatting on.
    const base = info.style.role === 'body' ? info.style : null;
    let text = '';
    let textFormat = 0;

    const flush = (): void => {
        if (text !== '') {
            inlines.push({ kind: 'text', text, format: textFormat });
            text = '';
        }
    };

    for (const item of items) {
        const characterStyle = characterStyleOf(context, item.values.characterStyle);

        if (
            resolveToggle(item.values.hidden, resolveToggle(characterStyle.hidden, false))
            || resolveToggle(item.values.deleted, false)
        ) {
            continue;
        }

        const inline = inlineOf(context, item);

        if (inline != null) {
            flush();
            inlines.push(inline);
            continue;
        }

        const format = formatOf(item.values, characterStyle, base);

        if (format !== textFormat) {
            flush();
            textFormat = format;
        }

        text += String.fromCharCode(item.code);
    }

    flush();

    return inlines;
}

// A break or a picture, which stands on its own between runs of text.
function inlineOf(context: ReaderContext, item: PendingItem): DocInline | null {
    if (item.code === LINE_BREAK_CODE) {
        return { kind: 'line-break' };
    }

    if (item.code === INLINE_PICTURE_CODE) {
        return context.pictures.inline(item.values.pictureLocation ?? null);
    }

    if (item.code === FLOATING_PICTURE_CODE) {
        return context.pictures.floating(item.cp);
    }

    return null;
}

function formatOf(values: CharacterSprmValues, characterStyle: CharacterSprmValues, base: ResolvedStyle | null): number {
    const flags: ReadonlyArray<readonly [boolean, number]> = [
        [resolveToggle(values.bold, resolveToggle(characterStyle.bold, base?.bold ?? false)), TEXT_FORMAT.bold],
        [resolveToggle(values.italic, resolveToggle(characterStyle.italic, base?.italic ?? false)), TEXT_FORMAT.italic],
        [resolveToggle(values.strike, resolveToggle(characterStyle.strike, base?.strike ?? false)), TEXT_FORMAT.strike],
        [(values.underline ?? characterStyle.underline ?? (base?.underline === true ? 1 : 0)) !== 0, TEXT_FORMAT.underline],
        [(values.position ?? characterStyle.position) === 1, TEXT_FORMAT.superscript],
        [(values.position ?? characterStyle.position) === 2, TEXT_FORMAT.subscript],
    ];

    return flags.reduce((format, [isOn, bit]) => (isOn ? format | bit : format), 0);
}

function paragraphOf(context: ReaderContext, items: ReadonlyArray<PendingItem>, info: ParagraphInfo): DocParagraph {
    const listIndex = info.values.listIndex ?? 0;
    const list = listIndex > 0 && listIndex < NO_LIST_INDEX ? context.lists.markFor(listIndex, info.values.listLevel ?? 0) : null;

    return {
        kind: 'paragraph',
        role: info.style.role,
        level: info.style.level,
        alignment: ALIGNMENTS[info.values.justification ?? 0] ?? 'start',
        list,
        inlines: buildInlines(context, items, info),
    };
}

function isEmptyParagraph(block: DocBlock | undefined): boolean {
    return block?.kind === 'paragraph' && block.list == null && block.inlines.length === 0;
}

// Gathers paragraphs into blocks, and the paragraphs of table cells into rows and tables.
class BlockBuilder {
    readonly blocks: DocBlock[] = [];
    private rows: DocTableRow[] | null = null;
    private cells: DocTableCell[] = [];
    private cellParagraphs: DocParagraph[] = [];

    paragraph(paragraph: DocParagraph): void {
        this.closeTable();
        this.blocks.push(paragraph);
    }

    cellParagraph(paragraph: DocParagraph): void {
        this.rows ??= [];
        this.cellParagraphs.push(paragraph);
    }

    endCell(paragraph: DocParagraph): void {
        this.cellParagraph(paragraph);
        this.cells.push({ paragraphs: this.cellParagraphs });
        this.cellParagraphs = [];
    }

    endRow(isHeader: boolean): void {
        this.rows ??= [];

        if (this.cellParagraphs.length > 0) {
            this.cells.push({ paragraphs: this.cellParagraphs });
            this.cellParagraphs = [];
        }

        if (this.cells.length > 0) {
            this.rows.push({ isHeader, cells: this.cells });
        }

        this.cells = [];
    }

    hasOpenCells(): boolean {
        return this.cells.length > 0;
    }

    pageBreak(): void {
        this.closeTable();
        this.blocks.push({ kind: 'page-break' });
    }

    // The blocks, without the empty paragraphs every document ends with.
    finish(): DocBlock[] {
        this.closeTable();

        while (this.blocks.length > 0 && isEmptyParagraph(this.blocks.at(-1))) {
            this.blocks.pop();
        }

        return this.blocks;
    }

    private closeTable(): void {
        if (this.rows == null) {
            return;
        }

        this.endRow(false);

        if (this.rows.length > 0) {
            this.blocks.push({ kind: 'table', rows: this.rows });
        }

        this.rows = null;
    }
}

function buildBlocks(
    context: ReaderContext,
    codes: Uint16Array,
    spans: ReadonlyArray<FormattingRun<CharacterSprmValues>>,
): DocBlock[] {
    const builder = new BlockBuilder();
    // For each open field, whether its result has started; the code before the separator is never shown.
    const fields: boolean[] = [];
    const items: PendingItem[] = [];
    let spanIndex = 0;
    let previousMark = 0;

    const valuesAt = (cp: number): CharacterSprmValues => {
        while (spanIndex < spans.length && (spans[spanIndex]?.end ?? 0) <= cp) {
            spanIndex += 1;
        }

        const span = spans[spanIndex];

        return span != null && span.start <= cp ? span.value : {};
    };

    const endParagraph = (cp: number, mark: number): void => {
        const info = paragraphInfoAt(context, cp);
        const paragraphItems = items.splice(0);
        const paragraph = paragraphOf(context, paragraphItems, info);
        const isEmpty = paragraphItems.length === 0;
        const inTable = info.values.inTable === true || (info.values.depth ?? 0) >= 1;

        if (mark === CHARACTER.cellMark) {
            // When the formatting says nothing about the table, a row end shows as an empty cell straight after another cell.
            const isRowEnd = inTable || info.values.rowEnd != null
                ? info.values.rowEnd === true
                : isEmpty && previousMark === CHARACTER.cellMark && builder.hasOpenCells();

            if (isRowEnd) {
                builder.endRow(info.values.headerRow === true);
            }
            else {
                builder.endCell(paragraph);
            }

            previousMark = mark;

            return;
        }

        previousMark = mark;

        if (inTable) {
            // Nested tables are flattened into their outer cell, so their row ends are dropped.
            if (info.values.innerRowEnd !== true) {
                builder.cellParagraph(paragraph);
            }

            return;
        }

        if (mark === CHARACTER.pageBreak && isEmpty) {
            return;
        }

        builder.paragraph(paragraph);
    };

    for (let cp = 0; cp < codes.length; cp += 1) {
        const code = codes[cp] ?? 0;

        if (code === CHARACTER.paragraphMark || code === CHARACTER.cellMark) {
            endParagraph(cp, code);
            continue;
        }

        if (code === CHARACTER.fieldBegin) {
            fields.push(false);
            continue;
        }

        if (code === CHARACTER.fieldSeparator) {
            if (fields.length > 0) {
                fields[fields.length - 1] = true;
            }

            continue;
        }

        if (code === CHARACTER.fieldEnd) {
            fields.pop();
            continue;
        }

        if (fields.includes(false)) {
            continue;
        }

        const values = valuesAt(cp);

        if (code === CHARACTER.pageBreak) {
            if (paragraphInfoAt(context, cp).values.inTable === true) {
                items.push({ code: LINE_BREAK_CODE, values, cp });
                continue;
            }

            endParagraph(cp, code);
            builder.pageBreak();
            continue;
        }

        const itemCode = itemCodeOf(code, values);

        if (itemCode != null) {
            items.push({ code: itemCode, values, cp });
        }
    }

    if (items.length > 0) {
        endParagraph(Math.max(0, codes.length - 1), CHARACTER.paragraphMark);
    }

    return builder.finish();
}

// What a character adds to the paragraph: text, a break or a picture, or nothing for marks the preview leaves out.
function itemCodeOf(code: number, values: CharacterSprmValues): number | null {
    if (code === CHARACTER.lineBreak || code === CHARACTER.columnBreak) {
        return LINE_BREAK_CODE;
    }

    if (code === CHARACTER.picture || code === CHARACTER.drawing) {
        if (values.special === 0) {
            return null;
        }

        return code === CHARACTER.picture ? INLINE_PICTURE_CODE : FLOATING_PICTURE_CODE;
    }

    if (code === CHARACTER.nonBreakingHyphen) {
        return 0x2011;
    }

    if (code === CHARACTER.tab) {
        return code;
    }

    // A special "(" is a symbol from a symbol font, such as a Wingdings bullet, which has no text of its own.
    if (code < 0x20 || code === CHARACTER.softHyphen || (code === CHARACTER.symbol && values.special === 1)) {
        return null;
    }

    return code;
}
