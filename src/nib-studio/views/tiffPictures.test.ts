import { describe, expect, it, vi } from 'vitest';
import UTIF from 'utif2';
import type { DecodedImage } from '../../common/image/decodedImage.js';
import type { DocBlock, DocImage, DocParagraph, DocPicture } from '../../common/office/docModel.js';
import { convertTiffPicturesAsync, type PngEncoder } from './tiffPictures.js';

const PNG_BYTES = Uint8Array.of(0x89, 0x50, 0x4e, 0x47);

// A 2 × 1 TIFF: one red pixel and one blue one.
function tinyTiff(): DocImage {
    const encoder = UTIF as unknown as { encodeImage(rgba: ArrayBuffer, width: number, height: number): ArrayBuffer };
    const rgba = Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 255);

    return { mimeType: 'image/tiff', bytes: new Uint8Array(encoder.encodeImage(rgba.buffer, 2, 1)) };
}

function picture(image: DocImage | null): DocPicture {
    return { kind: 'picture', layout: 'inline', format: 'tiff', image, width: 20, height: 10, crop: null, description: 'Map' };
}

function paragraph(...inlines: DocParagraph['inlines']): DocParagraph {
    return { kind: 'paragraph', role: 'body', level: 0, alignment: 'start', list: null, inlines };
}

function imageAt(blocks: ReadonlyArray<DocBlock>, path: 'paragraph' | 'cell'): DocImage | null {
    const block = blocks[path === 'paragraph' ? 0 : 1];
    const inline = block?.kind === 'paragraph'
        ? block.inlines[0]
        : block?.kind === 'table' ? block.rows[0]?.cells[0]?.paragraphs[0]?.inlines[0] : undefined;

    return inline?.kind === 'picture' ? inline.image : null;
}

describe('convertTiffPicturesAsync', () => {
    it('decodes TIFF pictures in paragraphs and table cells and shows them as PNG, decoding a repeated one once', async () => {
        const tiff = tinyTiff();
        const decoded: DecodedImage[] = [];
        const encodeAsync: PngEncoder = vi.fn(async (image) => {
            decoded.push(image);

            return PNG_BYTES.slice();
        });
        const blocks: DocBlock[] = [
            paragraph(picture(tiff)),
            { kind: 'table', rows: [{ isHeader: false, cells: [{ paragraphs: [paragraph(picture(tiff))] }] }] },
            { kind: 'page-break' },
        ];

        const converted = await convertTiffPicturesAsync(blocks, encodeAsync);

        expect(imageAt(converted, 'paragraph')).toEqual({ mimeType: 'image/png', bytes: PNG_BYTES });
        expect(imageAt(converted, 'cell')).toBe(imageAt(converted, 'paragraph'));
        expect(converted[2]).toBe(blocks[2]);
        expect(encodeAsync).toHaveBeenCalledTimes(1);
        expect([decoded[0]?.width, decoded[0]?.height, [...decoded[0]?.pixels ?? []]]).toEqual([2, 1, [255, 0, 0, 255, 0, 0, 255, 255]]);
    });

    it('keeps the placeholder for a TIFF that doesn\'t decode, or when the browser gives no canvas', async () => {
        const broken: DocImage = { mimeType: 'image/tiff', bytes: Uint8Array.of(0x49, 0x49, 0x2a, 0x00, 0xff, 0xff, 0xff, 0xff) };
        const noCanvas: PngEncoder = async () => null;

        expect(imageAt(await convertTiffPicturesAsync([paragraph(picture(broken))], async () => PNG_BYTES), 'paragraph')).toBeNull();
        expect(imageAt(await convertTiffPicturesAsync([paragraph(picture(tinyTiff()))], noCanvas), 'paragraph')).toBeNull();
    });

    it('gives back the same blocks when no picture is a TIFF', async () => {
        const png: DocImage = { mimeType: 'image/png', bytes: PNG_BYTES };
        const blocks: DocBlock[] = [paragraph({ kind: 'text', text: 'Hi', format: 0 }, picture(png))];
        const encodeAsync = vi.fn(async () => PNG_BYTES);

        expect(await convertTiffPicturesAsync(blocks, encodeAsync)).toBe(blocks);
        expect(encodeAsync).not.toHaveBeenCalled();
    });
});
