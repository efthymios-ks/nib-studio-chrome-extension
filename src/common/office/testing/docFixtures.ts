import { CFB } from 'xlsx';

// Builds small Word 97–2003 files for tests: a hand-made FIB, piece table, formatting pages, stylesheet, list tables
// and property sets, in a compound file written by SheetJS. Offsets follow [MS-DOC] and [MS-OLEPS].

interface FixturePiece {
    readonly text: string;
    // 8-bit Windows-1252 text; otherwise UTF-16.
    readonly compressed?: boolean;
}

interface FixtureParagraph {
    readonly style?: number;
    readonly sprms?: ReadonlyArray<ReadonlyArray<number>>;
}

interface FixtureCharacters {
    // Character positions in the whole text, end excluded.
    readonly start: number;
    readonly end: number;
    readonly sprms: ReadonlyArray<ReadonlyArray<number>>;
}

interface FixtureStyle {
    readonly sti: number;
    readonly name: string;
    // 1 paragraph, 2 character.
    readonly kind?: number;
    readonly base?: number;
    readonly paragraphSprms?: ReadonlyArray<ReadonlyArray<number>>;
    readonly characterSprms?: ReadonlyArray<ReadonlyArray<number>>;
}

interface FixtureList {
    readonly id: number;
    // Number format (nfc) and start of each level; one level makes a simple list.
    readonly levels: ReadonlyArray<{ readonly format: number; readonly start?: number }>;
}

export interface DocFixture {
    readonly pieces: ReadonlyArray<FixturePiece>;
    // Paragraph formatting by paragraph number, counting paragraph and cell marks from 0.
    readonly paragraphs?: ReadonlyMap<number, FixtureParagraph>;
    readonly characters?: ReadonlyArray<FixtureCharacters>;
    readonly styles?: ReadonlyArray<FixtureStyle | null>;
    readonly lists?: ReadonlyArray<FixtureList>;
    // The section's sprms, such as the page width.
    readonly section?: ReadonlyArray<ReadonlyArray<number>>;
    readonly ident?: number;
    readonly fib?: number;
    readonly flags?: number;
    readonly mainTextLength?: number;
    readonly omitTableStream?: boolean;
    readonly summary?: Uint8Array;
    readonly documentSummary?: Uint8Array;
    // The Data stream, which holds inline pictures.
    readonly data?: ReadonlyArray<number>;
    readonly drawing?: FixtureDrawing;
    // Bytes left free at the start of the table stream, where an encrypted file keeps its encryption header.
    readonly tableReserved?: number;
}

// Floating pictures: bytes appended to the WordDocument stream, where blip store entries may point (the delay stream),
// then the anchors (PlcfSpa) and drawing data (OfficeArtContent) for the table stream, built knowing where those bytes went.
interface FixtureDrawing {
    readonly delay?: ReadonlyArray<number>;
    readonly build: (delayAt: number) => { readonly anchors: ReadonlyArray<number>; readonly content: ReadonlyArray<number> };
}

const FIB_PAIRS = 93;
const PAIRS_AT = 0x9a;
const TEXT_AT = 0x400;
const FKP_SIZE = 512;

// A sprm as bytes: its code, then the operand; a variable operand gets its length byte.
export function sprm(code: number, ...operand: number[]): number[] {
    const isVariable = code >>> 13 === 6;

    return [code & 0xff, code >>> 8, ...(isVariable ? [operand.length] : []), ...operand];
}

export function u16(value: number): number[] {
    return [value & 0xff, (value >>> 8) & 0xff];
}

export function u32(value: number): number[] {
    return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

class ByteWriter {
    readonly bytes: number[] = [];

    get length(): number {
        return this.bytes.length;
    }

    push(values: ReadonlyArray<number>): number {
        const at = this.bytes.length;
        this.bytes.push(...values);

        return at;
    }

    padTo(length: number): void {
        while (this.bytes.length < length) {
            this.bytes.push(0);
        }
    }

    setU16(at: number, value: number): void {
        this.bytes.splice(at, 2, ...u16(value));
    }

    setU32(at: number, value: number): void {
        this.bytes.splice(at, 4, ...u32(value));
    }
}

interface PlacedPiece {
    readonly cpStart: number;
    readonly cpEnd: number;
    readonly offset: number;
    readonly compressed: boolean;
}

// The byte range in the WordDocument stream of characters [start, end), split where pieces split.
function byteRanges(pieces: ReadonlyArray<PlacedPiece>, start: number, end: number): Array<readonly [number, number]> {
    const ranges: Array<readonly [number, number]> = [];

    for (const piece of pieces) {
        const from = Math.max(start, piece.cpStart);
        const to = Math.min(end, piece.cpEnd);

        if (from < to) {
            const width = piece.compressed ? 1 : 2;
            ranges.push([piece.offset + (from - piece.cpStart) * width, piece.offset + (to - piece.cpStart) * width]);
        }
    }

    return ranges;
}

export function buildDocFile(fixture: DocFixture): Uint8Array<ArrayBuffer> {
    const word = new ByteWriter();
    const table = new ByteWriter();
    table.padTo(fixture.tableReserved ?? 0);
    word.padTo(TEXT_AT);

    const placed: PlacedPiece[] = [];
    let cp = 0;

    for (const piece of fixture.pieces) {
        const compressed = piece.compressed ?? false;
        const offset = word.push(compressed ? cp1252Bytes(piece.text) : utf16Bytes(piece.text));
        placed.push({ cpStart: cp, cpEnd: cp + piece.text.length, offset, compressed });
        cp += piece.text.length;
    }

    const text = fixture.pieces.map((piece) => piece.text).join('');
    const pairs = new Map<number, readonly [number, number]>();

    // Paragraph formatting: one run per piece-part of each paragraph.
    const paragraphRuns: FixtureRun[] = [];
    let paragraphStart = 0;
    let paragraphNumber = 0;

    for (let index = 0; index < text.length; index += 1) {
        if (text[index] !== '\r' && text[index] !== '\u0007') {
            continue;
        }

        const props = fixture.paragraphs?.get(paragraphNumber);
        const data = [...u16(props?.style ?? 0), ...(props?.sprms ?? []).flat()];

        for (const [start, end] of byteRanges(placed, paragraphStart, index + 1)) {
            paragraphRuns.push({ start, end, data });
        }

        paragraphStart = index + 1;
        paragraphNumber += 1;
    }

    const characterRuns = (fixture.characters ?? []).flatMap((run) => byteRanges(placed, run.start, run.end)
        .map(([start, end]) => ({ start, end, data: run.sprms.flat() })));

    word.padTo(Math.ceil(word.length / FKP_SIZE) * FKP_SIZE);
    const characterPage = writeCharacterPage(word, characterRuns);
    const paragraphPage = writeParagraphPage(word, paragraphRuns);

    const sectionGrpprl = (fixture.section ?? []).flat();
    const sepxAt = word.push([...u16(sectionGrpprl.length), ...sectionGrpprl]);

    if (fixture.drawing != null) {
        const drawing = fixture.drawing.build(word.push(fixture.drawing.delay ?? []));
        const anchorsAt = table.push(drawing.anchors);
        pairs.set(40, [anchorsAt, drawing.anchors.length]);
        const contentAt = table.push(drawing.content);
        pairs.set(50, [contentAt, drawing.content.length]);
    }

    pairs.set(12, writeBinTable(table, characterRuns, characterPage));
    pairs.set(13, writeBinTable(table, paragraphRuns, paragraphPage));

    const clxAt = table.push([
        0x02,
        ...u32(4 * (placed.length + 1) + 8 * placed.length),
        ...placed.flatMap((piece) => u32(piece.cpStart)),
        ...u32(placed.at(-1)?.cpEnd ?? 0),
        ...placed.flatMap((piece) => [
            0, 0,
            ...u32(piece.compressed ? (piece.offset * 2) | 0x40000000 : piece.offset),
            0, 0,
        ]),
    ]);
    pairs.set(33, [clxAt, table.length - clxAt]);

    const sectionAt = table.push([...u32(0), ...u32(cp), 0, 0, ...u32(sepxAt), 0, 0, ...u32(0)]);
    pairs.set(6, [sectionAt, table.length - sectionAt]);

    if (fixture.styles != null) {
        const at = table.push(styleSheet(fixture.styles));
        pairs.set(1, [at, table.length - at]);
    }

    if (fixture.lists != null) {
        const listsAt = table.push([...u16(fixture.lists.length), ...fixture.lists.flatMap(listDefinition)]);
        pairs.set(73, [listsAt, table.length - listsAt]);
        table.push(fixture.lists.flatMap((list) => list.levels.flatMap(listLevel)));
        const instances = fixture.lists.flatMap((list) => [...u32(list.id), ...new Array(12).fill(0)]);
        const instancesAt = table.push([...u32(fixture.lists.length), ...instances]);
        pairs.set(74, [instancesAt, table.length - instancesAt]);
    }

    writeFib(word, fixture, cp, pairs);

    const container = CFB.utils.cfb_new();
    const tableName = ((fixture.flags ?? 0x0200) & 0x0200) !== 0 ? '1Table' : '0Table';
    CFB.utils.cfb_add(container, 'WordDocument', Uint8Array.from(word.bytes));

    if (fixture.omitTableStream !== true) {
        CFB.utils.cfb_add(container, tableName, Uint8Array.from(table.bytes));
    }

    if (fixture.summary != null) {
        CFB.utils.cfb_add(container, '\u0005SummaryInformation', fixture.summary);
    }

    if (fixture.documentSummary != null) {
        CFB.utils.cfb_add(container, '\u0005DocumentSummaryInformation', fixture.documentSummary);
    }

    if (fixture.data != null) {
        CFB.utils.cfb_add(container, 'Data', Uint8Array.from(fixture.data));
    }

    return compoundBytes(container);
}

export interface Word6Fixture {
    // 8-bit text in the file's code page; a string is Windows-1252 or ASCII.
    readonly text: string | ReadonlyArray<number>;
    // Splits the text into pieces of a piece table at these character positions, stored out of order; none stores it whole.
    readonly pieceBreaks?: ReadonlyArray<number>;
    readonly characters?: ReadonlyArray<FixtureCharacters>;
    readonly languageId?: number;
    readonly ident?: number;
    readonly fib?: number;
    readonly flags?: number;
    readonly summary?: Uint8Array;
}

const WORD6_TEXT_AT = 0x300;

// A Word 6 or Word 95 file: a fixed FIB, the text, then the formatting page, its bin table and any piece table,
// all in the WordDocument stream. Character sprms use Word 6's one-byte codes.
export function buildWord6File(fixture: Word6Fixture): Uint8Array<ArrayBuffer> {
    const word = new ByteWriter();
    word.padTo(WORD6_TEXT_AT);
    const bytes = typeof fixture.text === 'string' ? cp1252Bytes(fixture.text) : [...fixture.text];
    const breaks = [0, ...(fixture.pieceBreaks ?? []), bytes.length];
    const pieces: PlacedPiece[] = [];

    if (fixture.pieceBreaks == null) {
        word.push(bytes);
        pieces.push({ cpStart: 0, cpEnd: bytes.length, offset: WORD6_TEXT_AT, compressed: true });
    }
    else {
        // The pieces go in reverse order, so reading them in stream order would garble the text.
        for (let index = breaks.length - 2; index >= 0; index -= 1) {
            const start = breaks[index] ?? 0;
            const end = breaks[index + 1] ?? 0;
            const offset = word.push(bytes.slice(start, end));
            pieces.unshift({ cpStart: start, cpEnd: end, offset, compressed: true });
        }
    }

    const textEnd = word.length;
    const runs = (fixture.characters ?? []).flatMap((run) => byteRanges(pieces, run.start, run.end)
        .map(([start, end]) => ({ start, end, data: run.sprms.flat() })));
    word.padTo(Math.ceil(word.length / FKP_SIZE) * FKP_SIZE);
    const page = writeCharacterPage(word, runs);
    const first = runs.length === 0 ? WORD6_TEXT_AT : Math.min(...runs.map((run) => run.start));
    const last = runs.length === 0 ? textEnd : Math.max(...runs.map((run) => run.end));
    const binAt = word.push([...u32(first), ...u32(last), ...u16(page)]);
    const clx = [
        0x02,
        ...u32(4 * (pieces.length + 1) + 8 * pieces.length),
        ...pieces.flatMap((piece) => u32(piece.cpStart)),
        ...u32(pieces.at(-1)?.cpEnd ?? 0),
        ...pieces.flatMap((piece) => [0, 0, ...u32(piece.offset), 0, 0]),
    ];
    const clxAt = fixture.pieceBreaks == null ? 0 : word.push(clx);
    const isComplex = fixture.pieceBreaks != null;

    word.setU16(0, fixture.ident ?? 0xa5dc);
    word.setU16(2, fixture.fib ?? 0x0065);
    word.setU16(0x06, fixture.languageId ?? 0x0409);
    word.setU16(0x0a, (fixture.flags ?? 0) | (isComplex ? 0x0004 : 0));
    word.setU32(0x18, WORD6_TEXT_AT);
    word.setU32(0x1c, isComplex ? WORD6_TEXT_AT : textEnd);
    word.setU32(0x34, bytes.length);
    word.setU32(0xb8, binAt);
    word.setU32(0xbc, 10);
    word.setU32(0x160, clxAt);
    word.setU32(0x164, isComplex ? clx.length : 0);

    const container = CFB.utils.cfb_new();
    CFB.utils.cfb_add(container, 'WordDocument', Uint8Array.from(word.bytes));

    if (fixture.summary != null) {
        CFB.utils.cfb_add(container, '\u0005SummaryInformation', fixture.summary);
    }

    return compoundBytes(container);
}

// A Word 6 sprm as bytes: its one-byte code, then its operand.
export function word6Sprm(code: number, ...operand: number[]): number[] {
    return [code, ...operand];
}

// A compound file holding only the given streams.
export function buildCompoundFile(streams: Readonly<Record<string, Uint8Array>>): Uint8Array<ArrayBuffer> {
    const container = CFB.utils.cfb_new();

    for (const [name, content] of Object.entries(streams)) {
        CFB.utils.cfb_add(container, name, content);
    }

    return compoundBytes(container);
}

function compoundBytes(container: unknown): Uint8Array<ArrayBuffer> {
    const written = CFB.write(container, { type: 'array', fileType: 'cfb' }) as ArrayLike<number> | ArrayBuffer;

    return written instanceof ArrayBuffer ? new Uint8Array(written) : Uint8Array.from(written);
}

function writeFib(
    word: ByteWriter,
    fixture: DocFixture,
    textLength: number,
    pairs: ReadonlyMap<number, readonly [number, number]>,
): void {
    word.setU16(0, fixture.ident ?? 0xa5ec);
    word.setU16(2, fixture.fib ?? 0x00c1);
    word.setU16(0x0a, fixture.flags ?? 0x0200);
    word.setU16(0x20, 14);
    word.setU16(0x3e, 22);
    word.setU32(0x40 + 12, fixture.mainTextLength ?? textLength);
    word.setU16(0x98, FIB_PAIRS);

    for (const [index, [offset, length]] of pairs) {
        word.setU32(PAIRS_AT + index * 8, offset);
        word.setU32(PAIRS_AT + index * 8 + 4, length);
    }
}

// Runs in a formatting page are contiguous, each ending where the next starts, so gaps become runs without formatting.
function contiguous(runs: ReadonlyArray<FixtureRun>): FixtureRun[] {
    const sorted = [...runs].sort((left, right) => left.start - right.start);
    const filled: FixtureRun[] = [];

    for (const run of sorted) {
        const previous = filled.at(-1);

        if (previous != null && previous.end < run.start) {
            filled.push({ start: previous.end, end: run.start, data: null });
        }

        filled.push(run);
    }

    return filled;
}

interface FixtureRun {
    readonly start: number;
    readonly end: number;
    readonly data: number[] | null;
}

function writeCharacterPage(word: ByteWriter, given: ReadonlyArray<FixtureRun>): number {
    const runs = contiguous(given);
    const page = new Array<number>(FKP_SIZE).fill(0);
    let dataEnd = FKP_SIZE - 1;

    runs.forEach((run, index) => {
        page.splice(index * 4, 4, ...u32(run.start));
        page.splice((index + 1) * 4, 4, ...u32(run.end));

        if (run.data == null) {
            return;
        }

        const size = run.data.length + 1;
        dataEnd = (dataEnd - size) & ~1;
        page.splice(dataEnd, size, run.data.length, ...run.data);
        page[(runs.length + 1) * 4 + index] = dataEnd / 2;
    });
    page[FKP_SIZE - 1] = runs.length;

    return word.push(page) / FKP_SIZE;
}

function writeParagraphPage(word: ByteWriter, given: ReadonlyArray<FixtureRun>): number {
    const runs = contiguous(given);
    const page = new Array<number>(FKP_SIZE).fill(0);
    let dataEnd = FKP_SIZE - 1;

    runs.forEach((run, index) => {
        page.splice(index * 4, 4, ...u32(run.start));
        page.splice((index + 1) * 4, 4, ...u32(run.end));

        if (run.data == null) {
            return;
        }

        // An odd length is stored as its count of words less a byte; an even one after a zero byte.
        const encoded = run.data.length % 2 === 1
            ? [(run.data.length + 1) / 2, ...run.data]
            : [0, run.data.length / 2, ...run.data];
        dataEnd = (dataEnd - encoded.length) & ~1;
        page.splice(dataEnd, encoded.length, ...encoded);
        page[(runs.length + 1) * 4 + index * 13] = dataEnd / 2;
    });
    page[FKP_SIZE - 1] = runs.length;

    return word.push(page) / FKP_SIZE;
}

function writeBinTable(
    table: ByteWriter,
    runs: ReadonlyArray<{ readonly start: number; readonly end: number }>,
    page: number,
): readonly [number, number] {
    const start = runs[0]?.start ?? 0;
    const end = runs.at(-1)?.end ?? 0;
    const at = table.push([...u32(start), ...u32(end), ...u32(page)]);

    return [at, 12];
}

function styleSheet(styles: ReadonlyArray<FixtureStyle | null>): number[] {
    const header = [...u16(styles.length), ...u16(10), ...new Array(14).fill(0)];
    const bytes = [...u16(header.length), ...header];

    for (const style of styles) {
        if (style == null) {
            bytes.push(...u16(0));
            continue;
        }

        const kind = style.kind ?? 1;
        const base = [
            ...u16(style.sti),
            ...u16(kind | ((style.base ?? 0x0fff) << 4)),
            ...u16(kind === 1 ? 2 : 1),
            ...u16(0),
            ...u16(0),
        ];
        const name = [...u16(style.name.length), ...utf16Bytes(style.name), 0, 0];
        const upxs: number[][] = kind === 1
            ? [[...u16(0), ...(style.paragraphSprms ?? []).flat()], (style.characterSprms ?? []).flat()]
            : [(style.characterSprms ?? []).flat()];
        const body = [...base, ...name];

        for (const upx of upxs) {
            if (body.length % 2 === 1) {
                body.push(0);
            }

            body.push(...u16(upx.length), ...upx);
        }

        bytes.push(...u16(body.length), ...body);
    }

    return bytes;
}

function listDefinition(list: FixtureList): number[] {
    const isSimple = list.levels.length === 1;

    return [...u32(list.id), ...u32(0), ...new Array(18).fill(0xff), isSimple ? 1 : 0, 0];
}

function listLevel(level: { readonly format: number; readonly start?: number }): number[] {
    const header = [...u32(level.start ?? 1), level.format, 0, ...new Array(9).fill(0), 0, ...u32(0), ...u32(0), 0, 0, 0, 0];

    return [...header, ...u16(1), ...u16(0)];
}

function cp1252Bytes(text: string): number[] {
    const high = new Map([[0x20ac, 0x80], [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2013, 0x96], [0x2014, 0x97]]);

    return [...text].map((character) => high.get(character.charCodeAt(0)) ?? character.charCodeAt(0) & 0xff);
}

function utf16Bytes(text: string): number[] {
    return [...text].flatMap((character) => u16(character.charCodeAt(0)));
}

type FixtureProperty =
    | readonly [id: number, type: 'string', value: string]
    | readonly [id: number, type: 'unicode', value: string]
    | readonly [id: number, type: 'int', value: number]
    | readonly [id: number, type: 'date', value: Date];

export const SUMMARY_FORMAT_ID = [0xe0, 0x85, 0x9f, 0xf2, 0xf9, 0x4f, 0x68, 0x10, 0xab, 0x91, 0x08, 0x00, 0x2b, 0x27, 0xb3, 0xd9];
export const DOCUMENT_SUMMARY_FORMAT_ID = [0x02, 0xd5, 0xcd, 0xd5, 0x9c, 0x2e, 0x1b, 0x10, 0x93, 0x97, 0x08, 0x00, 0x2b, 0x2c, 0xf9, 0xae];

// A property set stream with one section, its 8-bit strings in `codePage`.
export function buildPropertySet(
    formatId: ReadonlyArray<number>,
    properties: ReadonlyArray<FixtureProperty>,
    codePage = 1252,
): Uint8Array<ArrayBuffer> {
    const values: number[][] = [[...u16(0x0002), 0, 0, ...u16(codePage), 0, 0]];
    const ids = [1];

    for (const [id, type, value] of properties) {
        ids.push(id);
        values.push(propertyValue(type, value, codePage));
    }

    const tableSize = 8 + ids.length * 8;
    const offsets: number[] = [];
    let position = tableSize;

    for (const value of values) {
        offsets.push(position);
        position += value.length;
    }

    const section = [
        ...u32(position),
        ...u32(ids.length),
        ...ids.flatMap((id, index) => [...u32(id), ...u32(offsets[index] ?? 0)]),
        ...values.flat(),
    ];
    const header = [...u16(0xfffe), ...u16(0), ...u32(0x00020006), ...new Array(16).fill(0), ...u32(1), ...formatId, ...u32(48)];

    return Uint8Array.from([...header, ...section]);
}

function propertyValue(type: FixtureProperty[1], value: string | number | Date, codePage: number): number[] {
    if (type === 'int') {
        return [...u16(0x0003), 0, 0, ...u32(value as number)];
    }

    if (type === 'date') {
        const ticks = BigInt((value as Date).getTime() + 11_644_473_600_000) * 10_000n;

        return [...u16(0x0040), 0, 0, ...u32(Number(ticks & 0xffffffffn)), ...u32(Number(ticks >> 32n))];
    }

    if (type === 'unicode') {
        const text = `${value as string}\u0000`;
        const bytes = [...u16(0x001f), 0, 0, ...u32(text.length), ...utf16Bytes(text)];

        return padToFour(bytes);
    }

    const encoded = codePage === 65001 ? [...new TextEncoder().encode(value as string)] : cp1252Bytes(value as string);

    return padToFour([...u16(0x001e), 0, 0, ...u32(encoded.length + 1), ...encoded, 0]);
}

function padToFour(bytes: number[]): number[] {
    while (bytes.length % 4 !== 0) {
        bytes.push(0);
    }

    return bytes;
}
