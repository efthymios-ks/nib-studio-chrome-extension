import { describe, expect, it } from 'vitest';
import { buildTiff } from './testing/imageBuilders.js';
import { decodeImageRequest } from './imageDecodeRequest.js';

const TIFF = buildTiff([
    { width: 2, height: 1, rgb: [1, 2, 3, 4, 5, 6] },
    { width: 1, height: 1, rgb: [7, 8, 9] },
]);

describe('decodeImageRequest', () => {
    it('decodes a TIFF request to straight RGBA, with its page count', () => {
        const response = decodeImageRequest({ id: 8, decoder: 'tiff', bytes: TIFF.slice().buffer });

        expect(response).toMatchObject({ id: 8, ok: true, width: 2, height: 1, pageCount: 2 });
        expect(response.ok && [...new Uint8Array(response.pixels)]).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
    });

    it('turns a failure into a message', () => {
        const response = decodeImageRequest({ id: 9, decoder: 'tiff', bytes: new ArrayBuffer(4) });

        expect(response.ok).toBe(false);
        expect(response.ok ? '' : response.message).not.toBe('');
    });
});
