// Builds small fonts table by table for the font tests, so no font files are needed.
// The tables hold only what the font reader reads; there are no outlines.
import { brotliCompressSync, deflateSync } from 'node:zlib';

export type FontTables = Readonly<Record<string, Uint8Array>>;

const TRUETYPE = 0x00010000;

// 'ttcf', the flavor of a collection.
const TTC_TAG = 0x74746366;

class ByteWriter {
    readonly bytes: number[] = [];

    uint8(value: number): this {
        this.bytes.push(value & 0xff);

        return this;
    }

    uint16(value: number): this {
        return this.uint8(value >> 8).uint8(value);
    }

    int16(value: number): this {
        return this.uint16(value < 0 ? value + 0x10000 : value);
    }

    uint32(value: number): this {
        return this.uint16(Math.floor(value / 0x10000)).uint16(value % 0x10000);
    }

    fixed(value: number): this {
        const raw = Math.round(value * 65536);

        return this.uint32(raw < 0 ? raw + 0x100000000 : raw);
    }

    tag(value: string): this {
        for (const character of value) {
            this.uint8(character.charCodeAt(0));
        }

        return this;
    }

    append(bytes: ArrayLike<number>): this {
        this.bytes.push(...Array.from(bytes));

        return this;
    }

    pad(): this {
        while (this.bytes.length % 4 !== 0) {
            this.uint8(0);
        }

        return this;
    }

    build(): Uint8Array {
        return new Uint8Array(this.bytes);
    }
}

export interface NameRecord {
    readonly platform: number;
    readonly encoding: number;
    readonly language: number;
    readonly nameId: number;
    readonly text: string;
}

// A Windows English record, the kind most fonts carry.
export function windowsName(nameId: number, text: string): NameRecord {
    return { platform: 3, encoding: 1, language: 0x0409, nameId, text };
}

export function buildName(records: ReadonlyArray<NameRecord>): Uint8Array {
    const storage = new ByteWriter();
    const table = new ByteWriter().uint16(0).uint16(records.length).uint16(6 + records.length * 12);

    for (const record of records) {
        const offset = storage.bytes.length;

        if (record.platform === 1) {
            for (const character of record.text) {
                storage.uint8(character.charCodeAt(0));
            }
        }
        else {
            for (const character of record.text) {
                storage.uint16(character.charCodeAt(0));
            }
        }

        table.uint16(record.platform).uint16(record.encoding).uint16(record.language).uint16(record.nameId)
            .uint16(storage.bytes.length - offset).uint16(offset);
    }

    return table.append(storage.bytes).build();
}

// A format 4 subtable mapping each code point in order to glyphs 1, 2, 3 and so on, one segment per code point,
// with the last segment looking its glyph up through idRangeOffset.
function format4(codes: ReadonlyArray<number>): Uint8Array {
    const segments = [...codes, 0xffff];
    const count = segments.length;
    const ends = new ByteWriter();
    const starts = new ByteWriter();
    const deltas = new ByteWriter();
    const offsets = new ByteWriter();
    const glyphs = new ByteWriter();

    segments.forEach((code, index) => {
        ends.uint16(code);
        starts.uint16(code);

        if (code === 0xffff) {
            deltas.int16(1);
            offsets.uint16(0);

            return;
        }

        if (index === codes.length - 1) {
            deltas.int16(0);
            offsets.uint16((count - index) * 2);
            glyphs.uint16(index + 1);

            return;
        }

        // idDelta wraps around 65536, so code + delta lands on the glyph.
        deltas.uint16((index + 1 - code + 0x10000) % 0x10000);
        offsets.uint16(0);
    });

    const body = new ByteWriter()
        .append(ends.bytes)
        .uint16(0)
        .append(starts.bytes)
        .append(deltas.bytes)
        .append(offsets.bytes)
        .append(glyphs.bytes);
    const length = 14 + body.bytes.length;

    return new ByteWriter()
        .uint16(4)
        .uint16(length)
        .uint16(0)
        .uint16(count * 2)
        .uint16(0)
        .uint16(0)
        .uint16(0)
        .append(body.bytes)
        .build();
}

// A format 12 subtable with one group a range, glyphs counted from 1.
function format12(ranges: ReadonlyArray<readonly [number, number]>): Uint8Array {
    const table = new ByteWriter().uint16(12).uint16(0).uint32(16 + ranges.length * 12).uint32(0).uint32(ranges.length);
    let glyph = 1;

    for (const [first, last] of ranges) {
        table.uint32(first).uint32(last).uint32(glyph);
        glyph += last - first + 1;
    }

    return table.build();
}

// A cmap with a Windows BMP format 4 subtable, and a format 12 one when ranges beyond it are given.
export function buildCmap(codes: ReadonlyArray<number>, ranges?: ReadonlyArray<readonly [number, number]>): Uint8Array {
    const subtables: Array<{ platform: number; encoding: number; data: Uint8Array }> = [
        { platform: 3, encoding: 1, data: format4(codes) },
    ];

    if (ranges != null) {
        subtables.push({ platform: 3, encoding: 10, data: format12(ranges) });
    }

    const table = new ByteWriter().uint16(0).uint16(subtables.length);
    let offset = 4 + subtables.length * 8;

    for (const subtable of subtables) {
        table.uint16(subtable.platform).uint16(subtable.encoding).uint32(offset);
        offset += subtable.data.length;
    }

    for (const subtable of subtables) {
        table.append(subtable.data);
    }

    return table.build();
}

export function buildOs2(
    weight: number,
    width: number,
    embedding = 0,
): Uint8Array {
    return new ByteWriter()
        .uint16(4)
        .int16(500)
        .uint16(weight)
        .uint16(width)
        .uint16(embedding)
        .append(new Array(86).fill(0))
        .build();
}

export function buildHead(unitsPerEm: number): Uint8Array {
    return new ByteWriter()
        .uint32(0x00010000)
        .uint32(0x00010000)
        .uint32(0)
        .uint32(0x5f0f3cf5)
        .uint16(0)
        .uint16(unitsPerEm)
        .append(new Array(34).fill(0))
        .build();
}

export function buildMaxp(glyphCount: number): Uint8Array {
    return new ByteWriter().uint32(0x00005000).uint16(glyphCount).build();
}

export interface AxisSpec {
    readonly tag: string;
    readonly min: number;
    readonly defaultValue: number;
    readonly max: number;
    readonly nameId: number;
    readonly isHidden?: boolean;
}

export function buildFvar(axes: ReadonlyArray<AxisSpec>, instanceCount: number): Uint8Array {
    const instanceSize = 4 + axes.length * 4;
    const table = new ByteWriter()
        .uint16(1)
        .uint16(0)
        .uint16(16)
        .uint16(2)
        .uint16(axes.length)
        .uint16(20)
        .uint16(instanceCount)
        .uint16(instanceSize);

    for (const axis of axes) {
        table
            .tag(axis.tag)
            .fixed(axis.min)
            .fixed(axis.defaultValue)
            .fixed(axis.max)
            .uint16(axis.isHidden === true ? 1 : 0)
            .uint16(axis.nameId);
    }

    for (let index = 0; index < instanceCount; index += 1) {
        table.uint16(256 + index).uint16(0);

        for (const axis of axes) {
            table.fixed(axis.defaultValue);
        }
    }

    return table.build();
}

function sortedTags(tables: FontTables): string[] {
    return Object.keys(tables).sort();
}

// A plain sfnt: the offset table, the table directory, then each table padded to 4 bytes.
// `base` shifts every table offset, for a font placed inside a collection.
export function buildSfnt(
    tables: FontTables,
    flavor = TRUETYPE,
    base = 0,
): Uint8Array {
    const tags = sortedTags(tables);
    const header = new ByteWriter().uint32(flavor).uint16(tags.length).uint16(0).uint16(0).uint16(0);
    const data = new ByteWriter();
    const offset = 12 + tags.length * 16;

    for (const tag of tags) {
        const table = tables[tag] as Uint8Array;
        header.tag(tag).uint32(0).uint32(base + offset + data.bytes.length).uint32(table.length);
        data.append(table).pad();
    }

    return header.append(data.bytes).build();
}

// A TrueType collection of the given fonts' tables, each face with its own directory.
export function buildCollection(faces: ReadonlyArray<FontTables>): Uint8Array {
    const headerLength = 12 + faces.length * 4;
    const header = new ByteWriter().tag('ttcf').uint32(0x00010000).uint32(faces.length);
    const body = new ByteWriter();

    for (const face of faces) {
        const start = headerLength + body.bytes.length;
        header.uint32(start);
        body.append(buildSfnt(face, TRUETYPE, start)).pad();
    }

    return header.append(body.bytes).build();
}

// A WOFF: each table zlib-compressed when that makes it smaller, as WOFF writers do.
export function buildWoff(tables: FontTables, flavor = TRUETYPE): Uint8Array {
    const tags = sortedTags(tables);
    const directory = new ByteWriter();
    const data = new ByteWriter();
    const dataStart = 44 + tags.length * 20;

    for (const tag of tags) {
        const table = tables[tag] as Uint8Array;
        const compressed = new Uint8Array(deflateSync(table));
        const stored = compressed.length < table.length ? compressed : table;
        directory.tag(tag).uint32(dataStart + data.bytes.length).uint32(stored.length).uint32(table.length).uint32(0);
        data.append(stored).pad();
    }

    const total = dataStart + data.bytes.length;
    const header = new ByteWriter().tag('wOFF').uint32(flavor).uint32(total).uint16(tags.length).uint16(0).uint32(0)
        .uint16(1).uint16(0).uint32(0).uint32(0).uint32(0).uint32(0).uint32(0);

    return header.append(directory.bytes).append(data.bytes).build();
}

const WOFF2_TAG_INDEX: Readonly<Record<string, number>> = { cmap: 0, head: 1, maxp: 4, name: 5, 'OS/2': 6, fvar: 47 };

function uintBase128(value: number): number[] {
    const bytes = [value & 0x7f];
    let rest = Math.floor(value / 128);

    while (rest > 0) {
        bytes.unshift((rest & 0x7f) | 0x80);
        rest = Math.floor(rest / 128);
    }

    return bytes;
}

interface TaggedTable {
    readonly tag: string;
    readonly data: Uint8Array;
}

function taggedTables(tables: FontTables): TaggedTable[] {
    return sortedTags(tables).map((tag) => ({ tag, data: tables[tag] as Uint8Array }));
}

// A WOFF2 with every table untransformed in one Brotli stream; a tag outside the known list is written out in full.
// A collection's directory goes between the table directory and the stream.
function buildWoff2File(
    flavor: number,
    tables: ReadonlyArray<TaggedTable>,
    collectionDirectory: ReadonlyArray<number>,
): Uint8Array {
    const directory = new ByteWriter();
    const stream = new ByteWriter();

    for (const table of tables) {
        const index = WOFF2_TAG_INDEX[table.tag];
        directory.uint8(index ?? 63);

        if (index == null) {
            directory.tag(table.tag);
        }

        directory.append(uintBase128(table.data.length));
        stream.append(table.data);
    }

    const compressed = new Uint8Array(brotliCompressSync(stream.build()));
    const total = 48 + directory.bytes.length + collectionDirectory.length + compressed.length;
    const header = new ByteWriter().tag('wOF2').uint32(flavor).uint32(total).uint16(tables.length).uint16(0).uint32(0)
        .uint32(compressed.length).uint16(1).uint16(0).uint32(0).uint32(0).uint32(0).uint32(0).uint32(0);

    return header.append(directory.bytes).append(collectionDirectory).append(compressed).build();
}

export function buildWoff2(tables: FontTables, flavor = TRUETYPE): Uint8Array {
    return buildWoff2File(flavor, taggedTables(tables), []);
}

// A WOFF2 collection: every face's tables in one directory, and a collection directory giving each face
// its flavor and the indices of its tables.
export function buildWoff2Collection(faces: ReadonlyArray<FontTables>, flavor = TRUETYPE): Uint8Array {
    const collection = new ByteWriter().uint32(0x00010000).uint8(faces.length);
    let firstIndex = 0;

    for (const face of faces) {
        const tableCount = Object.keys(face).length;
        collection.uint8(tableCount).uint32(flavor);

        for (let index = 0; index < tableCount; index += 1) {
            collection.uint8(firstIndex + index);
        }

        firstIndex += tableCount;
    }

    return buildWoff2File(TTC_TAG, faces.flatMap(taggedTables), collection.bytes);
}

// A small variable font's tables: names, Latin letters with one character beyond the BMP, a weight and a width axis.
export function sampleFontTables(): FontTables {
    return {
        name: buildName([
            windowsName(0, 'Copyright 2026 Nib Type'),
            windowsName(1, 'Nib Sans'),
            windowsName(2, 'Regular'),
            windowsName(4, 'Nib Sans Regular'),
            windowsName(5, 'Version 1.002'),
            windowsName(8, 'Nib Type Foundry'),
            windowsName(9, 'A. Designer'),
            windowsName(13, 'SIL Open Font License 1.1'),
            windowsName(14, 'https://openfontlicense.org'),
            windowsName(256, 'Heaviness'),
            { platform: 1, encoding: 0, language: 0, nameId: 1, text: 'Nib Sans Mac' },
        ]),
        cmap: buildCmap([0x41, 0x42, 0x43, 0x61], [[0x41, 0x43], [0x61, 0x61], [0x1f600, 0x1f601]]),
        'OS/2': buildOs2(400, 5, 0x0008),
        head: buildHead(1000),
        maxp: buildMaxp(42),
        fvar: buildFvar([
            { tag: 'wght', min: 100, defaultValue: 400, max: 900, nameId: 256 },
            { tag: 'wdth', min: 75, defaultValue: 100, max: 125, nameId: 999 },
            { tag: 'XHID', min: 0, defaultValue: 0, max: 1, nameId: 998, isHidden: true },
        ], 3),
    };
}
