import { describe, expect, it } from 'vitest';
import { buildTiff } from './testing/imageBuilders.js';
import { decodeTiff } from './tiffDecoder.js';

function pixel(image: { width: number; pixels: Uint8ClampedArray }, column: number, row: number): number[] {
    const start = (row * image.width + column) * 4;

    return [...image.pixels.subarray(start, start + 4)];
}

function solid(width: number, height: number, rgb: readonly [number, number, number]): number[] {
    return Array.from({ length: width * height }, () => rgb).flat();
}

// A 3 × 2 page of six colours, stored sideways with EXIF orientation 6.
const ROTATED = buildTiff([{
    width: 3,
    height: 2,
    rgb: [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 128, 128, 128],
    extra: [{ tag: 274, type: 3, value: 6 }],
}]);

describe('decodeTiff', () => {
    it('decodes the first page and counts the pages', () => {
        const tiff = buildTiff([
            { width: 6, height: 4, rgb: solid(6, 4, [10, 20, 30]) },
            { width: 3, height: 2, rgb: solid(3, 2, [200, 100, 50]) },
        ]);
        const image = decodeTiff(tiff);

        expect([image.width, image.height, image.pageCount]).toEqual([6, 4, 2]);
        expect(pixel(image, 0, 0)).toEqual([10, 20, 30, 255]);
        expect(pixel(image, 5, 3)).toEqual([10, 20, 30, 255]);
    });

    it('turns the pixels upright for the orientation tag', () => {
        const image = decodeTiff(ROTATED);

        expect([image.width, image.height]).toEqual([2, 3]);
        expect(pixel(image, 0, 0)).toEqual([255, 255, 255, 255]);
        expect(pixel(image, 1, 0)).toEqual([255, 0, 0, 255]);
        expect(pixel(image, 0, 1)).toEqual([0, 0, 0, 255]);
        expect(pixel(image, 1, 1)).toEqual([0, 255, 0, 255]);
        expect(pixel(image, 0, 2)).toEqual([128, 128, 128, 255]);
        expect(pixel(image, 1, 2)).toEqual([0, 0, 255, 255]);
    });

    it('decodes bytes that sit part way into a larger buffer', () => {
        const backing = new Uint8Array(ROTATED.length + 3);
        backing.set(ROTATED, 3);

        expect(decodeTiff(backing.subarray(3)).height).toBe(3);
    });

    it('throws a readable error for bytes that are no TIFF', () => {
        expect(() => decodeTiff(new Uint8Array([0x49, 0x49, 0x2a, 0, 0, 0, 0, 0]))).toThrow(/no image/);
    });
});
