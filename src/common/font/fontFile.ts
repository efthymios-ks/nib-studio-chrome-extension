import brotliDecompress from 'brotli/decompress.js';

// The container a font arrives in: a plain sfnt (TrueType or OpenType), a collection, or a web font.
export type FontContainer = 'sfnt' | 'collection' | 'woff' | 'woff2';

// The outlines inside: TrueType quadratic curves, or CFF cubic curves.
export type FontOutlines = 'TrueType' | 'CFF';

// The tables of a font's first face, decompressed, keyed by their four-letter tag.
export interface FontFile {
    readonly container: FontContainer;
    readonly outlines: FontOutlines;
    // Faces in a collection; 1 for every other file.
    readonly faceCount: number;
    readonly tables: ReadonlyMap<string, Uint8Array>;
}

// Inflates a zlib stream, as WOFF stores its tables; the browser's DecompressionStream unless a test gives another.
export type InflateAsync = (data: Uint8Array) => Promise<Uint8Array>;

// Undoes Brotli, as WOFF2 stores its tables.
export type Unbrotli = (data: Uint8Array) => Uint8Array;

// Only these tables are read, so a WOFF never inflates its outlines.
const FONT_TABLES_READ: ReadonlyArray<string> = ['name', 'cmap', 'OS/2', 'head', 'maxp', 'fvar'];

// The sfnt version of a font: 1.0 or 'true' for TrueType outlines, 'OTTO' for CFF, 'typ1' for PostScript.
const SFNT_TRUETYPE = 0x00010000;
const SFNT_APPLE_TRUETYPE = 0x74727565;
const SFNT_CFF = 0x4f54544f;
const SFNT_TYPE1 = 0x74797031;
const SFNT_FLAVORS: ReadonlySet<number> = new Set([SFNT_TRUETYPE, SFNT_APPLE_TRUETYPE, SFNT_CFF, SFNT_TYPE1]);

// The flavor a WOFF2 gives a collection: 'ttcf'.
const WOFF2_COLLECTION = 0x74746366;

// The tags a WOFF2 table directory refers to by index, in the order of the WOFF2 specification.
const WOFF2_KNOWN_TAGS: ReadonlyArray<string> = [
    'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
    'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
    'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
    'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

// A cursor over big-endian font data that throws a readable error when the data ends early.
export class FontReader {
    private readonly view: DataView;

    position = 0;

    constructor(readonly bytes: Uint8Array) {
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    get length(): number {
        return this.bytes.length;
    }

    uint8At(offset: number): number {
        this.check(offset, 1);

        return this.view.getUint8(offset);
    }

    uint16At(offset: number): number {
        this.check(offset, 2);

        return this.view.getUint16(offset);
    }

    uint32At(offset: number): number {
        this.check(offset, 4);

        return this.view.getUint32(offset);
    }

    // A 16.16 fixed-point number.
    fixedAt(offset: number): number {
        this.check(offset, 4);

        return this.view.getInt32(offset) / 65536;
    }

    tagAt(offset: number): string {
        this.check(offset, 4);

        return String.fromCharCode(...this.bytes.subarray(offset, offset + 4));
    }

    slice(offset: number, length: number): Uint8Array {
        this.check(offset, length);

        return this.bytes.subarray(offset, offset + length);
    }

    private check(offset: number, size: number): void {
        if (offset < 0 || offset + size > this.bytes.length) {
            throw new Error('The font data ends early.');
        }
    }
}

// Reads the container and returns the first face's tables that the preview shows.
export async function readFontFileAsync(
    bytes: Uint8Array,
    inflateAsync: InflateAsync = inflateZlibAsync,
    unbrotli: Unbrotli = brotliDecompress,
): Promise<FontFile> {
    const reader = new FontReader(bytes);
    const signature = reader.length >= 4 ? reader.tagAt(0) : '';

    if (signature === 'wOFF') {
        return await readWoffAsync(reader, inflateAsync);
    }

    if (signature === 'wOF2') {
        return readWoff2(reader, unbrotli);
    }

    if (signature === 'ttcf') {
        const faceCount = reader.uint32At(8);

        if (faceCount === 0) {
            throw new Error('The font collection holds no fonts.');
        }

        return { ...readSfnt(reader, reader.uint32At(12)), container: 'collection', faceCount };
    }

    return readSfnt(reader, 0);
}

function outlinesOf(flavor: number): FontOutlines {
    return flavor === SFNT_CFF ? 'CFF' : 'TrueType';
}

function readSfnt(reader: FontReader, start: number): FontFile {
    const flavor = reader.uint32At(start);

    if (!SFNT_FLAVORS.has(flavor)) {
        throw new Error('The file is not a TrueType, OpenType, WOFF or WOFF2 font.');
    }

    const tableCount = reader.uint16At(start + 4);
    const tables = new Map<string, Uint8Array>();

    for (let index = 0; index < tableCount; index += 1) {
        const record = start + 12 + index * 16;
        const tag = reader.tagAt(record);

        if (FONT_TABLES_READ.includes(tag)) {
            tables.set(tag, reader.slice(reader.uint32At(record + 8), reader.uint32At(record + 12)));
        }
    }

    return { container: 'sfnt', outlines: outlinesOf(flavor), faceCount: 1, tables };
}

async function readWoffAsync(reader: FontReader, inflateAsync: InflateAsync): Promise<FontFile> {
    const flavor = reader.uint32At(4);
    const tableCount = reader.uint16At(12);
    const tables = new Map<string, Uint8Array>();

    for (let index = 0; index < tableCount; index += 1) {
        const record = 44 + index * 20;
        const tag = reader.tagAt(record);

        if (!FONT_TABLES_READ.includes(tag)) {
            continue;
        }

        const offset = reader.uint32At(record + 4);
        const compressedLength = reader.uint32At(record + 8);
        const originalLength = reader.uint32At(record + 12);
        const data = reader.slice(offset, compressedLength);
        tables.set(tag, compressedLength < originalLength ? await inflateAsync(data) : data);
    }

    return { container: 'woff', outlines: outlinesOf(flavor), faceCount: 1, tables };
}

interface Woff2Entry {
    readonly tag: string;
    readonly length: number;
}

// A face of a WOFF2 file: its flavor and the indices of its tables in the table directory.
interface Woff2Face {
    readonly flavor: number;
    readonly tableIndices: ReadonlyArray<number>;
}

// WOFF2 keeps every table in one Brotli stream, in directory order. glyf, loca and hmtx may be transformed,
// but the tables the preview reads never are, so they come out as they were.
function readWoff2(reader: FontReader, unbrotli: Unbrotli): FontFile {
    const flavor = reader.uint32At(4);
    const tableCount = reader.uint16At(12);
    const compressedLength = reader.uint32At(20);
    reader.position = 48;
    const entries: Woff2Entry[] = [];

    for (let index = 0; index < tableCount; index += 1) {
        const flags = reader.uint8At(reader.position);
        reader.position += 1;
        const knownTag = WOFF2_KNOWN_TAGS[flags & 0x3f];
        const tag = knownTag ?? reader.tagAt(reader.position);

        if (knownTag == null) {
            reader.position += 4;
        }

        const transform = (flags >> 6) & 0x03;
        const originalLength = readUintBase128(reader);
        const isTransformed = tag === 'glyf' || tag === 'loca' ? transform === 0 : transform !== 0;
        const length = isTransformed ? readUintBase128(reader) : originalLength;
        entries.push({ tag, length });
    }

    const faces = flavor === WOFF2_COLLECTION
        ? readWoff2CollectionDirectory(reader)
        : [{ flavor, tableIndices: entries.map((_, index) => index) }];
    const face = faces[0];

    if (face == null) {
        throw new Error('The font collection holds no fonts.');
    }

    const stream = unbrotli(reader.slice(reader.position, compressedLength));
    const offsets: number[] = [];
    let offset = 0;

    for (const entry of entries) {
        offsets.push(offset);
        offset += entry.length;
    }

    const tables = new Map<string, Uint8Array>();

    for (const index of face.tableIndices) {
        const entry = entries[index];
        const start = offsets[index];

        if (
            entry != null
            && start != null
            && FONT_TABLES_READ.includes(entry.tag)
            && start + entry.length <= stream.length
        ) {
            tables.set(entry.tag, stream.subarray(start, start + entry.length));
        }
    }

    return { container: 'woff2', outlines: outlinesOf(face.flavor), faceCount: faces.length, tables };
}

// The collection directory between the table directory and the compressed tables: a version, the face count,
// then each face's table count, flavor and table indices. Every face is read, so the compressed tables start
// where the reader stops.
function readWoff2CollectionDirectory(reader: FontReader): Woff2Face[] {
    reader.position += 4;
    const faceCount = read255UInt16(reader);
    const faces: Woff2Face[] = [];

    for (let face = 0; face < faceCount; face += 1) {
        const tableCount = read255UInt16(reader);
        const flavor = reader.uint32At(reader.position);
        reader.position += 4;
        const tableIndices: number[] = [];

        for (let index = 0; index < tableCount; index += 1) {
            tableIndices.push(read255UInt16(reader));
        }

        faces.push({ flavor, tableIndices });
    }

    return faces;
}

// A WOFF2 variable-length number: seven bits a byte, high bit set on every byte but the last.
function readUintBase128(reader: FontReader): number {
    let value = 0;

    for (let index = 0; index < 5; index += 1) {
        const byte = reader.uint8At(reader.position);
        reader.position += 1;

        if (index === 0 && byte === 0x80) {
            throw new Error('The WOFF2 table directory is damaged.');
        }

        value = value * 128 + (byte & 0x7f);

        if ((byte & 0x80) === 0) {
            return value;
        }
    }

    throw new Error('The WOFF2 table directory is damaged.');
}

// A WOFF2 number of one to three bytes, used by the collection directory.
function read255UInt16(reader: FontReader): number {
    const code = reader.uint8At(reader.position);
    reader.position += 1;

    if (code === 253) {
        const value = reader.uint16At(reader.position);
        reader.position += 2;

        return value;
    }

    if (code === 254 || code === 255) {
        const value = reader.uint8At(reader.position);
        reader.position += 1;

        return value + (code === 254 ? 506 : 253);
    }

    return code;
}

// zlib, as WOFF tables are stored, through the browser's own DecompressionStream.
async function inflateZlibAsync(data: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream('deflate'));

    return new Uint8Array(await new Response(stream).arrayBuffer());
}
