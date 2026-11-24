import { describe, expect, it } from 'vitest';
import { buildExifHeic, buildFtyp, buildHeifImage, samplePhotoExif } from './testing/imageBuilders.js';
import { heifImageSize, readHeifImageSizeAsync } from './heifImageSize.js';

function blobOf(bytes: Uint8Array): Blob {
    return new Blob([bytes.slice()]);
}

describe('heifImageSize', () => {
    it('reads the width and height of the primary image from its ispe property', () => {
        expect(heifImageSize(buildHeifImage({ width: 4032, height: 3024 }))).toEqual({ width: 4032, height: 3024 });
    });

    it('swaps them for a quarter or three-quarter turn, and keeps them for a half turn', () => {
        expect(heifImageSize(buildHeifImage({ width: 4032, height: 3024, quarterTurns: 1 }))).toEqual({ width: 3024, height: 4032 });
        expect(heifImageSize(buildHeifImage({ width: 4032, height: 3024, quarterTurns: 3 }))).toEqual({ width: 3024, height: 4032 });
        expect(heifImageSize(buildHeifImage({ width: 4032, height: 3024, quarterTurns: 2 }))).toEqual({ width: 4032, height: 3024 });
    });

    it('keeps them for a mirror on either axis, with or without a turn', () => {
        expect(heifImageSize(buildHeifImage({ width: 640, height: 480, mirrorAxis: 0 }))).toEqual({ width: 640, height: 480 });
        expect(heifImageSize(buildHeifImage({ width: 640, height: 480, mirrorAxis: 1, quarterTurns: 1 }))).toEqual({ width: 480, height: 640 });
    });

    it('crops to a clean aperture before turning', () => {
        const bytes = buildHeifImage({ width: 4096, height: 3072, crop: { width: 4032, height: 3024 }, quarterTurns: 1 });

        expect(heifImageSize(bytes)).toEqual({ width: 3024, height: 4032 });
    });

    it('picks the primary image over a thumbnail listed before it', () => {
        const bytes = buildHeifImage({ width: 4032, height: 3024, thumbnail: { width: 320, height: 240 } });

        expect(heifImageSize(bytes)).toEqual({ width: 4032, height: 3024 });
    });

    it('reads property indexes written in 16 bits', () => {
        const bytes = buildHeifImage({ width: 800, height: 600, quarterTurns: 1, hasWideIndexes: true });

        expect(heifImageSize(bytes)).toEqual({ width: 600, height: 800 });
    });

    it('gives null without a primary item, without an ispe, or for bytes that are not HEIF', () => {
        expect(heifImageSize(buildHeifImage({ width: 800, height: 600, hasNoPrimaryItem: true }))).toBeNull();
        expect(heifImageSize(buildExifHeic(samplePhotoExif()))).toBeNull();
        expect(heifImageSize(buildFtyp('heic', ['mif1']))).toBeNull();
        expect(heifImageSize(new Uint8Array([0, 0, 0, 1, 0x6d, 0x65, 0x74]))).toBeNull();
    });

    it('gives null for a meta box cut short', () => {
        expect(heifImageSize(buildHeifImage({ width: 800, height: 600 }).subarray(0, 60))).toBeNull();
    });
});

describe('readHeifImageSizeAsync', () => {
    it('finds the meta box of a file and reads the size from it', async () => {
        const size = await readHeifImageSizeAsync(blobOf(buildHeifImage({ width: 4032, height: 3024, quarterTurns: 1 })));

        expect(size).toEqual({ width: 3024, height: 4032 });
    });

    it('steps over media data written before the meta box', async () => {
        const size = await readHeifImageSizeAsync(blobOf(buildHeifImage({ width: 1920, height: 1080, isMediaFirst: true })));

        expect(size).toEqual({ width: 1920, height: 1080 });
    });

    it('gives null for a file with no meta box, or an empty file', async () => {
        expect(await readHeifImageSizeAsync(blobOf(buildFtyp('heic', ['mif1'])))).toBeNull();
        expect(await readHeifImageSizeAsync(new Blob([]))).toBeNull();
    });
});
