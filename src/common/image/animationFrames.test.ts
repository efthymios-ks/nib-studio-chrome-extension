import { describe, expect, it } from 'vitest';
import { buildExifJpeg, buildGif, buildPng, buildWebp, samplePhotoExif } from './testing/imageBuilders.js';
import { canCountFrames, countGifFrames, countImageFrames, countPngFrames, countWebpFrames } from './animationFrames.js';

describe('countImageFrames', () => {
    it('counts the frames of animated GIF, PNG and WebP fixtures', () => {
        expect(countImageFrames(buildGif(3), 'gif')).toBe(3);
        expect(countImageFrames(buildPng(3), 'png')).toBe(3);
        expect(countImageFrames(buildWebp(3), 'webp')).toBe(3);
    });

    it('reports a still image as one frame', () => {
        expect(countImageFrames(buildGif(1), 'gif')).toBe(1);
        expect(countImageFrames(buildPng(1), 'png')).toBe(1);
        expect(countImageFrames(buildWebp(1), 'webp')).toBe(1);
    });

    it('has no count for formats without frames', () => {
        expect(canCountFrames('jpeg')).toBe(false);
        expect(canCountFrames('gif')).toBe(true);
        expect(countImageFrames(buildExifJpeg(samplePhotoExif()), 'jpeg')).toBeNull();
    });

    it('gives null for damaged data instead of throwing', () => {
        const gif = buildGif(3);

        expect(countImageFrames(gif.subarray(0, 40), 'gif')).toBeNull();
        expect(countGifFrames(new Uint8Array(5))).toBeNull();
        expect(countPngFrames(new Uint8Array(8))).toBeNull();
        expect(countWebpFrames(new Uint8Array(20))).toBeNull();
    });
});
