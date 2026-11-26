import { writeClipboardAsync } from '../app/clipboard.js';
import type { DecodedImage } from '../../common/image/decodedImage.js';

// Draws an image at its full size onto a canvas and encodes it as PNG, whatever format it came from.
export async function renderPngAsync(
    source: CanvasImageSource,
    width: number,
    height: number,
): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    if (context == null) {
        throw new Error('The browser gave no canvas to draw the image on.');
    }

    context.drawImage(source, 0, 0, width, height);

    return await canvasToPngAsync(canvas);
}

// Encodes decoded pixels, such as a TIFF picture's, as PNG.
export async function pixelsToPngAsync(image: DecodedImage): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');

    if (context == null) {
        throw new Error('The browser gave no canvas to draw the image on.');
    }

    context.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);

    return await canvasToPngAsync(canvas);
}

export async function canvasToPngAsync(canvas: HTMLCanvasElement): Promise<Blob> {
    return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob == null) {
                reject(new Error('The image could not be encoded as PNG.'));

                return;
            }

            resolve(blob);
        }, 'image/png');
    });
}

// Puts a PNG on the clipboard; the click that asked for the copy still counts while the PNG is being encoded.
export async function copyPngToClipboardAsync(png: Promise<Blob>): Promise<void> {
    await writeClipboardAsync(png, { 'image/png': (blob) => blob });
}
