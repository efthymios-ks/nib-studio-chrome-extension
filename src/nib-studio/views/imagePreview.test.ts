import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildExifHeic,
    buildExifJpeg,
    buildFtyp,
    buildGif,
    buildHeifImage,
    buildPng,
    buildTiff,
    samplePhotoExif,
} from '../../common/image/testing/imageBuilders.js';
import { setClientSize } from '../testing/fakeAnimationClock.js';
import type { DecodedPixels, DecodeImageAsync } from './imageDecodeClient.js';
import { mountImagePreview } from './imagePreview.js';
import type { PreviewHandle } from './previewHandle.js';

// happy-dom decodes no images and draws on no canvas, so both are stood in for: an <img> reports the size
// given for its file name, and a canvas records what is drawn on it.
const naturalSizes = new Map<string, readonly [number, number]>();
const failingNames = new Set<string>();
const putImageData = vi.fn();
const drawImage = vi.fn();

let handles: PreviewHandle[] = [];
let host: HTMLElement;

// The image files the tests open, built byte by byte.
const SAMPLES = {
    'exif-gps.jpg': () => buildExifJpeg(samplePhotoExif()),
    'animated.gif': () => buildGif(3),
    'animated.png': () => buildPng(3),
    'plain.png': () => buildPng(1),
    'photo.heic': () => buildFtyp('heic', ['mif1', 'heic']),
    'exif-gps.heic': () => buildExifHeic(samplePhotoExif()),
    'portrait.heic': () => buildHeifImage({ width: 4032, height: 3024, quarterTurns: 1, mirrorAxis: 1 }),
    'two-pages.tif': () => buildTiff([
        {
            width: 1,
            height: 1,
            rgb: [0, 0, 0],
            extra: [{ tag: 0x010f, type: 2, value: 'Nib Scanner Co.' }, { tag: 0x0110, type: 2, value: 'Flatbed S2' }],
        },
        { width: 1, height: 1, rgb: [0, 0, 0] },
    ]),
} as const;

function fixtureFile(name: keyof typeof SAMPLES, fileName: string, type = ''): File {
    return new File([SAMPLES[name]().slice()], fileName, { type, lastModified: Date.UTC(2026, 0, 1) });
}

function mount(file: File, decodeImageAsync?: DecodeImageAsync): PreviewHandle {
    const handle = mountImagePreview(host, { file, fileName: file.name, memoryKey: `media/${file.name}`, decodeImageAsync });
    setClientSize(host.querySelector('.preview-viewport') as HTMLElement, 800, 600);
    handles.push(handle);

    return handle;
}

function rows(): Record<string, string> {
    return Object.fromEntries([...host.querySelectorAll('.preview-info-row')].map((row) => [
        `${row.closest('.preview-info-group')?.querySelector('.preview-info-title')?.textContent}/${row.querySelector('dt')?.textContent}`,
        row.querySelector('dd')?.textContent ?? '',
    ]));
}

function state(): string | undefined {
    return host.querySelector<HTMLElement>('.preview-frame')?.dataset['state'];
}

function copyButton(): HTMLButtonElement {
    return host.querySelector('[data-action="copy-image"]') as HTMLButtonElement;
}

function pixels(width: number, height: number, pageCount = 1): DecodedPixels {
    return { width, height, pixels: new Uint8ClampedArray(width * height * 4), pageCount };
}

beforeEach(() => {
    handles = [];
    naturalSizes.clear();
    failingNames.clear();
    putImageData.mockClear();
    drawImage.mockClear();
    host = document.createElement('div');
    document.body.append(host);
    vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(function (this: HTMLImageElement) {
        return failingNames.has(this.alt) ? Promise.reject(new Error('EncodingError')) : Promise.resolve();
    });
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockImplementation(function (this: HTMLImageElement) {
        return naturalSizes.get(this.alt)?.[0] ?? 0;
    });
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockImplementation(function (this: HTMLImageElement) {
        return naturalSizes.get(this.alt)?.[1] ?? 0;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ putImageData, drawImage } as unknown as RenderingContext);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['png'], { type: 'image/png' })));
    vi.stubGlobal('ImageData', class {
        constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
    });
});

afterEach(() => {
    for (const handle of handles) {
        handle.destroy();
    }

    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.querySelectorAll('.toast-stack').forEach((stack) => stack.remove());
});

describe('mountImagePreview with an image Chrome decodes', () => {
    it('shows a JPEG from a blob URL, upright at its displayed size, with EXIF in Info', async () => {
        naturalSizes.set('photo.jpg', [10, 16]);
        mount(fixtureFile('exif-gps.jpg', 'photo.jpg', 'image/jpeg'));

        await vi.waitFor(() => expect(rows()['Camera/Camera']).toBe('Nib Camera Co. Sample X1'));
        const image = host.querySelector<HTMLImageElement>('.preview-image');

        expect(state()).toBe('ready');
        expect(image?.tagName).toBe('IMG');
        expect(image?.getAttribute('src')).toMatch(/^blob:/);
        expect(rows()['File/Type']).toBe('JPEG image');
        expect(rows()['Image/Dimensions']).toBe('10 × 16 pixels');
        expect(rows()['Image/Orientation']).toBe('Rotated 90° clockwise (EXIF 6)');
        expect(rows()['Location/Coordinates']).toBe('33.859000° S, 70.500000° W');
        expect(copyButton().disabled).toBe(false);
        expect(host.querySelector('.preview-toolbar .badge')?.textContent).toBe('Image');
    });

    it('counts the frames of an animated GIF', async () => {
        naturalSizes.set('spinner.gif', [4, 4]);
        mount(fixtureFile('animated.gif', 'spinner.gif'));

        await vi.waitFor(() => expect(rows()['Image/Frames']).toBe('3 (animated)'));
        expect(rows()['File/Type']).toBe('GIF image');
    });

    it('names an animated PNG', async () => {
        naturalSizes.set('spinner.apng', [4, 4]);
        mount(fixtureFile('animated.png', 'spinner.apng'));

        await vi.waitFor(() => expect(rows()['File/Type']).toBe('Animated PNG image'));
    });

    it('shows an SVG through <img> as SVG, with its size attributes, and gives one without a size the shape of its viewBox', async () => {
        const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 10"><rect width="40" height="10"/></svg>'], 'line.svg');
        const createObjectURL = vi.spyOn(URL, 'createObjectURL');
        mount(svg);

        await vi.waitFor(() => expect(rows()['Image/viewBox']).toBe('0 0 40 10'));
        const blob = createObjectURL.mock.calls[0]?.[0] as Blob;

        expect(blob.type).toBe('image/svg+xml');
        expect(host.querySelector('.preview-image')?.tagName).toBe('IMG');
        expect(rows()['Image/Dimensions']).toBe('512 × 128 pixels');
        expect(rows()['Image/SVG width']).toBeUndefined();
    });

    it('shows a clear message for an image Chrome cannot decode, still listing the file', async () => {
        failingNames.add('broken.jpg');
        mount(new File([new Uint8Array([0xff, 0xd8, 0xff, 0, 1, 2])], 'broken.jpg'));

        await vi.waitFor(() => expect(state()).toBe('message'));
        expect(host.querySelector('.preview-status h2')?.textContent).toBe('This image can\'t be shown');
        expect(host.querySelector('.preview-status p')?.textContent).toMatch(/damaged/);
        expect(rows()['File/Type']).toBe('JPEG image');
        expect(copyButton().disabled).toBe(true);
    });

    it('keeps Ctrl+F, Ctrl with +, - or 0 and Ctrl+wheel from the browser page, over a picture or a message', async () => {
        const keyDown = (target: Element, key: string): boolean => {
            const event = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true });
            target.dispatchEvent(event);

            return event.defaultPrevented;
        };
        const ctrlWheel = (target: Element): boolean => {
            const event = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
            Object.defineProperty(event, 'ctrlKey', { value: true });
            target.dispatchEvent(event);

            return event.defaultPrevented;
        };
        failingNames.add('broken.jpg');
        mount(new File([new Uint8Array([0xff, 0xd8, 0xff, 0, 1, 2])], 'broken.jpg'));
        await vi.waitFor(() => expect(state()).toBe('message'));
        const message = host.querySelector('.preview-status') as HTMLElement;

        expect(['f', '=', '-', '0'].map((key) => keyDown(message, key))).toEqual([true, true, true, true]);
        expect(ctrlWheel(message)).toBe(true);
        expect(keyDown(host.querySelector('.preview-toolbar') as HTMLElement, 'f')).toBe(true);
    });

    it('lets go of its blob URL when destroyed', async () => {
        naturalSizes.set('plain.png', [4, 3]);
        const revoke = vi.spyOn(URL, 'revokeObjectURL');
        const handle = mount(fixtureFile('plain.png', 'plain.png', 'image/png'));
        await vi.waitFor(() => expect(state()).toBe('ready'));
        const url = host.querySelector('.preview-image')?.getAttribute('src');
        handle.destroy();

        expect(revoke).toHaveBeenCalledWith(url);
    });
});

describe('mountImagePreview with a bundled decoder', () => {
    it('draws TIFF pixels from the decoder on a canvas', async () => {
        const decode = vi.fn(async () => pixels(4, 2, 2));
        mount(fixtureFile('two-pages.tif', 'scan.tif'), decode);

        await vi.waitFor(() => expect(state()).toBe('ready'));
        const canvas = host.querySelector<HTMLCanvasElement>('canvas.preview-image');

        expect(decode).toHaveBeenCalledWith('tiff', expect.any(File));
        expect([canvas?.width, canvas?.height]).toEqual([4, 2]);
        expect(putImageData).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(rows()['File/Type']).toBe('TIFF image'));
    });

    it('lists TIFF pages and its tags', async () => {
        mount(fixtureFile('two-pages.tif', 'scan.tif'), async () => pixels(6, 4, 2));

        await vi.waitFor(() => expect(rows()['Image/Pages']).toBe('2, the first is shown'));
        expect(rows()['Camera/Camera']).toBe('Nib Scanner Co. Flatbed S2');
    });

    it('decodes each File snapshot once, however often the preview is mounted', async () => {
        const decode = vi.fn(async () => pixels(2, 2));
        const file = fixtureFile('two-pages.tif', 'scan.tif');
        mount(file, decode).destroy();
        await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
        mount(file, decode);
        await vi.waitFor(() => expect(state()).toBe('ready'));

        expect(decode).toHaveBeenCalledTimes(1);
        mount(fixtureFile('two-pages.tif', 'scan.tif'), decode);
        await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2));
    });

    it('shows the decoder\'s reason when it fails, and tries again on the next mount', async () => {
        const decode = vi.fn(async (): Promise<DecodedPixels> => {
            throw new Error('The TIFF image could not be decoded; its compression may not be supported.');
        });
        const file = fixtureFile('two-pages.tif', 'scan.tif');
        mount(file, decode).destroy();
        await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
        host.replaceChildren();
        mount(file, decode);

        await vi.waitFor(() => expect(host.querySelector('.preview-status p')?.textContent).toMatch(/compression/));
        expect(decode).toHaveBeenCalledTimes(2);
    });
});

describe('mountImagePreview with a HEIC picture, which is never decoded', () => {
    it('shows a message in place of a HEIC picture, with its file, camera and location in Info, and never decodes it', async () => {
        const decode = vi.fn(async () => pixels(4, 2));
        mount(fixtureFile('exif-gps.heic', 'IMG_0001.HEIC'), decode);

        await vi.waitFor(() => expect(rows()['Camera/Camera']).toBe('Nib Camera Co. Sample X1'));

        expect(state()).toBe('message');
        expect(host.querySelector('.preview-status h2')?.textContent).toBe('This picture can\'t be shown here');
        expect(host.querySelector('.preview-status p')?.textContent)
            .toBe('Nib Studio doesn\'t decode HEIC pictures. Its details are under Info.');
        expect(rows()['File/Name']).toBe('IMG_0001.HEIC');
        expect(rows()['File/Type']).toBe('HEIC image');
        expect(rows()['Camera/Date taken']).toMatch(/^2024-06-15 18:42:07/);
        expect(rows()['Location/Coordinates']).toBe('33.859000° S, 70.500000° W');
        // No ispe box gives its size, so the Image group holds only what the EXIF says.
        expect(Object.keys(rows()).filter((key) => key.startsWith('Image/'))).toEqual(['Image/Orientation']);
        expect(decode).not.toHaveBeenCalled();
        expect(host.querySelector('canvas')).toBeNull();
        expect(copyButton().disabled).toBe(true);
    });

    it('shows the size a HEIC is displayed at, read from its ispe and turned by its irot, without decoding it', async () => {
        const decode = vi.fn(async () => pixels(4, 2));
        mount(fixtureFile('portrait.heic', 'IMG_0002.HEIC'), decode);

        await vi.waitFor(() => expect(rows()['Image/Dimensions']).toBe('3,024 × 4,032 pixels'));

        expect(rows()['Image/Megapixels']).toBe('12.2 MP');
        expect(state()).toBe('message');
        expect(decode).not.toHaveBeenCalled();
    });

    it('lists only the File group for a HEIC without EXIF', async () => {
        mount(fixtureFile('photo.heic', 'photo.heic'), vi.fn(async () => pixels(4, 2)));

        await vi.waitFor(() => expect(rows()['File/Type']).toBe('HEIC image'));

        expect(state()).toBe('message');
        expect(Object.keys(rows()).every((key) => key.startsWith('File/'))).toBe(true);
    });
});

describe('mountImagePreview updates and copying', () => {
    it('ignores the same snapshot and reloads for a new one', async () => {
        const decode = vi.fn(async () => pixels(2, 2));
        const file = fixtureFile('two-pages.tif', 'scan.tif');
        const handle = mount(file, decode);
        await vi.waitFor(() => expect(state()).toBe('ready'));
        const canvas = host.querySelector('canvas');
        handle.update(file);
        handle.update(null);

        expect(host.querySelector('canvas')).toBe(canvas);

        decode.mockImplementation(async () => pixels(3, 5));
        handle.update(fixtureFile('two-pages.tif', 'scan.tif'));
        await vi.waitFor(() => expect(host.querySelector('canvas')?.height).toBe(5));
        expect(decode).toHaveBeenCalledTimes(2);
    });

    it('copies the image as PNG with the button and with Ctrl+C, and confirms with a toast', async () => {
        const write = vi.fn(async () => {});
        vi.stubGlobal('ClipboardItem', class {
            constructor(readonly data: Record<string, Promise<Blob>>) {}
        });
        vi.stubGlobal('navigator', { clipboard: { write } });
        naturalSizes.set('plain.png', [4, 3]);
        mount(fixtureFile('plain.png', 'plain.png', 'image/png'));
        await vi.waitFor(() => expect(copyButton().disabled).toBe(false));

        copyButton().click();
        await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(document.querySelector('.toast')?.textContent).toBe('Image copied to the clipboard as PNG.'));
        expect(drawImage).toHaveBeenCalledWith(host.querySelector('.preview-image'), 0, 0, 4, 3);

        const viewport = host.querySelector('.preview-viewport') as HTMLElement;
        viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    });

    it('says when the copy fails', async () => {
        vi.stubGlobal('ClipboardItem', class {});
        vi.stubGlobal('navigator', { clipboard: { write: async () => { throw new Error('Document is not focused.'); } } });
        naturalSizes.set('plain.png', [4, 3]);
        mount(fixtureFile('plain.png', 'plain.png', 'image/png'));
        await vi.waitFor(() => expect(copyButton().disabled).toBe(false));
        copyButton().click();

        await vi.waitFor(() => expect(document.querySelector('.toast[data-tone="fail"]')?.textContent).toBe('Could not copy the image: Document is not focused.'));
    });
});
