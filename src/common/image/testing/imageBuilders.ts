// Builds small image files byte by byte for the image tests, so no sample files are needed.
// Only the structure the code under test reads is real: headers, chunks, IFDs and EXIF.
// Pixel data is raw where it is decoded (TIFF) and placeholder bytes where it is not (GIF, PNG, WebP).

export type TiffValue = string | number | ReadonlyArray<number> | { readonly rational: ReadonlyArray<readonly [number, number]> };

export interface TiffEntry {
    readonly tag: number;
    // 1 BYTE, 2 ASCII, 3 SHORT, 4 LONG, 5 RATIONAL.
    readonly type: 1 | 2 | 3 | 4 | 5;
    readonly value: TiffValue;
}

const TYPE_SIZES: Readonly<Record<number, number>> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 };

const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;

function asciiCodes(text: string): number[] {
    return [...text].map((character) => character.charCodeAt(0));
}

function uint16BigEndian(value: number): number[] {
    return [(value >>> 8) & 0xff, value & 0xff];
}

function uint32BigEndian(value: number): number[] {
    return [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function uint32LittleEndian(value: number): number[] {
    return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, value >>> 24];
}

function valueCount(entry: TiffEntry): number {
    if (typeof entry.value === 'string') {
        return entry.value.length + 1;
    }

    if (typeof entry.value === 'number') {
        return 1;
    }

    return 'rational' in entry.value ? entry.value.rational.length : entry.value.length;
}

function dataSize(entry: TiffEntry): number {
    return valueCount(entry) * (TYPE_SIZES[entry.type] ?? 1);
}

// The bytes an IFD takes: the entry count, 12 bytes an entry, the next-IFD offset, and values that don't fit in 4 bytes.
function ifdSize(entries: ReadonlyArray<TiffEntry>): number {
    const overflow = entries.reduce((sum, entry) => sum + (dataSize(entry) > 4 ? dataSize(entry) + (dataSize(entry) % 2) : 0), 0);

    return 2 + entries.length * 12 + 4 + overflow;
}

function writeValues(view: DataView, offset: number, entry: TiffEntry): void {
    const value = entry.value;

    if (typeof value === 'string') {
        [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
        view.setUint8(offset + value.length, 0);

        return;
    }

    if (typeof value === 'object' && 'rational' in value) {
        value.rational.forEach(([numerator, denominator], index) => {
            view.setUint32(offset + index * 8, numerator);
            view.setUint32(offset + index * 8 + 4, denominator);
        });

        return;
    }

    const values = typeof value === 'number' ? [value] : value;
    const size = TYPE_SIZES[entry.type] ?? 1;
    values.forEach((item, index) => {
        if (size === 1) {
            view.setUint8(offset + index, item);
        }

        if (size === 2) {
            view.setUint16(offset + index * 2, item);
        }

        if (size === 4) {
            view.setUint32(offset + index * 4, item);
        }
    });
}

// Writes one IFD at `start`, big-endian, values over 4 bytes after its entries; returns where the next IFD may go.
function writeIfd(view: DataView, start: number, entries: ReadonlyArray<TiffEntry>, next: number): number {
    const sorted = [...entries].sort((left, right) => left.tag - right.tag);
    let overflow = start + 2 + sorted.length * 12 + 4;
    view.setUint16(start, sorted.length);

    sorted.forEach((entry, index) => {
        const record = start + 2 + index * 12;
        view.setUint16(record, entry.tag);
        view.setUint16(record + 2, entry.type);
        view.setUint32(record + 4, valueCount(entry));

        if (dataSize(entry) <= 4) {
            writeValues(view, record + 8, entry);

            return;
        }

        view.setUint32(record + 8, overflow);
        writeValues(view, overflow, entry);
        overflow += dataSize(entry) + (dataSize(entry) % 2);
    });

    view.setUint32(start + 2 + sorted.length * 12, next);

    return overflow;
}

export interface ExifSections {
    readonly ifd0: ReadonlyArray<TiffEntry>;
    readonly exif?: ReadonlyArray<TiffEntry>;
    readonly gps?: ReadonlyArray<TiffEntry>;
}

// A big-endian TIFF structure holding IFD0 with optional EXIF and GPS sub-IFDs, as an APP1 segment carries it.
function buildExifTiff(sections: ExifSections): Uint8Array {
    const pointers: TiffEntry[] = [];
    const ifd0 = [...sections.ifd0, ...(sections.exif == null ? [] : [{ tag: TAG_EXIF_IFD, type: 4 as const, value: 0 }])];
    const withGps = [...ifd0, ...(sections.gps == null ? [] : [{ tag: TAG_GPS_IFD, type: 4 as const, value: 0 }])];
    const ifd0Start = 8;
    const exifStart = ifd0Start + ifdSize(withGps);
    const gpsStart = exifStart + (sections.exif == null ? 0 : ifdSize(sections.exif));
    const total = gpsStart + (sections.gps == null ? 0 : ifdSize(sections.gps));

    if (sections.exif != null) {
        pointers.push({ tag: TAG_EXIF_IFD, type: 4, value: exifStart });
    }

    if (sections.gps != null) {
        pointers.push({ tag: TAG_GPS_IFD, type: 4, value: gpsStart });
    }

    const bytes = new Uint8Array(total);
    const view = new DataView(bytes.buffer);
    bytes.set([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8]);
    writeIfd(view, ifd0Start, [...sections.ifd0, ...pointers], 0);

    if (sections.exif != null) {
        writeIfd(view, exifStart, sections.exif, 0);
    }

    if (sections.gps != null) {
        writeIfd(view, gpsStart, sections.gps, 0);
    }

    return bytes;
}

// A JPEG holding only an EXIF segment between its start and end markers; enough for EXIF readers and format sniffing.
export function buildExifJpeg(sections: ExifSections): Uint8Array {
    const tiff = buildExifTiff(sections);
    const length = 2 + 6 + tiff.length;

    return new Uint8Array([
        0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff,
        ...asciiCodes('Exif'), 0, 0,
        ...tiff,
        0xff, 0xd9,
    ]);
}

export interface TiffPage {
    readonly width: number;
    readonly height: number;
    // RGB, 3 bytes a pixel, rows top to bottom.
    readonly rgb: ReadonlyArray<number>;
    readonly extra?: ReadonlyArray<TiffEntry>;
}

// An uncompressed big-endian RGB TIFF with one strip a page, pages chained in order.
export function buildTiff(pages: ReadonlyArray<TiffPage>): Uint8Array {
    const entriesOf = (page: TiffPage, stripOffset: number): TiffEntry[] => [
        { tag: 256, type: 4, value: page.width },
        { tag: 257, type: 4, value: page.height },
        { tag: 258, type: 3, value: [8, 8, 8] },
        { tag: 259, type: 3, value: 1 },
        { tag: 262, type: 3, value: 2 },
        { tag: 273, type: 4, value: stripOffset },
        { tag: 277, type: 3, value: 3 },
        { tag: 278, type: 4, value: page.height },
        { tag: 279, type: 4, value: page.rgb.length },
        ...(page.extra ?? []),
    ];
    const layout: Array<{ ifd: number; strip: number }> = [];
    let offset = 8;

    for (const page of pages) {
        const strip = offset;
        offset += page.rgb.length + (page.rgb.length % 2);
        layout.push({ ifd: offset, strip });
        offset += ifdSize(entriesOf(page, 0));
    }

    const bytes = new Uint8Array(offset);
    const view = new DataView(bytes.buffer);
    bytes.set([0x4d, 0x4d, 0x00, 0x2a]);
    view.setUint32(4, layout[0]?.ifd ?? 0);

    pages.forEach((page, index) => {
        const place = layout[index] as { ifd: number; strip: number };
        bytes.set(page.rgb, place.strip);
        writeIfd(view, place.ifd, entriesOf(page, place.strip), layout[index + 1]?.ifd ?? 0);
    });

    return bytes;
}

// A GIF with one image descriptor a frame; the image data is a placeholder sub-block.
export function buildGif(frames: number): Uint8Array {
    const bytes = asciiCodes('GIF89a');
    bytes.push(4, 0, 4, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255);
    bytes.push(0x21, 0xff, 0x0b, ...asciiCodes('NETSCAPE2.0'), 3, 1, 0, 0, 0);

    for (let frame = 0; frame < frames; frame += 1) {
        bytes.push(0x21, 0xf9, 4, 0, 10, 0, 0, 0);
        bytes.push(0x2c, 0, 0, 0, 0, 4, 0, 4, 0, 0, 2, 2, 0x44, 0x01, 0);
    }

    bytes.push(0x3b);

    return new Uint8Array(bytes);
}

function pngChunk(type: string, data: ReadonlyArray<number>): number[] {
    return [...uint32BigEndian(data.length), ...asciiCodes(type), ...data, 0, 0, 0, 0];
}

// A PNG signature with IHDR, an acTL chunk when it is animated, and placeholder image data.
export function buildPng(frames: number): Uint8Array {
    const header = [0, 0, 0, 4, 0, 0, 0, 3, 8, 6, 0, 0, 0];
    const animation = frames > 1 ? pngChunk('acTL', [0, 0, 0, frames, 0, 0, 0, 0]) : [];

    return new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ...pngChunk('IHDR', header),
        ...animation,
        ...pngChunk('IDAT', [0, 0]),
        ...pngChunk('IEND', []),
    ]);
}

function riffChunk(type: string, data: ReadonlyArray<number>): number[] {
    const padding = data.length % 2 === 1 ? [0] : [];

    return [...asciiCodes(type), ...uint32LittleEndian(data.length), ...data, ...padding];
}

// A WebP: a lossless still image, or VP8X with the animation flag and one ANMF chunk a frame.
export function buildWebp(frames: number): Uint8Array {
    const animation = (): number[] => [
        ...riffChunk('VP8X', [0x02, 0, 0, 0, 3, 0, 0, 3, 0, 0]),
        ...riffChunk('ANIM', [0, 0, 0, 0, 0, 0]),
        ...Array.from({ length: frames }, () => riffChunk('ANMF', new Array(17).fill(0))).flat(),
    ];
    const chunks = frames > 1 ? animation() : riffChunk('VP8L', [0x2f, 0, 0, 0, 0]);

    const riffSize = uint32LittleEndian(4 + chunks.length);

    return new Uint8Array([...asciiCodes('RIFF'), ...riffSize, ...asciiCodes('WEBP'), ...chunks]);
}

// The leading ftyp box of an ISO base media file, which is all a HEIC or AVIF sniff reads.
export function buildFtyp(major: string, compatible: ReadonlyArray<string>): Uint8Array {
    const size = 16 + compatible.length * 4;
    const text = `ftyp${major}\0\0\0\0${compatible.join('')}`;

    return new Uint8Array([...uint32BigEndian(size), ...asciiCodes(text)]);
}

function isoBox(type: string, content: ReadonlyArray<number>): number[] {
    return [...uint32BigEndian(8 + content.length), ...asciiCodes(type), ...content];
}

function isoFullBox(type: string, version: number, content: ReadonlyArray<number>, flags = 0): number[] {
    return isoBox(type, [version, (flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff, ...content]);
}

// A HEIC holding only an Exif item: its ftyp, a meta box whose iinf names the item and whose iloc points into mdat,
// and the item in mdat as HEIF stores it, the offset to its TIFF header first. No image, so it can't be decoded.
export function buildExifHeic(sections: ExifSections): Uint8Array {
    const ftyp = buildFtyp('heic', ['mif1', 'heic']);
    const exifItem = [0, 0, 0, 6, ...asciiCodes('Exif'), 0, 0, ...buildExifTiff(sections)];
    const meta = (exifOffset: number): number[] => isoFullBox('meta', 0, [
        ...isoFullBox('iinf', 0, [0, 1, ...isoFullBox('infe', 2, [0, 1, 0, 0, ...asciiCodes('Exif'), 0])]),
        ...isoFullBox('iloc', 0, [0x44, 0x00, 0, 1, 0, 1, 0, 0, 0, 1, ...uint32BigEndian(exifOffset), ...uint32BigEndian(exifItem.length)]),
    ]);
    const exifOffset = ftyp.length + meta(0).length + 8;

    return new Uint8Array([...ftyp, ...meta(exifOffset), ...isoBox('mdat', exifItem)]);
}

export interface HeifImageOptions {
    readonly width: number;
    readonly height: number;
    // The irot property, in quarter turns anticlockwise; left out when null.
    readonly quarterTurns?: number;
    // The imir property's axis, 0 vertical and 1 horizontal; left out when null.
    readonly mirrorAxis?: 0 | 1;
    // A clean aperture (clap) cropping the image to this size, before any rotation.
    readonly crop?: { readonly width: number; readonly height: number };
    // A thumbnail item with its own ispe, listed before the primary item.
    readonly thumbnail?: { readonly width: number; readonly height: number };
    // Writes the ipma property indexes in 16 bits, as files with more than 127 properties do.
    readonly hasWideIndexes?: boolean;
    // Puts the media data before the meta box, as some writers do.
    readonly isMediaFirst?: boolean;
    // Leaves out the pitm box that names the primary item.
    readonly hasNoPrimaryItem?: boolean;
}

// A HEIC whose meta box describes its primary image: pitm names it, and iprp holds its properties in ipco
// and ties them to it in ipma. The image data is placeholder bytes, so it can't be decoded.
export function buildHeifImage(options: HeifImageOptions): Uint8Array {
    const primaryItem = 2;
    const thumbnailItem = 1;
    const properties: number[][] = [];
    const add = (box: number[]): number => properties.push(box);
    const sizeOf = (width: number, height: number): number[] => isoFullBox('ispe', 0, [
        ...uint32BigEndian(width),
        ...uint32BigEndian(height),
    ]);
    const decoderConfiguration = add(isoBox('hvcC', [1, 0, 0, 0]));
    const primary = [decoderConfiguration, add(sizeOf(options.width, options.height))];

    if (options.crop != null) {
        const fraction = (value: number): number[] => [...uint32BigEndian(value), ...uint32BigEndian(1)];
        const { width, height } = options.crop;
        primary.push(add(isoBox('clap', [...fraction(width), ...fraction(height), ...fraction(0), ...fraction(0)])));
    }

    if (options.quarterTurns != null) {
        primary.push(add(isoBox('irot', [options.quarterTurns & 0x03])));
    }

    if (options.mirrorAxis != null) {
        primary.push(add(isoBox('imir', [options.mirrorAxis])));
    }

    const entries: Array<readonly [number, ReadonlyArray<number>]> = [];

    if (options.thumbnail != null) {
        entries.push([thumbnailItem, [decoderConfiguration, add(sizeOf(options.thumbnail.width, options.thumbnail.height))]]);
    }

    entries.push([primaryItem, primary]);
    const hasWideIndexes = options.hasWideIndexes === true;
    const association = (index: number): number[] => (hasWideIndexes ? uint16BigEndian(0x8000 | index) : [0x80 | index]);
    const ipma = isoFullBox('ipma', 0, [
        ...uint32BigEndian(entries.length),
        ...entries.flatMap(([item, indexes]) => [...uint16BigEndian(item), indexes.length, ...indexes.flatMap(association)]),
    ], hasWideIndexes ? 1 : 0);
    const meta = isoFullBox('meta', 0, [
        ...isoFullBox('hdlr', 0, [0, 0, 0, 0, ...asciiCodes('pict'), ...new Array<number>(13).fill(0)]),
        ...(options.hasNoPrimaryItem === true ? [] : isoFullBox('pitm', 0, uint16BigEndian(primaryItem))),
        ...isoBox('iprp', [...isoBox('ipco', properties.flat()), ...ipma]),
    ]);
    const media = isoBox('mdat', [0, 0, 0, 0]);
    const ftyp = [...buildFtyp('heic', ['mif1', 'heic'])];

    return new Uint8Array(options.isMediaFirst === true ? [...ftyp, ...media, ...meta] : [...ftyp, ...meta, ...media]);
}

// The EXIF of a sample photo: camera, capture settings, rotated orientation and a GPS position south and west.
export function samplePhotoExif(): ExifSections {
    return {
        ifd0: [
            { tag: 0x010f, type: 2, value: 'Nib Camera Co.' },
            { tag: 0x0110, type: 2, value: 'Sample X1' },
            { tag: 0x0112, type: 3, value: 6 },
            { tag: 0x0131, type: 2, value: 'Nib Studio sample generator' },
        ],
        exif: [
            { tag: 0x829a, type: 5, value: { rational: [[1, 250]] } },
            { tag: 0x829d, type: 5, value: { rational: [[18, 10]] } },
            { tag: 0x8827, type: 3, value: 100 },
            { tag: 0x9003, type: 2, value: '2024:06:15 18:42:07' },
            { tag: 0x9011, type: 2, value: '+02:00' },
            { tag: 0x9209, type: 3, value: 25 },
            { tag: 0x920a, type: 5, value: { rational: [[42, 10]] } },
            { tag: 0xa405, type: 3, value: 26 },
            { tag: 0xa434, type: 2, value: 'Sample 4.2mm f/1.8' },
        ],
        gps: [
            { tag: 0x0000, type: 1, value: [2, 2, 0, 0] },
            { tag: 0x0001, type: 2, value: 'S' },
            { tag: 0x0002, type: 5, value: { rational: [[33, 1], [51, 1], [3240, 100]] } },
            { tag: 0x0003, type: 2, value: 'W' },
            { tag: 0x0004, type: 5, value: { rational: [[70, 1], [30, 1], [0, 1]] } },
            { tag: 0x0005, type: 1, value: [1] },
            { tag: 0x0006, type: 5, value: { rational: [[12, 1]] } },
        ],
    };
}
