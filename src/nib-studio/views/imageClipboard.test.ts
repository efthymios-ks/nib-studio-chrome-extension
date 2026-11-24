import { afterEach, describe, expect, it, vi } from 'vitest';
import { canvasToPngAsync, copyPngToClipboardAsync, pixelsToPngAsync, renderPngAsync } from './imageClipboard.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('copyPngToClipboardAsync', () => {
    it('writes one ClipboardItem holding the PNG promise, so the click still counts while it encodes', async () => {
        const write = vi.fn(async () => {});
        const items: Array<Record<string, unknown>> = [];
        vi.stubGlobal('ClipboardItem', class {
            constructor(readonly data: Record<string, unknown>) {
                items.push(data);
            }
        });
        vi.stubGlobal('navigator', { clipboard: { write } });
        const png = Promise.resolve(new Blob(['png'], { type: 'image/png' }));

        await copyPngToClipboardAsync(png);

        expect(write).toHaveBeenCalledTimes(1);
        expect(Object.keys(items[0] ?? {})).toEqual(['image/png']);
        expect(items[0]?.['image/png']).toBe(png);
    });

    it('says so when the browser cannot put images on the clipboard', async () => {
        vi.stubGlobal('ClipboardItem', undefined);

        await expect(copyPngToClipboardAsync(Promise.resolve(new Blob()))).rejects.toThrow(/cannot put images/);
    });
});

describe('PNG rendering', () => {
    it('draws the source at its full size and encodes PNG', async () => {
        const drawImage = vi.fn();
        const png = new Blob(['png'], { type: 'image/png' });
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as RenderingContext);
        const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback, type) {
            expect(type).toBe('image/png');
            expect([this.width, this.height]).toEqual([400, 640]);
            callback(png);
        });
        const source = document.createElement('img');

        expect(await renderPngAsync(source, 400, 640)).toBe(png);
        expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 400, 640);
        expect(toBlob).toHaveBeenCalledTimes(1);
    });

    it('puts decoded pixels on a canvas of their size and encodes PNG', async () => {
        const putImageData = vi.fn();
        const png = new Blob(['png'], { type: 'image/png' });
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ putImageData } as unknown as RenderingContext);
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) {
            expect([this.width, this.height]).toEqual([2, 1]);
            callback(png);
        });

        expect(await pixelsToPngAsync({ width: 2, height: 1, pixels: new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]) })).toBe(png);
        const [image, left, top] = putImageData.mock.calls[0] as [ImageData, number, number];
        expect([image.width, image.height, left, top]).toEqual([2, 1, 0, 0]);
        expect([...image.data]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('fails clearly when there is no canvas to put pixels on', async () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

        await expect(pixelsToPngAsync({ width: 1, height: 1, pixels: new Uint8ClampedArray(4) })).rejects.toThrow(/no canvas/);
    });

    it('fails clearly when the canvas cannot encode', async () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(null));

        await expect(canvasToPngAsync(document.createElement('canvas'))).rejects.toThrow(/encoded as PNG/);
    });
});
