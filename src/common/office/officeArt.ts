import { readInt32, readUint16, readUint32 } from '../binary/littleEndian.js';
import { IMAGE_HEADER_BYTES, sniffImageFormat, type ImageFormatId } from '../image/imageFormat.js';
import type { DocCrop, DocImage, DocPictureFormat } from './docModel.js';

// OfficeArt records ([MS-ODRAW]), the drawing data of Word 97–2003 files, read as far as their pictures need:
// shapes with their picture and crop, the blip store, and the pictures (blips) themselves.

export interface OfficeArtRecord {
    readonly type: number;
    readonly version: number;
    readonly instance: number;
    // The record's data, after its 8-byte header.
    readonly body: Uint8Array;
}

export const RECORD_TYPES = Object.freeze({
    drawingGroup: 0xf000,
    blipStore: 0xf001,
    drawing: 0xf002,
    shape: 0xf004,
    blipStoreEntry: 0xf007,
    shapeHeader: 0xf00a,
    options: 0xf00b,
    secondaryOptions: 0xf121,
    tertiaryOptions: 0xf122,
});

const HEADER_SIZE = 8;
const CONTAINER_VERSION = 0x0f;
// Containers nest no deeper than this; anything deeper is taken as damaged.
const MAX_DEPTH = 16;

// The records laid end to end from `start` to `end`; reading stops at a record that runs past the end.
export function readRecords(bytes: Uint8Array, start = 0, end = bytes.length): OfficeArtRecord[] {
    const records: OfficeArtRecord[] = [];
    const limit = Math.min(end, bytes.length);
    let position = Math.max(0, start);

    while (position + HEADER_SIZE <= limit) {
        const record = readRecordAt(bytes, position, limit);

        if (record == null) {
            break;
        }

        records.push(record);
        position += HEADER_SIZE + record.body.length;
    }

    return records;
}

// The one record at `offset`, or null when its header or body runs past `end`.
export function readRecordAt(bytes: Uint8Array, offset: number, end = bytes.length): OfficeArtRecord | null {
    const limit = Math.min(end, bytes.length);

    if (offset < 0 || offset + HEADER_SIZE > limit) {
        return null;
    }

    const header = readUint16(bytes, offset);
    const length = readUint32(bytes, offset + 4);
    const bodyStart = offset + HEADER_SIZE;

    if (length > limit - bodyStart) {
        return null;
    }

    return {
        type: readUint16(bytes, offset + 2),
        version: header & 0x0f,
        instance: header >>> 4,
        body: bytes.subarray(bodyStart, bodyStart + length),
    };
}

export interface OfficeArtShape {
    readonly id: number;
    // The 1-based place of the shape's picture in the blip store, or 0 when it shows none.
    readonly blipIndex: number;
    readonly crop: DocCrop | null;
    readonly description: string | null;
}

// Every shape in a drawing, the shapes inside groups included, by shape id.
export function readShapes(drawing: OfficeArtRecord): Map<number, OfficeArtShape> {
    const shapes = new Map<number, OfficeArtShape>();

    const visit = (record: OfficeArtRecord, depth: number): void => {
        if (record.type === RECORD_TYPES.shape) {
            const shape = readShape(record);

            if (shape != null && !shapes.has(shape.id)) {
                shapes.set(shape.id, shape);
            }

            return;
        }

        if (record.version === CONTAINER_VERSION && depth < MAX_DEPTH) {
            for (const child of readRecords(record.body)) {
                visit(child, depth + 1);
            }
        }
    };

    visit(drawing, 0);

    return shapes;
}

const PROPERTY = Object.freeze({
    cropFromTop: 0x0100,
    cropFromBottom: 0x0101,
    cropFromLeft: 0x0102,
    cropFromRight: 0x0103,
    pictureBlip: 0x0104,
    fillType: 0x0180,
    fillBlip: 0x0186,
    description: 0x0381,
});

// The fill type of a shape filled with a stretched picture.
const FILL_PICTURE = 3;
const OPTION_TYPES: ReadonlySet<number> = new Set([
    RECORD_TYPES.options,
    RECORD_TYPES.secondaryOptions,
    RECORD_TYPES.tertiaryOptions,
]);

// A shape container's id, picture, crop and alternative text.
export function readShape(container: OfficeArtRecord): OfficeArtShape | null {
    const records = readRecords(container.body);
    const header = records.find((record) => record.type === RECORD_TYPES.shapeHeader);

    if (header == null || header.body.length < 8) {
        return null;
    }

    const properties = readProperties(records.filter((record) => OPTION_TYPES.has(record.type)));
    const value = (id: number): number => properties.values.get(id) ?? 0;
    const pictureBlip = value(PROPERTY.pictureBlip);
    const fillBlip = value(PROPERTY.fillType) === FILL_PICTURE ? value(PROPERTY.fillBlip) : 0;

    return {
        id: readUint32(header.body, 0),
        blipIndex: Math.max(0, pictureBlip > 0 ? pictureBlip : fillBlip),
        crop: cropOf(value),
        description: decodeWideString(properties.complex.get(PROPERTY.description)),
    };
}

interface ShapeProperties {
    readonly values: Map<number, number>;
    // The data of complex properties, such as strings, which follows each table's entries in their order.
    readonly complex: Map<number, Uint8Array>;
}

const PROPERTY_ENTRY_SIZE = 6;

// The property tables of a shape (OfficeArtFOPT and its secondary and tertiary kin);
// the first value of a property wins.
function readProperties(tables: ReadonlyArray<OfficeArtRecord>): ShapeProperties {
    const values = new Map<number, number>();
    const complex = new Map<number, Uint8Array>();

    for (const table of tables) {
        const { body } = table;
        const count = Math.min(table.instance, Math.floor(body.length / PROPERTY_ENTRY_SIZE));
        let complexAt = table.instance * PROPERTY_ENTRY_SIZE;

        for (let index = 0; index < count; index += 1) {
            const at = index * PROPERTY_ENTRY_SIZE;
            const header = readUint16(body, at);
            const id = header & 0x3fff;
            const value = readInt32(body, at + 2);

            if ((header & 0x8000) === 0) {
                if (!values.has(id)) {
                    values.set(id, value);
                }

                continue;
            }

            const size = value >>> 0;

            if (complexAt + size <= body.length && !complex.has(id)) {
                complex.set(id, body.subarray(complexAt, complexAt + size));
            }

            complexAt += size;
        }
    }

    return { values, complex };
}

// Crops are 16.16 fixed-point shares of the picture; negative ones pad rather than crop,
// which the preview leaves out.
function cropOf(value: (id: number) => number): DocCrop | null {
    const share = (id: number): number => Math.min(Math.max(0, value(id) / 65536), 1);
    const crop = {
        top: share(PROPERTY.cropFromTop),
        right: share(PROPERTY.cropFromRight),
        bottom: share(PROPERTY.cropFromBottom),
        left: share(PROPERTY.cropFromLeft),
    };

    if (crop.top + crop.bottom >= 1 || crop.left + crop.right >= 1) {
        return null;
    }

    return crop.top === 0 && crop.right === 0 && crop.bottom === 0 && crop.left === 0 ? null : crop;
}

// The BITMAPFILEHEADER put in front of a DIB to make it a BMP file.
const BMP_FILE_HEADER_SIZE = 14;

function decodeWideString(data: Uint8Array | undefined): string | null {
    if (data == null) {
        return null;
    }

    const text = new TextDecoder('utf-16le').decode(data.subarray(0, data.length - (data.length % 2)));
    const end = text.indexOf('\u0000');
    const trimmed = (end < 0 ? text : text.slice(0, end)).trim();

    return trimmed === '' ? null : trimmed;
}

// The blip store's entries, in order: a shape names its picture by its 1-based place in this list.
export function readBlipStore(drawingGroup: OfficeArtRecord): OfficeArtRecord[] {
    const store = readRecords(drawingGroup.body).find((record) => record.type === RECORD_TYPES.blipStore);

    return store == null ? [] : readRecords(store.body);
}

interface BlipType {
    readonly format: DocPictureFormat;
    readonly isMetafile: boolean;
}

const BLIP_TYPES: ReadonlyMap<number, BlipType> = new Map<number, BlipType>([
    [0xf01a, { format: 'emf', isMetafile: true }],
    [0xf01b, { format: 'wmf', isMetafile: true }],
    [0xf01c, { format: 'pict', isMetafile: true }],
    [0xf01d, { format: 'jpeg', isMetafile: false }],
    [0xf02a, { format: 'jpeg', isMetafile: false }],
    [0xf01e, { format: 'png', isMetafile: false }],
    [0xf01f, { format: 'bmp', isMetafile: false }],
    [0xf029, { format: 'tiff', isMetafile: false }],
]);

const DIB_BLIP = 0xf01f;
const NO_DELAY = 0xffffffff;
// An entry's fixed fields, before its name and the blip it may hold.
const ENTRY_HEADER_SIZE = 36;

// The blip of a blip store entry: a blip itself, one inside the entry,
// or one in the delay stream at the entry's offset.
// Word's delay stream is its WordDocument stream.
export function blipOfEntry(entry: OfficeArtRecord | undefined, delay: Uint8Array | null): OfficeArtRecord | null {
    if (entry == null) {
        return null;
    }

    if (BLIP_TYPES.has(entry.type)) {
        return entry;
    }

    if (entry.type !== RECORD_TYPES.blipStoreEntry || entry.body.length < ENTRY_HEADER_SIZE) {
        return null;
    }

    const embeddedAt = ENTRY_HEADER_SIZE + (entry.body[33] ?? 0);
    const offset = readUint32(entry.body, 28);
    const blip = blipRecordOf(entry.body, embeddedAt, delay, offset);

    return blip != null && BLIP_TYPES.has(blip.type) ? blip : null;
}

// The picture record of a store entry: inside the entry when it is there,
// else in the delay stream at its offset.
function blipRecordOf(body: Uint8Array, embeddedAt: number, delay: Uint8Array | null, offset: number): OfficeArtRecord | null {
    if (body.length >= embeddedAt + HEADER_SIZE) {
        return readRecordAt(body, embeddedAt);
    }

    if (delay == null || offset === NO_DELAY) {
        return null;
    }

    return readRecordAt(delay, offset);
}

export interface BlipPicture {
    readonly format: DocPictureFormat | null;
    readonly image: DocImage | null;
}

// Bitmaps that Chrome draws itself. TIFF isn't one:
// its bytes are kept for the preview to decode and show as PNG.
const DISPLAYABLE: ReadonlySet<ImageFormatId> = new Set<ImageFormatId>(['png', 'jpeg', 'gif', 'bmp']);
const UID_SIZE = 16;
const BITMAP_TAG_SIZE = 1;

// The picture a blip holds,
// its bytes copied out of the stream when the browser can draw it and they fit in `budget`.
// The stored type only names the picture: the bytes say what they are,
// so a PNG blip that holds a GIF shows as a GIF.
export function readBlip(blip: OfficeArtRecord, budget: number): BlipPicture {
    const type = BLIP_TYPES.get(blip.type);

    if (type == null) {
        return { format: null, image: null };
    }

    if (type.isMetafile) {
        return { format: type.format, image: null };
    }

    // An odd instance means a second 16-byte identifier follows the first.
    const uids = UID_SIZE * ((blip.instance & 1) === 1 ? 2 : 1);
    const data = blip.body.subarray(uids + BITMAP_TAG_SIZE);

    if (blip.type === DIB_BLIP) {
        return { format: 'bmp', image: data.length + BMP_FILE_HEADER_SIZE > budget ? null : dibToBmp(data) };
    }

    const sniffed = sniffImageFormat(data.subarray(0, IMAGE_HEADER_BYTES), '');

    if (sniffed.id === 'tiff') {
        return { format: 'tiff', image: data.length > budget ? null : { mimeType: sniffed.mime, bytes: data.slice() } };
    }

    if (!DISPLAYABLE.has(sniffed.id)) {
        return { format: type.format, image: null };
    }

    return {
        format: sniffed.id as DocPictureFormat,
        image: data.length > budget ? null : { mimeType: sniffed.mime, bytes: data.slice() },
    };
}

// BITMAPCOREHEADER, BITMAPINFOHEADER and its later versions.
const DIB_HEADER_SIZES: ReadonlySet<number> = new Set([12, 40, 52, 56, 64, 108, 124]);
const DIB_BIT_COUNTS: ReadonlySet<number> = new Set([1, 2, 4, 8, 16, 24, 32]);
const INFO_HEADER_SIZE = 40;
// A BITMAPINFOHEADER's bit masks follow it, for BI_BITFIELDS and BI_ALPHABITFIELDS compression.
const BIT_MASK_SIZES: ReadonlyMap<number, number> = new Map([[3, 12], [6, 16]]);

// A device-independent bitmap with the 14-byte file header that makes it a BMP file;
// null when its header is damaged.
export function dibToBmp(dib: Uint8Array): DocImage | null {
    const headerSize = readUint32(dib, 0);

    if (!DIB_HEADER_SIZES.has(headerSize) || headerSize > dib.length) {
        return null;
    }

    const isCore = headerSize === 12;
    const bitCount = readUint16(dib, isCore ? 10 : 14);
    const compression = isCore ? 0 : readUint32(dib, 16);
    const usedColors = isCore ? 0 : readUint32(dib, 32);

    if (!DIB_BIT_COUNTS.has(bitCount)) {
        return null;
    }

    const paletteEntries = usedColors !== 0 ? usedColors : bitCount <= 8 ? 2 ** bitCount : 0;
    const masks = headerSize === INFO_HEADER_SIZE ? BIT_MASK_SIZES.get(compression) ?? 0 : 0;
    const pixelsAt = headerSize + masks + paletteEntries * (isCore ? 3 : 4);

    if (pixelsAt >= dib.length) {
        return null;
    }

    const bytes = new Uint8Array(BMP_FILE_HEADER_SIZE + dib.length);
    const view = new DataView(bytes.buffer);
    bytes[0] = 0x42;
    bytes[1] = 0x4d;
    view.setUint32(2, bytes.length, true);
    view.setUint32(10, BMP_FILE_HEADER_SIZE + pixelsAt, true);
    bytes.set(dib, BMP_FILE_HEADER_SIZE);

    return { mimeType: 'image/bmp', bytes };
}
