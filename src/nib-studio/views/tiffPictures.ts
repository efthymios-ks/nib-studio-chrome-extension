import type { DecodedImage } from '../../common/image/decodedImage.js';
import { decodeTiff } from '../../common/image/tiffDecoder.js';
import type { DocBlock, DocImage, DocInline, DocParagraph } from '../../common/office/docModel.js';
import { pixelsToPngAsync } from './imageClipboard.js';

// Pictures a .doc stores as TIFF, which Chrome doesn't draw, decoded on this thread with the image preview's
// TIFF decoder and shown as PNG. A picture that doesn't decode keeps its "Picture (TIFF)" placeholder.

const TIFF_TYPE = 'image/tiff';
const PNG_TYPE = 'image/png';

// Encodes pixels as PNG; a picture whose encoding gives null or throws keeps its placeholder.
export type PngEncoder = (image: DecodedImage) => Promise<Uint8Array<ArrayBuffer> | null>;

// The PNG of each TIFF picture, so a picture placed twice, or shown again, is decoded once.
const conversions = new WeakMap<DocImage, Promise<DocImage | null>>();

export async function convertTiffPicturesAsync(
    blocks: ReadonlyArray<DocBlock>,
    encodeAsync: PngEncoder = encodePngAsync,
): Promise<ReadonlyArray<DocBlock>> {
    const tiffs = new Set(blocks.flatMap(paragraphsOf).flatMap((paragraph) => paragraph.inlines.flatMap(tiffImageOf)));

    if (tiffs.size === 0) {
        return blocks;
    }

    const converted = new Map(await Promise.all([...tiffs].map(async (image) => [image, await convertAsync(image, encodeAsync)] as const)));
    const convertParagraph = (paragraph: DocParagraph): DocParagraph => ({
        ...paragraph,
        inlines: paragraph.inlines.map((inline) => (
            inline.kind === 'picture' && inline.image != null && converted.has(inline.image)
                ? { ...inline, image: converted.get(inline.image) ?? null }
                : inline
        )),
    });

    return blocks.map((block) => {
        if (block.kind === 'paragraph') {
            return convertParagraph(block);
        }

        if (block.kind === 'table') {
            return {
                ...block,
                rows: block.rows.map((row) => ({
                    ...row,
                    cells: row.cells.map((cell) => ({ ...cell, paragraphs: cell.paragraphs.map(convertParagraph) })),
                })),
            };
        }

        return block;
    });
}

function paragraphsOf(block: DocBlock): ReadonlyArray<DocParagraph> {
    if (block.kind === 'paragraph') {
        return [block];
    }

    return block.kind === 'table' ? block.rows.flatMap((row) => row.cells.flatMap((cell) => cell.paragraphs)) : [];
}

function tiffImageOf(inline: DocInline): DocImage[] {
    return inline.kind === 'picture' && inline.image?.mimeType === TIFF_TYPE ? [inline.image] : [];
}

async function convertAsync(image: DocImage, encodeAsync: PngEncoder): Promise<DocImage | null> {
    const known = conversions.get(image);

    if (known != null) {
        return await known;
    }

    const pending = decodeToPngAsync(image, encodeAsync);
    conversions.set(image, pending);

    return await pending;
}

async function decodeToPngAsync(image: DocImage, encodeAsync: PngEncoder): Promise<DocImage | null> {
    try {
        const png = await encodeAsync(decodeTiff(image.bytes));

        return png == null ? null : { mimeType: PNG_TYPE, bytes: png };
    }
    catch {
        return null;
    }
}

async function encodePngAsync(image: DecodedImage): Promise<Uint8Array<ArrayBuffer>> {
    return new Uint8Array(await (await pixelsToPngAsync(image)).arrayBuffer());
}
