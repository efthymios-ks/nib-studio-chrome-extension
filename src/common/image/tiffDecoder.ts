import UTIF from 'utif2';
import { toArrayBuffer } from '../binary/bytes.js';
import { orientPixels, type DecodedImage } from './decodedImage.js';

// Decoded images above this many pixels are refused, so a huge scan can't exhaust memory; 120 MP is about 480 MB of RGBA.
const MAX_DECODED_PIXELS = 120_000_000;

export interface DecodedTiff extends DecodedImage {
    readonly pageCount: number;
}

// The part of UTIF this decoder uses: directories keyed "t" + tag number, then RGBA for one of them.
interface TiffDirectory {
    readonly [tag: string]: unknown;
}

interface TiffCodec {
    decode(buffer: ArrayBuffer): TiffDirectory[];
    decodeImage(buffer: ArrayBuffer, directory: TiffDirectory, directories?: TiffDirectory[]): void;
    toRGBA8(directory: TiffDirectory): Uint8Array;
}

const codec = UTIF as unknown as TiffCodec;

const TAG_NEW_SUBFILE_TYPE = 't254';
const TAG_WIDTH = 't256';
const TAG_HEIGHT = 't257';
const TAG_ORIENTATION = 't274';

// Decodes the first full-size page of a TIFF to upright RGBA, and counts its pages.
export function decodeTiff(bytes: Uint8Array): DecodedTiff {
    const buffer = toArrayBuffer(bytes);
    const directories = codec.decode(buffer);
    const pages = directories.filter(isFullSizePage);
    const page = pages[0];

    if (page == null) {
        throw new Error('The TIFF file holds no image.');
    }

    const width = tagNumber(page, TAG_WIDTH) ?? 0;
    const height = tagNumber(page, TAG_HEIGHT) ?? 0;

    if (width <= 0 || height <= 0) {
        throw new Error('The TIFF image has no size.');
    }

    if (width * height > MAX_DECODED_PIXELS) {
        throw new Error(`The image is too large to preview: ${width} × ${height} pixels.`);
    }

    codec.decodeImage(buffer, page, directories);
    const rgba = codec.toRGBA8(page);

    if (rgba.length < width * height * 4) {
        throw new Error('The TIFF image data could not be decoded.');
    }

    const stored = { width, height, pixels: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, width * height * 4) };
    const upright = orientPixels(stored, tagNumber(page, TAG_ORIENTATION) ?? 1);

    return { ...upright, pageCount: pages.length };
}

// An image directory that is not a reduced-size version, such as a thumbnail, of another page.
function isFullSizePage(directory: TiffDirectory): boolean {
    return tagNumber(directory, TAG_WIDTH) != null && (tagNumber(directory, TAG_NEW_SUBFILE_TYPE) ?? 0) % 2 === 0;
}

function tagNumber(directory: TiffDirectory, tag: string): number | null {
    const value = directory[tag];
    const first: unknown = Array.isArray(value) || ArrayBuffer.isView(value) ? (value as ArrayLike<unknown>)[0] : value;

    return typeof first === 'number' && Number.isFinite(first) ? first : null;
}
