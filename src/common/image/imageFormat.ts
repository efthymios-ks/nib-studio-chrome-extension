import { readUint32BigEndian } from '../binary/bigEndian.js';
import { extension } from '../fs/fileEntry.js';

export type ImageFormatId =
    | 'png'
    | 'jpeg'
    | 'gif'
    | 'webp'
    | 'avif'
    | 'bmp'
    | 'ico'
    | 'cur'
    | 'svg'
    | 'heic'
    | 'tiff'
    | 'unknown';

// How the pixels are reached: Chrome draws native formats itself and TIFF goes through the bundled decoder.
// HEIC is never decoded: its HEVC compression is covered by patents, so a HEIC shows a message instead.
export type ImageDecoderKind = 'native' | 'heic' | 'tiff';

export interface ImageFormat {
    readonly id: ImageFormatId;
    readonly label: string;
    readonly mime: string;
    readonly decoder: ImageDecoderKind;
}

// Enough of the start of a file to tell every supported format apart, ISOBMFF brand lists included.
export const IMAGE_HEADER_BYTES = 64;

// What shows in place of a HEIC picture, in the image preview and in Markdown and HTML documents.
export const HEIC_NOT_DECODED_MESSAGE = 'Nib Studio doesn\'t decode HEIC pictures.';

const FORMATS: Readonly<Record<ImageFormatId, ImageFormat>> = Object.freeze({
    png: { id: 'png', label: 'PNG image', mime: 'image/png', decoder: 'native' },
    jpeg: { id: 'jpeg', label: 'JPEG image', mime: 'image/jpeg', decoder: 'native' },
    gif: { id: 'gif', label: 'GIF image', mime: 'image/gif', decoder: 'native' },
    webp: { id: 'webp', label: 'WebP image', mime: 'image/webp', decoder: 'native' },
    avif: { id: 'avif', label: 'AVIF image', mime: 'image/avif', decoder: 'native' },
    bmp: { id: 'bmp', label: 'BMP image', mime: 'image/bmp', decoder: 'native' },
    ico: { id: 'ico', label: 'Icon', mime: 'image/x-icon', decoder: 'native' },
    cur: { id: 'cur', label: 'Cursor', mime: 'image/x-icon', decoder: 'native' },
    svg: { id: 'svg', label: 'SVG image', mime: 'image/svg+xml', decoder: 'native' },
    heic: { id: 'heic', label: 'HEIC image', mime: 'image/heic', decoder: 'heic' },
    tiff: { id: 'tiff', label: 'TIFF image', mime: 'image/tiff', decoder: 'tiff' },
    unknown: { id: 'unknown', label: 'Image', mime: 'application/octet-stream', decoder: 'native' },
});

const FORMAT_BY_EXTENSION: ReadonlyMap<string, ImageFormatId> = new Map<string, ImageFormatId>([
    ['png', 'png'],
    ['apng', 'png'],
    ['jpg', 'jpeg'],
    ['jpeg', 'jpeg'],
    ['jfif', 'jpeg'],
    ['pjpeg', 'jpeg'],
    ['pjp', 'jpeg'],
    ['gif', 'gif'],
    ['webp', 'webp'],
    ['avif', 'avif'],
    ['bmp', 'bmp'],
    ['ico', 'ico'],
    ['cur', 'cur'],
    ['svg', 'svg'],
    ['heic', 'heic'],
    ['heif', 'heic'],
    ['hif', 'heic'],
    ['tif', 'tiff'],
    ['tiff', 'tiff'],
]);

const AVIF_BRANDS = new Set(['avif', 'avis']);
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

interface Signature {
    readonly format: ImageFormatId;
    readonly matches: (bytes: Uint8Array) => boolean;
}

// Order is priority; each entry checks magic bytes only, so a misnamed file still opens as what it is.
const SIGNATURES: ReadonlyArray<Signature> = [
    { format: 'png', matches: (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
    { format: 'jpeg', matches: (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]) },
    { format: 'gif', matches: (bytes) => ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a' },
    { format: 'webp', matches: (bytes) => ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP' },
    { format: 'bmp', matches: (bytes) => ascii(bytes, 0, 2) === 'BM' && bytes.length >= 14 },
    { format: 'ico', matches: (bytes) => startsWith(bytes, [0x00, 0x00, 0x01, 0x00]) },
    { format: 'cur', matches: (bytes) => startsWith(bytes, [0x00, 0x00, 0x02, 0x00]) },
    { format: 'tiff', matches: (bytes) => startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a]) },
    { format: 'avif', matches: (bytes) => isoBrands(bytes).some((brand) => AVIF_BRANDS.has(brand)) },
    { format: 'heic', matches: (bytes) => isoBrands(bytes).some((brand) => HEIC_BRANDS.has(brand)) },
    { format: 'svg', matches: (bytes) => looksLikeSvg(bytes) },
];

export function imageFormatById(id: ImageFormatId): ImageFormat {
    return FORMATS[id];
}

// The format of an image from its first bytes, falling back to the name's extension when the bytes say nothing.
export function sniffImageFormat(header: Uint8Array, fileName: string): ImageFormat {
    const signature = SIGNATURES.find((candidate) => candidate.matches(header));

    if (signature != null) {
        return FORMATS[signature.format];
    }

    return FORMATS[FORMAT_BY_EXTENSION.get(extension(fileName)) ?? 'unknown'];
}

// The major and compatible brands of an ISO base media file's leading `ftyp` box.
export function isoBrands(bytes: Uint8Array): string[] {
    if (bytes.length < 16 || ascii(bytes, 4, 4) !== 'ftyp') {
        return [];
    }

    const boxSize = readUint32BigEndian(bytes, 0);
    const end = Math.min(bytes.length, boxSize < 16 ? 16 : boxSize);
    const brands = [ascii(bytes, 8, 4)];

    for (let offset = 16; offset + 4 <= end; offset += 4) {
        brands.push(ascii(bytes, offset, 4));
    }

    return brands;
}

function looksLikeSvg(bytes: Uint8Array): boolean {
    // TextDecoder drops a leading byte order mark.
    const text = new TextDecoder().decode(bytes).trimStart();

    return text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'));
}

function startsWith(bytes: Uint8Array, prefix: ReadonlyArray<number>): boolean {
    return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
    if (bytes.length < offset + length) {
        return '';
    }

    return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
