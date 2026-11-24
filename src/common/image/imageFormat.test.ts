import { describe, expect, it } from 'vitest';
import { buildExifJpeg, buildFtyp, buildGif, buildPng, buildTiff, buildWebp, samplePhotoExif } from './testing/imageBuilders.js';
import { IMAGE_HEADER_BYTES, imageFormatById, isoBrands, sniffImageFormat } from './imageFormat.js';

function header(bytes: Uint8Array): Uint8Array {
    return bytes.subarray(0, IMAGE_HEADER_BYTES);
}

const JPEG = buildExifJpeg(samplePhotoExif());
const TIFF = buildTiff([{ width: 1, height: 1, rgb: [0, 0, 0] }]);
const HEIC = buildFtyp('heic', ['mif1', 'heic']);

describe('sniffImageFormat', () => {
    it('recognises each format from its bytes', () => {
        expect(sniffImageFormat(header(buildPng(1)), 'a.png').id).toBe('png');
        expect(sniffImageFormat(header(buildPng(3)), 'a.apng').id).toBe('png');
        expect(sniffImageFormat(header(JPEG), 'a.jpg').id).toBe('jpeg');
        expect(sniffImageFormat(header(buildGif(2)), 'a.gif').id).toBe('gif');
        expect(sniffImageFormat(header(buildWebp(1)), 'a.webp').id).toBe('webp');
        expect(sniffImageFormat(header(TIFF), 'a.tif').id).toBe('tiff');
        expect(sniffImageFormat(header(HEIC), 'a.heic').id).toBe('heic');
    });

    it('trusts the bytes over a wrong extension', () => {
        expect(sniffImageFormat(header(JPEG), 'photo.png').id).toBe('jpeg');
        expect(sniffImageFormat(header(HEIC), 'photo.jpg').decoder).toBe('heic');
    });

    it('tells AVIF from HEIC by the ISO brands', () => {
        expect(sniffImageFormat(buildFtyp('avif', ['mif1', 'miaf']), 'x.heif').id).toBe('avif');
        expect(sniffImageFormat(buildFtyp('mif1', ['avif']), 'x.heif').id).toBe('avif');
        expect(sniffImageFormat(buildFtyp('heic', ['mif1']), 'x.avif').id).toBe('heic');
        expect(sniffImageFormat(buildFtyp('mif1', ['heic']), 'x.hif').id).toBe('heic');
    });

    it('recognises icons, cursors, bitmaps and little-endian TIFF', () => {
        expect(sniffImageFormat(new Uint8Array([0, 0, 1, 0, 1, 0]), 'x').id).toBe('ico');
        expect(sniffImageFormat(new Uint8Array([0, 0, 2, 0, 1, 0]), 'x').id).toBe('cur');
        expect(sniffImageFormat(new Uint8Array([0x42, 0x4d, ...new Array(20).fill(0)]), 'x').id).toBe('bmp');
        expect(sniffImageFormat(new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]), 'x').id).toBe('tiff');
    });

    it('recognises SVG text, with or without an XML declaration', () => {
        const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

        expect(sniffImageFormat(encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'x.txt').id).toBe('svg');
        expect(sniffImageFormat(encode('\uFEFF<?xml version="1.0"?><svg/>'), 'x').id).toBe('svg');
        expect(sniffImageFormat(encode('<?xml version="1.0"?>\n<!-- a long comment -->'), 'drawing.svg').id).toBe('svg');
    });

    it('falls back to the extension, then to unknown', () => {
        expect(sniffImageFormat(new Uint8Array(), 'scan.TIFF').id).toBe('tiff');
        expect(sniffImageFormat(new Uint8Array(), 'photo.hif').id).toBe('heic');
        expect(sniffImageFormat(new Uint8Array(), 'photo.pjp').id).toBe('jpeg');
        expect(sniffImageFormat(new Uint8Array([1, 2, 3]), 'mystery').id).toBe('unknown');
    });

    it('routes TIFF to the bundled decoder, HEIC to its message and the rest to Chrome', () => {
        expect(imageFormatById('heic').decoder).toBe('heic');
        expect(imageFormatById('tiff').decoder).toBe('tiff');
        expect(imageFormatById('avif').decoder).toBe('native');
        expect(imageFormatById('svg').mime).toBe('image/svg+xml');
    });
});

describe('isoBrands', () => {
    it('lists the major and compatible brands', () => {
        expect(isoBrands(buildFtyp('heic', ['mif1', 'heic']))).toEqual(['heic', 'mif1', 'heic']);
    });

    it('is empty for anything that is not an ftyp box', () => {
        expect(isoBrands(new Uint8Array(32))).toEqual([]);
        expect(isoBrands(new Uint8Array(4))).toEqual([]);
    });
});
