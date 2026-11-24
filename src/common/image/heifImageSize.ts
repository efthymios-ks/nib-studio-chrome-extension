import { readUint16BigEndian, readUint32BigEndian } from '../binary/bigEndian.js';

// The size a HEIF image (HEIC) shows at, read from the properties in its meta box without decoding it:
// the primary item's ispe gives the coded size, a clean aperture (clap) crops it,
// and a rotation (irot) of a quarter or three-quarter turn swaps width and height. A mirror (imir) keeps the size.

export interface HeifImageSize {
    readonly width: number;
    readonly height: number;
}

// A meta box larger than this is not read; even a photo made of many tiles keeps its meta box far smaller.
const HEIF_META_MAX_BYTES = 4 * 1024 * 1024;

// The top-level boxes looked at for the meta box, which comes right after ftyp in nearly every file.
const MAX_TOP_LEVEL_BOXES = 32;

const BOX_HEADER_BYTES = 16;

interface Box {
    readonly type: string;
    // Where the box's content starts, past its header.
    readonly start: number;
    readonly end: number;
}

// The size the primary image shows at, from the bytes of a meta box or of a whole file that starts with ftyp;
// null when either lacks a primary item, its ispe, or a box is cut short.
export function heifImageSize(bytes: Uint8Array): HeifImageSize | null {
    const metaBox = childBoxes(bytes, 0, bytes.length).find((box) => box.type === 'meta');

    if (metaBox == null) {
        return null;
    }

    // meta is a full box: its version and flags come before its children.
    const children = childBoxes(bytes, metaBox.start + 4, metaBox.end);
    const primaryItem = readPrimaryItem(bytes, children.find((box) => box.type === 'pitm'));
    const iprp = children.find((box) => box.type === 'iprp');

    if (primaryItem == null || iprp == null) {
        return null;
    }

    const propertyBoxes = childBoxes(bytes, iprp.start, iprp.end);
    const ipco = propertyBoxes.find((box) => box.type === 'ipco');

    if (ipco == null) {
        return null;
    }

    const properties = childBoxes(bytes, ipco.start, ipco.end);
    const associated = propertyBoxes
        .filter((box) => box.type === 'ipma')
        .flatMap((box) => readAssociations(bytes, box, primaryItem))
        .map((index) => properties[index - 1])
        .filter((box): box is Box => box != null);

    return displaySize(bytes, associated);
}

// The size from the image's ispe, then each transform in the order the file lists them.
function displaySize(bytes: Uint8Array, properties: ReadonlyArray<Box>): HeifImageSize | null {
    const ispe = properties.find((box) => box.type === 'ispe');

    if (ispe == null || ispe.end - ispe.start < 12) {
        return null;
    }

    let width = readUint32BigEndian(bytes, ispe.start + 4);
    let height = readUint32BigEndian(bytes, ispe.start + 8);

    for (const box of properties) {
        if (box.type === 'clap' && box.end - box.start >= 16) {
            width = fractionOf(bytes, box.start) ?? width;
            height = fractionOf(bytes, box.start + 8) ?? height;
        }

        if (box.type === 'irot' && box.end > box.start && ((bytes[box.start] ?? 0) & 0x01) === 1) {
            [width, height] = [height, width];
        }
    }

    return width > 0 && height > 0 ? { width, height } : null;
}

// A clean aperture's width or height: a fraction rounded to whole pixels,
// or null when it is not a positive number.
function fractionOf(bytes: Uint8Array, offset: number): number | null {
    const numerator = readUint32BigEndian(bytes, offset);
    const denominator = readUint32BigEndian(bytes, offset + 4);

    return denominator === 0 || numerator === 0 ? null : Math.round(numerator / denominator);
}

function readPrimaryItem(bytes: Uint8Array, pitm: Box | undefined): number | null {
    if (pitm == null) {
        return null;
    }

    const version = bytes[pitm.start] ?? 0;

    if (version === 0) {
        return pitm.end - pitm.start >= 6 ? readUint16BigEndian(bytes, pitm.start + 4) : null;
    }

    return pitm.end - pitm.start >= 8 ? readUint32BigEndian(bytes, pitm.start + 4) : null;
}

// The 1-based ipco indexes of the properties an ipma box ties to the item, in the order it lists them.
function readAssociations(bytes: Uint8Array, ipma: Box, item: number): number[] {
    const version = bytes[ipma.start] ?? 0;
    const hasWideIndexes = ((bytes[ipma.start + 3] ?? 0) & 0x01) === 1;
    const itemBytes = version < 1 ? 2 : 4;
    const indexBytes = hasWideIndexes ? 2 : 1;
    const entryCount = readUint32BigEndian(bytes, ipma.start + 4);
    let offset = ipma.start + 8;

    for (let entry = 0; entry < entryCount && offset + itemBytes + 1 <= ipma.end; entry += 1) {
        const entryItem = itemBytes === 2 ? readUint16BigEndian(bytes, offset) : readUint32BigEndian(bytes, offset);
        const count = bytes[offset + itemBytes] ?? 0;
        offset += itemBytes + 1;

        if (offset + count * indexBytes > ipma.end) {
            return [];
        }

        if (entryItem === item) {
            return Array.from({ length: count }, (_, position) => {
                const at = offset + position * indexBytes;

                // The top bit marks the property essential; the rest is its index.
                return hasWideIndexes ? readUint16BigEndian(bytes, at) & 0x7fff : (bytes[at] ?? 0) & 0x7f;
            });
        }

        offset += count * indexBytes;
    }

    return [];
}

// The boxes laid one after another between `start` and `end`; a box that runs past `end` ends the list.
function childBoxes(bytes: Uint8Array, start: number, end: number): Box[] {
    const boxes: Box[] = [];
    let offset = start;

    while (offset + 8 <= end) {
        const header = readBoxHeader(bytes, offset, end);

        if (header == null || offset + header.size > end) {
            break;
        }

        boxes.push({ type: header.type, start: offset + header.headerBytes, end: offset + header.size });
        offset += header.size;
    }

    return boxes;
}

interface BoxHeader {
    readonly type: string;
    readonly size: number;
    readonly headerBytes: number;
}

// A box's type and size; a size of 0 runs to `end`, and a size of 1 is followed by a 64-bit size.
function readBoxHeader(bytes: Uint8Array, offset: number, end: number): BoxHeader | null {
    const size = readUint32BigEndian(bytes, offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));

    if (size === 0) {
        return { type, size: end - offset, headerBytes: 8 };
    }

    if (size === 1) {
        const largeSize = readUint32BigEndian(bytes, offset + 8) * 2 ** 32 + readUint32BigEndian(bytes, offset + 12);

        return largeSize >= 16 && offset + 16 <= end ? { type, size: largeSize, headerBytes: 16 } : null;
    }

    return size >= 8 ? { type, size, headerBytes: 8 } : null;
}

// Walks a file's top-level boxes, reading only their headers, and reads the meta box alone;
// null when it has none, it is too large, or the file can't be read.
export async function readHeifImageSizeAsync(file: Blob): Promise<HeifImageSize | null> {
    try {
        let offset = 0;

        for (let count = 0; count < MAX_TOP_LEVEL_BOXES && offset + 8 <= file.size; count += 1) {
            const headerBytes = new Uint8Array(await file.slice(offset, offset + BOX_HEADER_BYTES).arrayBuffer());
            const header = readBoxHeader(headerBytes, 0, file.size - offset);

            if (header == null) {
                return null;
            }

            if (header.type === 'meta') {
                if (header.size > HEIF_META_MAX_BYTES) {
                    return null;
                }

                return heifImageSize(new Uint8Array(await file.slice(offset, offset + header.size).arrayBuffer()));
            }

            offset += header.size;
        }

        return null;
    }
    catch {
        return null;
    }
}
