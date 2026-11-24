import { describe, expect, it } from 'vitest';
import { blipOfEntry, dibToBmp, readBlip, readRecordAt, readRecords, readShape } from './officeArt.js';
import { u16, u32 } from './testing/docFixtures.js';
import { BLIP, blip, blipStoreEntry, record, shape, TINY_DIB, TINY_PNG } from './testing/officeArtFixtures.js';

function recordOf(bytes: ReadonlyArray<number>): NonNullable<ReturnType<typeof readRecordAt>> {
    const found = readRecordAt(Uint8Array.from(bytes), 0);

    if (found == null) {
        throw new Error('No record');
    }

    return found;
}

const GIF = [...'GIF89a'].map((character) => character.charCodeAt(0)).concat(1, 0, 1, 0, 0, 0, 0);

describe('readRecords', () => {
    it('reads records end to end and stops at one that runs past the end', () => {
        const bytes = Uint8Array.from([...record(0xf00a, [1, 2]), ...record(0xf00b, [3]), ...u16(0), ...u16(0xf00b), ...u32(99), 1]);

        expect(readRecords(bytes).map((found) => [found.type.toString(16), [...found.body]])).toEqual([['f00a', [1, 2]], ['f00b', [3]]]);
        expect(readRecordAt(bytes, bytes.length - 9)).toBeNull();
        expect(readRecordAt(bytes, -1)).toBeNull();
    });
});

describe('readBlip', () => {
    it('copies a PNG out of its blip, with one identifier or two', () => {
        for (const instance of [0x6e0, 0x6e1]) {
            const found = readBlip(recordOf(blip(BLIP.png, TINY_PNG, instance)), 1_000_000);

            expect(found.format).toBe('png');
            expect(found.image?.mimeType).toBe('image/png');
            expect([...(found.image?.bytes ?? [])]).toEqual(TINY_PNG);
        }
    });

    it('goes by the bytes rather than the stored type, so a PNG blip holding a GIF shows as a GIF', () => {
        expect(readBlip(recordOf(blip(BLIP.png, GIF)), 1000)).toMatchObject({ format: 'gif', image: { mimeType: 'image/gif' } });
    });

    it('names metafiles without an image, and keeps the bytes of a TIFF for the preview to decode', () => {
        const tiff = [0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0];

        expect(readBlip(recordOf(blip(BLIP.emf, [1, 2, 3])), 1000)).toEqual({ format: 'emf', image: null });
        expect(readBlip(recordOf(blip(BLIP.wmf, [1, 2, 3])), 1000)).toEqual({ format: 'wmf', image: null });
        expect(readBlip(recordOf(blip(BLIP.tiff, tiff)), 1000)).toEqual({ format: 'tiff', image: { mimeType: 'image/tiff', bytes: Uint8Array.from(tiff) } });
        expect(readBlip(recordOf(blip(BLIP.tiff, tiff)), 4)).toEqual({ format: 'tiff', image: null });
    });

    it('leaves out bytes that aren\'t the picture they claim to be, and pictures past the budget', () => {
        expect(readBlip(recordOf(blip(BLIP.jpeg, [1, 2, 3, 4])), 1000)).toEqual({ format: 'jpeg', image: null });
        expect(readBlip(recordOf(blip(BLIP.png, TINY_PNG)), TINY_PNG.length - 1)).toEqual({ format: 'png', image: null });
        expect(readBlip(recordOf(record(0xf00a, [1])), 1000)).toEqual({ format: null, image: null });
    });

    it('wraps a DIB in a BMP file header', () => {
        const found = readBlip(recordOf(blip(BLIP.dib, TINY_DIB)), 1000);

        expect(found.format).toBe('bmp');
        expect(found.image?.mimeType).toBe('image/bmp');
        expect([...(found.image?.bytes.subarray(0, 14) ?? [])]).toEqual([0x42, 0x4d, ...u32(14 + TINY_DIB.length), 0, 0, 0, 0, ...u32(54)]);
        expect([...(found.image?.bytes.subarray(14) ?? [])]).toEqual(TINY_DIB);
    });
});

describe('dibToBmp', () => {
    it('places the pixels after the palette and any bit masks', () => {
        const header = (bitCount: number, compression: number, usedColors: number): number[] => [
            ...u32(40), ...u32(1), ...u32(1), ...u16(1), ...u16(bitCount), ...u32(compression), ...u32(0), ...u32(0), ...u32(0), ...u32(usedColors), ...u32(0),
        ];
        const offset = (dib: ReadonlyArray<number>): number => new DataView(dibToBmp(Uint8Array.from(dib))?.bytes.buffer ?? new ArrayBuffer(14)).getUint32(10, true);

        expect(offset([...header(8, 0, 0), ...new Array<number>(256 * 4 + 4).fill(0)])).toBe(14 + 40 + 1024);
        expect(offset([...header(8, 0, 2), ...new Array<number>(2 * 4 + 4).fill(0)])).toBe(14 + 40 + 8);
        expect(offset([...header(16, 3, 0), ...new Array<number>(12 + 4).fill(0)])).toBe(14 + 40 + 12);
        expect(offset([...u32(12), ...u16(1), ...u16(1), ...u16(1), ...u16(1), ...new Array<number>(6 + 4).fill(0)])).toBe(14 + 12 + 6);
    });

    it('turns down a damaged header: an odd size, bit count or a palette past the end', () => {
        expect(dibToBmp(Uint8Array.from([...u32(41), ...new Array<number>(60).fill(0)]))).toBeNull();
        expect(dibToBmp(Uint8Array.from([...u32(40), ...u32(1), ...u32(1), ...u16(1), ...u16(0), ...new Array<number>(30).fill(0)]))).toBeNull();
        expect(dibToBmp(Uint8Array.from(TINY_DIB.slice(0, 40)))).toBeNull();
        expect(dibToBmp(Uint8Array.from([...u32(40), ...u32(1), ...u32(1), ...u16(1), ...u16(8), ...new Array<number>(30).fill(0)]))).toBeNull();
        expect(dibToBmp(new Uint8Array(2))).toBeNull();
    });
});

describe('blipOfEntry', () => {
    it('finds a blip inside an entry or in the delay stream, and nothing past its end', () => {
        const png = blip(BLIP.png, TINY_PNG);
        const delay = Uint8Array.from([0, 0, 0, ...png]);

        expect(blipOfEntry(recordOf(blipStoreEntry({ blipType: 6, embedded: png })), null)?.type).toBe(0xf01e);
        expect(blipOfEntry(recordOf(blipStoreEntry({ blipType: 6, delayOffset: 3, size: png.length })), delay)?.type).toBe(0xf01e);
        expect(blipOfEntry(recordOf(blipStoreEntry({ blipType: 6, delayOffset: 4, size: png.length })), delay)).toBeNull();
        expect(blipOfEntry(recordOf(blipStoreEntry({ blipType: 6, delayOffset: 9999 })), delay)).toBeNull();
        expect(blipOfEntry(recordOf(blipStoreEntry({ blipType: 6 })), delay)).toBeNull();
        expect(blipOfEntry(recordOf(png), null)?.type).toBe(0xf01e);
        expect(blipOfEntry(undefined, delay)).toBeNull();
    });
});

describe('readShape', () => {
    it('reads the shape id, its picture, crop and alternative text', () => {
        const found = readShape(recordOf(shape({ id: 1026, blipIndex: 2, crop: { left: 0x4000, top: 0x8000 }, description: 'A red square' })));

        expect(found).toEqual({ id: 1026, blipIndex: 2, crop: { top: 0.5, right: 0, bottom: 0, left: 0.25 }, description: 'A red square' });
    });

    it('takes a shape filled with a picture as showing it, and leaves out padding and crops that leave nothing', () => {
        const filled = record(0xf004, [
            ...record(0xf00a, [...u32(7), ...u32(0)], { version: 2 }),
            ...record(0xf00b, [...u16(0x0180), ...u32(3), ...u16(0x4186), ...u32(4), ...u16(0x0102), ...u32(-0x4000)], { version: 3, instance: 3 }),
        ], { version: 0x0f });
        const overCropped = shape({ id: 8, blipIndex: 1, crop: { left: 0x8000, right: 0x8000 } });

        expect(readShape(recordOf(filled))).toEqual({ id: 7, blipIndex: 4, crop: null, description: null });
        expect(readShape(recordOf(overCropped))?.crop).toBeNull();
        expect(readShape(recordOf(record(0xf004, [], { version: 0x0f })))).toBeNull();
    });
});
