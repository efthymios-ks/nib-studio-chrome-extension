import type { ImageFormatId } from './imageFormat.js';

// Animated images are only walked up to this size, since counting frames reads the whole file.
export const FRAME_COUNT_MAX_BYTES = 32 * 1024 * 1024;

const COUNTERS: Partial<Record<ImageFormatId, (bytes: Uint8Array) => number | null>> = {
    gif: countGifFrames,
    png: countPngFrames,
    webp: countWebpFrames,
};

export function canCountFrames(format: ImageFormatId): boolean {
    return COUNTERS[format] != null;
}

// The number of frames in a GIF, PNG or WebP, 1 for a still image, or null for other formats and damaged files.
export function countImageFrames(bytes: Uint8Array, format: ImageFormatId): number | null {
    const counter = COUNTERS[format];

    if (counter == null) {
        return null;
    }

    try {
        return counter(bytes);
    }
    catch {
        return null;
    }
}

// Counts image descriptors, skipping colour tables, extensions and data sub-blocks without decoding them.
export function countGifFrames(bytes: Uint8Array): number | null {
    if (bytes.length < 13) {
        return null;
    }

    const screenFlags = byteAt(bytes, 10);
    let offset = 13 + colorTableLength(screenFlags);
    let frames = 0;

    while (offset < bytes.length) {
        const introducer = byteAt(bytes, offset);

        if (introducer === 0x3b) {
            break;
        }

        if (introducer === 0x2c) {
            const imageFlags = byteAt(bytes, offset + 9);
            offset = skipSubBlocks(bytes, offset + 10 + colorTableLength(imageFlags) + 1);
            frames += 1;
            continue;
        }

        if (introducer === 0x21) {
            offset = skipSubBlocks(bytes, offset + 2);
            continue;
        }

        break;
    }

    return frames === 0 ? null : frames;
}

// An animated PNG declares its frame count in the acTL chunk, which comes before the first image data.
export function countPngFrames(bytes: Uint8Array): number | null {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8;

    while (offset + 8 <= bytes.length) {
        const length = view.getUint32(offset);
        const type = ascii(bytes, offset + 4, 4);

        if (type === 'acTL') {
            return offset + 12 <= bytes.length ? view.getUint32(offset + 8) : null;
        }

        if (type === 'IDAT' || type === 'IEND') {
            return 1;
        }

        offset += 12 + length;
    }

    return null;
}

// An animated WebP has the animation flag in VP8X and one ANMF chunk per frame.
export function countWebpFrames(bytes: Uint8Array): number | null {
    if (bytes.length < 16 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
        return null;
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 12;
    let isAnimated = false;
    let frames = 0;

    while (offset + 8 <= bytes.length) {
        const type = ascii(bytes, offset, 4);
        const size = view.getUint32(offset + 4, true);

        if (type === 'VP8X') {
            isAnimated = (byteAt(bytes, offset + 8) & 0x02) !== 0;
        }

        if (type === 'ANMF') {
            frames += 1;
        }

        offset += 8 + size + (size % 2);
    }

    return isAnimated ? frames : 1;
}

function colorTableLength(flags: number): number {
    return (flags & 0x80) === 0 ? 0 : 3 * (2 ** ((flags & 0x07) + 1));
}

// Returns the offset just past the zero-length block that ends a run of sub-blocks.
function skipSubBlocks(bytes: Uint8Array, start: number): number {
    let offset = start;

    while (offset < bytes.length) {
        const size = byteAt(bytes, offset);
        offset += 1;

        if (size === 0) {
            return offset;
        }

        offset += size;
    }

    throw new Error('The image data ends inside a block.');
}

function byteAt(bytes: Uint8Array, offset: number): number {
    const value = bytes[offset];

    if (value == null) {
        throw new Error('The image data ends early.');
    }

    return value;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
    return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
