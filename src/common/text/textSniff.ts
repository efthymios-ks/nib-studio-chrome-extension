import { looksLikeSingleByteText } from './textEncoding.js';

// Whether a file of an unknown type is text, from its first bytes: UTF-16 behind a byte order mark is,
// and so is UTF-8 that is mostly valid and mostly free of control characters,
// or text in a single-byte code page, such as Greek in Windows-1253. A NUL anywhere else means it isn't.

export const TEXT_SNIFF_BYTES = 8 * 1024;

// Bytes that aren't valid UTF-8 and control characters may make up at most this share of the sample.
const MAX_SUSPECT_SHARE = 0.5;

const UTF16_BYTE_ORDER_MARKS: ReadonlyArray<readonly [number, number]> = [
    [0xff, 0xfe],
    [0xfe, 0xff],
];

// Tab, line feed, vertical tab, form feed, carriage return and escape, which coloured logs use,
// are at home in text.
const TEXT_CONTROLS = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1b]);

interface SequenceShape {
    readonly from: number;
    readonly to: number;
    readonly length: number;
    // The range the second byte must fall in, which rules out overlong forms,
    // surrogates and code points past U+10FFFF.
    readonly second: readonly [number, number];
}

const SEQUENCE_SHAPES: ReadonlyArray<SequenceShape> = [
    { from: 0xc2, to: 0xdf, length: 2, second: [0x80, 0xbf] },
    { from: 0xe0, to: 0xe0, length: 3, second: [0xa0, 0xbf] },
    { from: 0xe1, to: 0xec, length: 3, second: [0x80, 0xbf] },
    { from: 0xed, to: 0xed, length: 3, second: [0x80, 0x9f] },
    { from: 0xee, to: 0xef, length: 3, second: [0x80, 0xbf] },
    { from: 0xf0, to: 0xf0, length: 4, second: [0x90, 0xbf] },
    { from: 0xf1, to: 0xf3, length: 4, second: [0x80, 0xbf] },
    { from: 0xf4, to: 0xf4, length: 4, second: [0x80, 0x8f] },
];

export function looksLikeText(sample: Uint8Array): boolean {
    if (UTF16_BYTE_ORDER_MARKS.some(([first, second]) => sample[0] === first && sample[1] === second)) {
        return true;
    }

    if (sample.includes(0)) {
        return false;
    }

    const { characters, suspects, invalid } = scanUtf8(sample);

    if (characters === 0 || suspects / characters <= MAX_SUSPECT_SHARE) {
        return true;
    }

    // Bytes that do read as UTF-8 are judged as UTF-8 alone.
    return invalid > 0 && looksLikeSingleByteText(sample);
}

export async function looksLikeTextFileAsync(file: Blob): Promise<boolean> {
    return looksLikeText(new Uint8Array(await file.slice(0, TEXT_SNIFF_BYTES).arrayBuffer()));
}

interface Utf8Scan {
    // Each character, and each byte that starts no valid one.
    readonly characters: number;
    // The invalid bytes and the control characters among them.
    readonly suspects: number;
    // The invalid bytes alone.
    readonly invalid: number;
}

// Reads the sample as UTF-8, as the WHATWG decoder does;
// a character cut off by the end of the sample is left out.
function scanUtf8(bytes: Uint8Array): Utf8Scan {
    let characters = 0;
    let suspects = 0;
    let invalid = 0;
    let index = 0;

    while (index < bytes.length) {
        const length = sequenceLength(bytes, index);

        if (length < 0) {
            break;
        }

        characters += 1;

        if (length === 0) {
            suspects += 1;
            invalid += 1;
            index += 1;
            continue;
        }

        if (isControl(decode(bytes, index, length))) {
            suspects += 1;
        }

        index += length;
    }

    return { characters, suspects, invalid };
}

// The length of the valid sequence at `index`, 0 when the byte there starts none,
// or -1 when the sample ends inside one.
function sequenceLength(bytes: Uint8Array, index: number): number {
    const lead = bytes[index] ?? 0;

    if (lead < 0x80) {
        return 1;
    }

    const shape = SEQUENCE_SHAPES.find((candidate) => lead >= candidate.from && lead <= candidate.to);

    if (shape == null) {
        return 0;
    }

    for (let offset = 1; offset < shape.length; offset += 1) {
        if (index + offset >= bytes.length) {
            return -1;
        }

        const byte = bytes[index + offset] ?? 0;
        const [low, high] = offset === 1 ? shape.second : [0x80, 0xbf];

        if (byte < low || byte > high) {
            return 0;
        }
    }

    return shape.length;
}

function decode(bytes: Uint8Array, index: number, length: number): number {
    const lead = bytes[index] ?? 0;

    if (length === 1) {
        return lead;
    }

    let codePoint = lead & (0xff >> (length + 1));

    for (let offset = 1; offset < length; offset += 1) {
        codePoint = (codePoint << 6) | ((bytes[index + offset] ?? 0) & 0x3f);
    }

    return codePoint;
}

// The C0 controls other than those text uses, delete, and the C1 controls.
function isControl(codePoint: number): boolean {
    if (codePoint < 0x20) {
        return !TEXT_CONTROLS.has(codePoint);
    }

    return codePoint === 0x7f || (codePoint >= 0x80 && codePoint <= 0x9f);
}
