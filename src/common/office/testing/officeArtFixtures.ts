import { u16, u32 } from './docFixtures.js';

// Builds OfficeArt records ([MS-ODRAW]) and the picture structures of Word 97–2003 files ([MS-DOC]) for tests:
// blips, blip store entries, shapes, PICF records, drawing data and floating picture anchors.

// A 1 × 1 PNG.
export const TINY_PNG: ReadonlyArray<number> = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
    0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

// A 1 × 1 24-bit device-independent bitmap: a BITMAPINFOHEADER, then one row padded to four bytes.
export const TINY_DIB: ReadonlyArray<number> = [
    ...u32(40), ...u32(1), ...u32(1), ...u16(1), ...u16(24), ...u32(0), ...u32(4), ...u32(2835), ...u32(2835), ...u32(0), ...u32(0),
    0x00, 0x00, 0xff, 0x00,
];

export const BLIP = Object.freeze({
    emf: { type: 0xf01a, instance: 0x3d4 },
    wmf: { type: 0xf01b, instance: 0x216 },
    jpeg: { type: 0xf01d, instance: 0x46a },
    png: { type: 0xf01e, instance: 0x6e0 },
    dib: { type: 0xf01f, instance: 0x7a8 },
    tiff: { type: 0xf029, instance: 0x6e4 },
});

interface RecordOptions {
    readonly version?: number;
    readonly instance?: number;
}

export function record(type: number, body: ReadonlyArray<number>, options: RecordOptions = {}): number[] {
    const header = (options.version ?? 0) | ((options.instance ?? 0) << 4);

    return [...u16(header), ...u16(type), ...u32(body.length), ...body];
}

export function container(type: number, children: ReadonlyArray<ReadonlyArray<number>>, instance = 0): number[] {
    return record(type, children.flat(), { version: 0x0f, instance });
}

interface BlipKind {
    readonly type: number;
    readonly instance: number;
}

// A blip: one identifier (two for an odd instance), then a bitmap's tag byte or a metafile's 34-byte header,
// then the data.
export function blip(kind: BlipKind, data: ReadonlyArray<number>, instance = kind.instance): number[] {
    const isMetafile = kind.type >= 0xf01a && kind.type <= 0xf01c;
    const uids = new Array<number>((instance & 1) === 1 ? 32 : 16).fill(0xab);
    const header = isMetafile ? new Array<number>(34).fill(0) : [0xff];

    return record(kind.type, [...uids, ...header, ...data], { instance });
}

interface EntryOptions {
    readonly blipType: number;
    // The blip held in the entry; without it the entry points into the delay stream.
    readonly embedded?: ReadonlyArray<number>;
    readonly delayOffset?: number;
    readonly size?: number;
}

// A blip store entry (OfficeArtFBSE).
export function blipStoreEntry(options: EntryOptions): number[] {
    const embedded = options.embedded ?? [];
    const body = [
        options.blipType, options.blipType,
        ...new Array<number>(16).fill(0xcd),
        ...u16(0xff),
        ...u32(options.size ?? embedded.length),
        ...u32(1),
        ...u32(options.delayOffset ?? 0xffffffff),
        0, 0, 0, 0,
        ...embedded,
    ];

    return record(0xf007, body, { version: 2, instance: options.blipType });
}

interface ShapeOptions {
    readonly id: number;
    readonly blipIndex?: number;
    // Each side's crop as a 16.16 fixed-point share.
    readonly crop?: { readonly top?: number; readonly right?: number; readonly bottom?: number; readonly left?: number };
    readonly description?: string;
}

// A shape container with its header (OfficeArtFSP) and a property table (OfficeArtFOPT).
export function shape(options: ShapeOptions): number[] {
    const simple: Array<readonly [number, number]> = [];

    if (options.blipIndex != null) {
        simple.push([0x4104, options.blipIndex]);
    }

    const crops: ReadonlyArray<readonly [number, number | undefined]> = [
        [0x0100, options.crop?.top],
        [0x0101, options.crop?.bottom],
        [0x0102, options.crop?.left],
        [0x0103, options.crop?.right],
    ];

    for (const [id, value] of crops) {
        if (value != null) {
            simple.push([id, value]);
        }
    }

    const description = options.description == null
        ? []
        : [...options.description, '\u0000'].flatMap((character) => u16(character.charCodeAt(0)));
    const entries = [
        ...simple.flatMap(([id, value]) => [...u16(id), ...u32(value)]),
        ...(description.length === 0 ? [] : [...u16(0x8381), ...u32(description.length)]),
    ];
    const count = simple.length + (description.length === 0 ? 0 : 1);

    return container(0xf004, [
        record(0xf00a, [...u32(options.id), ...u32(0x0a00)], { version: 2, instance: 75 }),
        record(0xf00b, [...entries, ...description], { version: 3, instance: count }),
    ]);
}

interface PicfOptions {
    // The goal size in twips and the scale in tenths of a percent.
    readonly width: number;
    readonly height: number;
    readonly scaleX?: number;
    readonly scaleY?: number;
    readonly mapMode?: number;
    readonly headerSize?: number;
    // A shape file's name, which follows the PICF.
    readonly name?: string;
    // The shape and blip store entries after the PICF.
    readonly records: ReadonlyArray<ReadonlyArray<number>>;
}

// A PICFAndOfficeArtData record, as the Data stream holds it for an inline picture.
export function picf(options: PicfOptions): number[] {
    const name = options.name == null
        ? []
        : [options.name.length, ...[...options.name].map((character) => character.charCodeAt(0))];
    const rest = [...name, ...options.records.flat()];
    const header = [
        ...u32(0x44 + rest.length),
        ...u16(options.headerSize ?? 0x44),
        ...u16(options.mapMode ?? (options.name == null ? 0x64 : 0x66)), ...u16(0), ...u16(0), ...u16(0),
        ...new Array<number>(14).fill(0),
        ...u16(options.width), ...u16(options.height), ...u16(options.scaleX ?? 1000), ...u16(options.scaleY ?? 1000),
        ...new Array<number>(30).fill(0),
        ...u16(0),
    ];

    return [...header, ...rest];
}

// The OfficeArtContent of a document: the drawing group with its blip store, then the main document's drawing.
export function drawingContent(
    entries: ReadonlyArray<ReadonlyArray<number>>,
    shapes: ReadonlyArray<ReadonlyArray<number>>,
): number[] {
    const group = container(0xf000, [
        record(0xf006, new Array<number>(16).fill(0)),
        container(0xf001, entries, entries.length),
    ]);
    const drawing = container(0xf002, [
        record(0xf008, [...u32(shapes.length), ...u32(0)], { instance: 1 }),
        container(0xf003, [container(0xf004, [record(0xf00a, [...u32(1024), ...u32(0x05)], { version: 2 })]), ...shapes]),
    ]);

    return [...group, 0x00, ...drawing];
}

interface AnchorOptions {
    readonly cp: number;
    readonly shapeId: number;
    // The rectangle in twips.
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

// A PlcfSpa: the anchors' character positions, then one FSPA each.
export function floatingAnchors(anchors: ReadonlyArray<AnchorOptions>): number[] {
    const last = (anchors.at(-1)?.cp ?? 0) + 1;

    return [
        ...anchors.flatMap((anchor) => u32(anchor.cp)),
        ...u32(last),
        ...anchors.flatMap((anchor) => [
            ...u32(anchor.shapeId), ...u32(anchor.left), ...u32(anchor.top), ...u32(anchor.right), ...u32(anchor.bottom),
            ...u16(0), ...u32(0),
        ]),
    ];
}
