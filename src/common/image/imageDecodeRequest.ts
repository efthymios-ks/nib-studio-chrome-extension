import { decodeTiff } from './tiffDecoder.js';
import { errorMessage } from '../errorMessage.js';

// What the page asks the decode worker for; the bytes are transferred, not copied.
export interface ImageDecodeRequest {
    readonly id: number;
    readonly decoder: 'tiff';
    readonly bytes: ArrayBuffer;
}

export interface ImageDecodeSuccess {
    readonly id: number;
    readonly ok: true;
    readonly width: number;
    readonly height: number;
    // Straight RGBA, transferred back to the page.
    readonly pixels: ArrayBuffer;
    // The pages of the TIFF.
    readonly pageCount: number;
}

export interface ImageDecodeFailure {
    readonly id: number;
    readonly ok: false;
    readonly message: string;
}

export type ImageDecodeResponse = ImageDecodeSuccess | ImageDecodeFailure;

// Runs one request; any failure becomes a message for the preview instead of an exception in the worker.
export function decodeImageRequest(request: ImageDecodeRequest): ImageDecodeResponse {
    try {
        const decoded = decodeTiff(new Uint8Array(request.bytes));
        const isWholeBuffer = decoded.pixels.byteOffset === 0
            && decoded.pixels.byteLength === decoded.pixels.buffer.byteLength;
        const pixels = isWholeBuffer ? decoded.pixels.buffer as ArrayBuffer : decoded.pixels.slice().buffer;

        return {
            id: request.id,
            ok: true,
            width: decoded.width,
            height: decoded.height,
            pixels,
            pageCount: decoded.pageCount,
        };
    }
    catch (error) {
        return {
            id: request.id,
            ok: false,
            message: errorMessage(error),
        };
    }
}
