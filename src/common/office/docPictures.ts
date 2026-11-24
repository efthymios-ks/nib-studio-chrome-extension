import { readInt16, readInt32, readUint16, readUint32 } from '../binary/littleEndian.js';
import type { DocCrop, DocPicture } from './docModel.js';
import {
    blipOfEntry,
    type BlipPicture,
    type OfficeArtRecord,
    type OfficeArtShape,
    readBlip,
    readBlipStore,
    readRecordAt,
    readRecords,
    readShape,
    readShapes,
    RECORD_TYPES,
} from './officeArt.js';
import { TWIPS_PER_PIXEL } from './pageGeometry.js';

// The pictures of a Word 97–2003 document ([MS-DOC] and [MS-ODRAW]):
// an inline picture's PICF record sits in the Data
// stream, and a floating picture's anchor (FSPA) and shape sit in the table stream,
// its picture in the blip store.

// The most picture bytes one document shows; pictures past it show as placeholders.
export const PICTURE_BYTES_LIMIT = 50 * 1024 * 1024;

interface StreamRange {
    readonly offset: number;
    readonly length: number;
}

export interface PictureSources {
    // Also the delay stream, which holds the blip store's pictures.
    readonly wordDocument: Uint8Array;
    readonly table: Uint8Array;
    readonly data: Uint8Array | null;
    // Where the main text's floating pictures anchor (PlcSpaMom).
    readonly anchors: StreamRange;
    // The drawing group with the blip store, then the drawings (OfficeArtContent).
    readonly drawings: StreamRange;
    readonly byteLimit?: number;
}

export interface DocPictureReader {
    // The inline picture whose PICF record is at `location` in the Data stream.
    inline(location: number | null): DocPicture;
    // The floating picture anchored at character position `cp` of the main text.
    floating(cp: number): DocPicture;
}

// The reader of a file whose pictures the preview doesn't read: every picture shows as a placeholder.
export const NO_PICTURES: DocPictureReader = Object.freeze({
    inline: () => placeholder('inline'),
    floating: () => placeholder('floating'),
});

// Pictures larger than this many pixels a side are taken as damaged sizes and shown at their own size.
const MAX_PICTURE_SIDE = 20_000;
const PICF_SIZE = 0x44;
const MAP_MODES: ReadonlySet<number> = new Set([0x64, 0x66]);
// A shape file (0x66) names its file after the PICF.
const MAP_MODE_SHAPE_FILE = 0x66;
const FSPA_SIZE = 26;
// The main document's drawing, as opposed to the headers' one.
const MAIN_DRAWING = 0;

interface Anchor {
    readonly shapeId: number;
    readonly width: number;
    readonly height: number;
}

interface Drawings {
    readonly shapes: ReadonlyMap<number, OfficeArtShape>;
    readonly store: ReadonlyArray<OfficeArtRecord>;
}

// Reads each picture when the text reaches it, and the drawing data once, at the first floating picture.
// Anything damaged or out of range shows as a placeholder.
export function createPictureReader(sources: PictureSources): DocPictureReader {
    const limit = sources.byteLimit ?? PICTURE_BYTES_LIMIT;
    const blips = new Map<string, BlipPicture>();
    let usedBytes = 0;
    let anchors: ReadonlyMap<number, Anchor> | null = null;
    let drawings: Drawings | null = null;

    // A picture placed more than once is read and shown from the same bytes.
    const pictureOf = (key: string, blip: OfficeArtRecord | null): BlipPicture => {
        const known = blips.get(key);

        if (known != null) {
            return known;
        }

        const found = blip == null ? { format: null, image: null } : readBlip(blip, limit - usedBytes);
        usedBytes += found.image?.bytes.length ?? 0;
        blips.set(key, found);

        return found;
    };

    return {
        inline: (location) => {
            const { data } = sources;

            if (location == null || data == null) {
                return placeholder('inline');
            }

            return safely(() => readInlinePicture({ data, location, delay: sources.wordDocument, pictureOf }), 'inline');
        },
        floating: (cp) => safely(() => {
            anchors ??= readAnchors(sources.table, sources.anchors);
            const anchor = anchors.get(cp);

            if (anchor == null) {
                return placeholder('floating');
            }

            drawings ??= readDrawings(sources.table, sources.drawings);
            const shape = drawings.shapes.get(anchor.shapeId);

            if (shape == null || shape.blipIndex === 0) {
                return placeholder('floating');
            }

            const blip = blipOfEntry(drawings.store[shape.blipIndex - 1], sources.wordDocument);
            const found = pictureOf(`store:${shape.blipIndex}`, blip);

            return picture({ layout: 'floating', found, size: anchor, shape });
        }, 'floating'),
    };
}

function safely(read: () => DocPicture, layout: DocPicture['layout']): DocPicture {
    try {
        return read();
    }
    catch {
        return placeholder(layout);
    }
}

function placeholder(layout: DocPicture['layout']): DocPicture {
    return { kind: 'picture', layout, format: null, image: null, width: null, height: null, crop: null, description: null };
}

interface PictureSize {
    readonly width: number;
    readonly height: number;
}

interface PictureInput {
    readonly layout: DocPicture['layout'];
    readonly found: BlipPicture;
    readonly size: PictureSize;
    readonly shape: OfficeArtShape | null;
}

function picture({ layout, found, size, shape }: PictureInput): DocPicture {
    const isSane = [size.width, size.height].every((side) => Number.isFinite(side) && side > 0 && side <= MAX_PICTURE_SIDE);

    return {
        kind: 'picture',
        layout,
        format: found.format,
        image: found.image,
        width: isSane ? Math.round(size.width * 100) / 100 : null,
        height: isSane ? Math.round(size.height * 100) / 100 : null,
        crop: shape?.crop ?? null,
        description: shape?.description ?? null,
    };
}

interface InlineInput {
    readonly data: Uint8Array;
    readonly location: number;
    readonly delay: Uint8Array;
    readonly pictureOf: (key: string, blip: OfficeArtRecord | null) => BlipPicture;
}

// A PICFAndOfficeArtData record: the PICF with the picture's size,
// then a shape and the blip store entries it uses.
function readInlinePicture({ data, location, delay, pictureOf }: InlineInput): DocPicture {
    if (location < 0 || location + PICF_SIZE > data.length) {
        return placeholder('inline');
    }

    const total = readUint32(data, location);
    const mapMode = readUint16(data, location + 6);

    if (readUint16(data, location + 4) !== PICF_SIZE || total < PICF_SIZE || !MAP_MODES.has(mapMode)) {
        return placeholder('inline');
    }

    const end = Math.min(data.length, location + total);
    const recordsAt = location + PICF_SIZE + (mapMode === MAP_MODE_SHAPE_FILE ? 1 + (data[location + PICF_SIZE] ?? 0) : 0);
    const records = readRecords(data, recordsAt, end);
    const shapeRecord = records.find((record) => record.type === RECORD_TYPES.shape);
    const shape = shapeRecord == null ? null : readShape(shapeRecord);
    const entries = records.filter((record) => record !== shapeRecord);
    const entry = entries[(shape?.blipIndex ?? 0) - 1] ?? entries[0];

    return picture({
        layout: 'inline',
        found: pictureOf(`data:${location}`, blipOfEntry(entry, delay)),
        size: inlineSize(data, location, shape?.crop ?? null),
        shape,
    });
}

// The PICF's goal size, before cropping and scaling, its scale in tenths of a percent,
// less what the shape crops away.
function inlineSize(data: Uint8Array, location: number, crop: DocCrop | null): PictureSize {
    const side = (goalAt: number, scaleAt: number, cropped: number): number => {
        const scale = readUint16(data, location + scaleAt);

        return (readInt16(data, location + goalAt) * (scale === 0 ? 1 : scale / 1000) * (1 - cropped)) / TWIPS_PER_PIXEL;
    };

    return {
        width: side(28, 32, (crop?.left ?? 0) + (crop?.right ?? 0)),
        height: side(30, 34, (crop?.top ?? 0) + (crop?.bottom ?? 0)),
    };
}

// The PlcfSpa: one character position per anchor, then one FSPA each,
// with the shape id and its rectangle in twips.
function readAnchors(table: Uint8Array, range: StreamRange): Map<number, Anchor> {
    const anchors = new Map<number, Anchor>();
    const count = Math.floor((range.length - 4) / (4 + FSPA_SIZE));

    if (count < 1 || range.offset + range.length > table.length) {
        return anchors;
    }

    const descriptorsAt = range.offset + (count + 1) * 4;

    for (let index = 0; index < count; index += 1) {
        const at = descriptorsAt + index * FSPA_SIZE;
        const cp = readUint32(table, range.offset + index * 4);

        if (!anchors.has(cp)) {
            anchors.set(cp, {
                shapeId: readUint32(table, at),
                width: (readInt32(table, at + 12) - readInt32(table, at + 4)) / TWIPS_PER_PIXEL,
                height: (readInt32(table, at + 16) - readInt32(table, at + 8)) / TWIPS_PER_PIXEL,
            });
        }
    }

    return anchors;
}

// The drawing group with its blip store, then each drawing after a byte that says whose it is.
function readDrawings(table: Uint8Array, range: StreamRange): Drawings {
    const end = Math.min(table.length, range.offset + range.length);
    const group = readRecordAt(table, range.offset, end);

    if (range.length === 0 || group?.type !== RECORD_TYPES.drawingGroup) {
        return { shapes: new Map(), store: [] };
    }

    const shapes = new Map<number, OfficeArtShape>();
    let position = range.offset + 8 + group.body.length;

    while (position < end) {
        const owner = table[position] ?? MAIN_DRAWING;
        const drawing = readRecordAt(table, position + 1, end);

        if (drawing == null) {
            break;
        }

        if (drawing.type === RECORD_TYPES.drawing) {
            for (const [id, shape] of readShapes(drawing)) {
                if (owner === MAIN_DRAWING || !shapes.has(id)) {
                    shapes.set(id, shape);
                }
            }
        }

        position += 1 + 8 + drawing.body.length;
    }

    return { shapes, store: readBlipStore(group) };
}
