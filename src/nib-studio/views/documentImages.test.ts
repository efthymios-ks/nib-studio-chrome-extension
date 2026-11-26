import { describe, expect, it, vi } from 'vitest';
import { asRoot, FakeDirectoryHandle } from '../../common/fs/testing/fakeFileSystem.js';
import { HEIC_NOT_DECODED_MESSAGE } from '../../common/image/imageFormat.js';
import { externalTabPath } from '../app/store.js';
import { createDocumentImageConverter, withDocumentImagesAsync } from './documentImages.js';
import type { DecodedPixels } from './imageDecodeClient.js';

const PIXELS: DecodedPixels = { width: 2, height: 1, pixels: new Uint8ClampedArray(8), pageCount: 1 };
const PNG = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });

describe('createDocumentImageConverter', () => {
    it('decodes a TIFF picture in the decode worker and encodes its pixels as PNG', async () => {
        const decodeImageAsync = vi.fn(async () => PIXELS);
        const encodePngAsync = vi.fn(async () => PNG);
        const file = new Blob([new Uint8Array([0x49, 0x49, 0x2a, 0x00])], { type: 'image/tiff' });
        const convertAsync = createDocumentImageConverter({ decodeImageAsync, encodePngAsync });

        expect(await convertAsync('tiff', file)).toBe(PNG);
        expect(decodeImageAsync).toHaveBeenCalledWith('tiff', file);
        expect(encodePngAsync).toHaveBeenCalledWith(PIXELS);
    });

    it('says Nib Studio doesn\'t decode HEIC pictures, without reaching the worker', async () => {
        const decodeImageAsync = vi.fn(async () => PIXELS);
        const convertAsync = createDocumentImageConverter({ decodeImageAsync, encodePngAsync: async () => PNG });

        await expect(convertAsync('heic', new Blob(['heic']))).rejects.toThrow(HEIC_NOT_DECODED_MESSAGE);
        expect(HEIC_NOT_DECODED_MESSAGE).toBe('Nib Studio doesn\'t decode HEIC pictures.');
        expect(decodeImageAsync).not.toHaveBeenCalled();
        expect(await convertAsync('tiff', new Blob(['tiff']))).toBe(PNG);
    });

    it('passes on why a picture didn\'t decode, for its placeholder', async () => {
        const convertAsync = createDocumentImageConverter({
            decodeImageAsync: async () => {
                throw new Error('The TIFF file holds no image.');
            },
            encodePngAsync: async () => PNG,
        });

        await expect(convertAsync('tiff', new Blob(['tiff']))).rejects.toThrow('The TIFF file holds no image.');
    });
});

describe('withDocumentImagesAsync', () => {
    const root = asRoot(new FakeDirectoryHandle('workspace'));

    it('reads the pictures of a workspace document from the workspace, and gives back what the render made', async () => {
        const result = await withDocumentImagesAsync('docs/a.md', root, async (context) => ({
            documentPath: context.documentPath,
            hasResources: context.resources != null,
        }));

        expect(result).toEqual({ documentPath: 'docs/a.md', hasResources: true });
    });

    it('reads no pictures for a file from outside the workspace, or with no workspace open', async () => {
        const outside = await withDocumentImagesAsync(externalTabPath(1, 'a.md'), root, async (context) => context);
        const noWorkspace = await withDocumentImagesAsync('docs/a.md', null, async (context) => context.resources);

        expect(outside).toEqual({ documentPath: null, resources: null });
        expect(noWorkspace).toBeNull();
    });

    it('passes a failed render on', async () => {
        await expect(withDocumentImagesAsync('docs/a.md', root, async () => {
            throw new Error('Render failed.');
        })).rejects.toThrow('Render failed.');
    });
});
