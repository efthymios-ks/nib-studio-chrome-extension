import { describe, expect, it } from 'vitest';
import { createPictureReader, PICTURE_BYTES_LIMIT, type PictureSources } from './docPictures.js';
import { u32 } from './testing/docFixtures.js';
import {
    BLIP,
    blip,
    blipStoreEntry,
    drawingContent,
    floatingAnchors,
    picf,
    shape,
    TINY_PNG,
} from './testing/officeArtFixtures.js';

const NONE = { offset: 0, length: 0 };

function sources(overrides: Partial<PictureSources>): PictureSources {
    return { wordDocument: new Uint8Array(), table: new Uint8Array(), data: null, anchors: NONE, drawings: NONE, ...overrides };
}

// Two inline pictures of the same size, one after the other in the Data stream.
function twoInlinePictures(): { readonly data: Uint8Array; readonly second: number } {
    const first = picf({ width: 1500, height: 750, records: [shape({ id: 1, blipIndex: 1 }), blipStoreEntry({ blipType: 6, embedded: blip(BLIP.png, TINY_PNG) })] });

    return { data: Uint8Array.from([...first, ...first]), second: first.length };
}

describe('createPictureReader', () => {
    it('caps the bytes a document\'s pictures take, showing those past the cap as placeholders', () => {
        const { data, second } = twoInlinePictures();
        const reader = createPictureReader(sources({ data, byteLimit: TINY_PNG.length + 10 }));

        expect(reader.inline(0).image?.bytes.length).toBe(TINY_PNG.length);
        expect(reader.inline(second)).toMatchObject({ format: 'png', image: null, width: 100, height: 50 });
        expect(PICTURE_BYTES_LIMIT).toBe(50 * 1024 * 1024);
    });

    it('reads a picture placed twice once, so it counts once against the cap', () => {
        const delay = [0, ...blip(BLIP.png, TINY_PNG)];
        const shapes = [shape({ id: 2001, blipIndex: 1 }), shape({ id: 2002, blipIndex: 1 })];
        const anchors = floatingAnchors([
            { cp: 3, shapeId: 2001, left: 0, top: 0, right: 1500, bottom: 1500 },
            { cp: 9, shapeId: 2002, left: 0, top: 0, right: 3000, bottom: 1500 },
        ]);
        const content = drawingContent([blipStoreEntry({ blipType: 6, delayOffset: 1, size: delay.length - 1 })], shapes);
        const table = Uint8Array.from([...anchors, ...content]);
        const reader = createPictureReader(sources({
            wordDocument: Uint8Array.from(delay),
            table,
            anchors: { offset: 0, length: anchors.length },
            drawings: { offset: anchors.length, length: content.length },
            byteLimit: TINY_PNG.length,
        }));
        const first = reader.floating(3);
        const again = reader.floating(9);

        expect(first).toMatchObject({ layout: 'floating', format: 'png', width: 100, height: 100 });
        expect(again).toMatchObject({ width: 200, height: 100 });
        expect(again.image).toBe(first.image);
        expect(first.image).not.toBeNull();
    });

    it('shows a placeholder for damaged or out-of-range data, never throwing', () => {
        const { data } = twoInlinePictures();
        const badHeader = Uint8Array.from(picf({ width: 1500, height: 750, headerSize: 0x40, records: [] }));
        const badMode = Uint8Array.from(picf({ width: 1500, height: 750, mapMode: 8, records: [] }));
        const cut = data.subarray(0, 0x44 + 20);
        const readers = [
            [createPictureReader(sources({ data })), data.length - 10],
            [createPictureReader(sources({ data })), -5],
            [createPictureReader(sources({ data: badHeader })), 0],
            [createPictureReader(sources({ data: badMode })), 0],
            [createPictureReader(sources({ data: cut })), 0],
            [createPictureReader(sources({})), 0],
        ] as const;

        for (const [reader, location] of readers) {
            expect(reader.inline(location)).toMatchObject({ kind: 'picture', layout: 'inline', format: null, image: null });
        }

        const table = Uint8Array.from([...floatingAnchors([{ cp: 1, shapeId: 5, left: 0, top: 0, right: 10, bottom: 10 }]), ...u32(0xffffffff)]);
        const floating = [
            createPictureReader(sources({ table, anchors: { offset: 0, length: 9999 } })),
            createPictureReader(sources({ table, anchors: { offset: 0, length: 34 }, drawings: { offset: 34, length: 4 } })),
            createPictureReader(sources({ table, anchors: { offset: 0, length: 34 }, drawings: { offset: 9000, length: 400 } })),
        ];

        for (const reader of floating) {
            expect(reader.floating(1)).toMatchObject({ layout: 'floating', format: null, image: null });
        }
    });

    it('keeps the image at its own size when the document\'s size is out of range', () => {
        const data = Uint8Array.from(picf({ width: 0, height: 750, records: [shape({ id: 1, blipIndex: 1 }), blip(BLIP.png, TINY_PNG)] }));

        expect(createPictureReader(sources({ data })).inline(0)).toMatchObject({ format: 'png', width: null, height: null });
    });
});
