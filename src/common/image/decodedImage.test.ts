import { describe, expect, it } from 'vitest';
import { orientPixels, type DecodedImage } from './decodedImage.js';

// A 3 × 2 image whose pixels are numbered 1 to 6 in their red channel, row by row.
function numbered(): DecodedImage {
    const pixels = new Uint8ClampedArray(3 * 2 * 4);

    for (let index = 0; index < 6; index += 1) {
        pixels[index * 4] = index + 1;
        pixels[index * 4 + 3] = 255;
    }

    return { width: 3, height: 2, pixels };
}

function rows(image: DecodedImage): number[][] {
    const result: number[][] = [];

    for (let row = 0; row < image.height; row += 1) {
        const values: number[] = [];

        for (let column = 0; column < image.width; column += 1) {
            values.push(image.pixels[(row * image.width + column) * 4] ?? -1);
        }

        result.push(values);
    }

    return result;
}

describe('orientPixels', () => {
    it('leaves orientation 1 and unknown values untouched', () => {
        const image = numbered();

        expect(orientPixels(image, 1)).toBe(image);
        expect(orientPixels(image, 0)).toBe(image);
        expect(orientPixels(image, 9)).toBe(image);
    });

    it('mirrors and turns for every EXIF orientation', () => {
        const image = numbered();

        expect(rows(orientPixels(image, 2))).toEqual([[3, 2, 1], [6, 5, 4]]);
        expect(rows(orientPixels(image, 3))).toEqual([[6, 5, 4], [3, 2, 1]]);
        expect(rows(orientPixels(image, 4))).toEqual([[4, 5, 6], [1, 2, 3]]);
        expect(rows(orientPixels(image, 5))).toEqual([[1, 4], [2, 5], [3, 6]]);
        expect(rows(orientPixels(image, 6))).toEqual([[4, 1], [5, 2], [6, 3]]);
        expect(rows(orientPixels(image, 7))).toEqual([[6, 3], [5, 2], [4, 1]]);
        expect(rows(orientPixels(image, 8))).toEqual([[3, 6], [2, 5], [1, 4]]);
    });

    it('swaps the size for the quarter turns', () => {
        const turned = orientPixels(numbered(), 6);

        expect([turned.width, turned.height]).toEqual([2, 3]);
    });

    it('copes with pixels that start part way into a buffer', () => {
        const backing = new Uint8ClampedArray(1 + 3 * 2 * 4);
        backing.set(numbered().pixels, 1);
        const image = { width: 3, height: 2, pixels: backing.subarray(1) };

        expect(rows(orientPixels(image, 3))).toEqual([[6, 5, 4], [3, 2, 1]]);
    });
});
