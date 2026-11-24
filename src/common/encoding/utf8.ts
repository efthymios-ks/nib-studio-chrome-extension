export interface Utf8Text {
    readonly text: string;
    // Byte offset of the first byte that isn't valid UTF-8, or null when every byte is; such bytes show as U+FFFD.
    readonly invalidAt: number | null;
}

export function encodeUtf8(text: string): Uint8Array<ArrayBuffer> {
    return new TextEncoder().encode(text);
}

export function decodeUtf8(bytes: Uint8Array): Utf8Text {
    return {
        text: new TextDecoder().decode(bytes),
        invalidAt: findInvalidUtf8(bytes),
    };
}

// Offset of the first byte that starts or continues an ill-formed sequence, following the Unicode table of
// well-formed UTF-8: no overlong forms, no surrogates, nothing past U+10FFFF.
export function findInvalidUtf8(bytes: Uint8Array): number | null {
    let index = 0;

    while (index < bytes.length) {
        const lead = bytes[index] ?? 0;

        if (lead < 0x80) {
            index += 1;
            continue;
        }

        const shape = UTF8_SHAPES.find((candidate) => lead >= candidate.leadFrom && lead <= candidate.leadTo);

        if (shape == null) {
            return index;
        }

        for (let offset = 1; offset <= shape.continuations; offset += 1) {
            const continuation = bytes[index + offset];
            const [from, to] = offset === 1 ? shape.secondRange : [0x80, 0xbf];

            if (continuation == null || continuation < from || continuation > to) {
                return index;
            }
        }

        index += shape.continuations + 1;
    }

    return null;
}

// Index of a high surrogate with no low surrogate after it, or a low one with no high one before it.
export function findUnpairedSurrogate(text: string): number | null {
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);

        if (code >= 0xd800 && code <= 0xdbff) {
            const next = text.charCodeAt(index + 1);

            if (next >= 0xdc00 && next <= 0xdfff) {
                index += 1;
                continue;
            }

            return index;
        }

        if (code >= 0xdc00 && code <= 0xdfff) {
            return index;
        }
    }

    return null;
}

interface Utf8Shape {
    readonly leadFrom: number;
    readonly leadTo: number;
    readonly continuations: number;
    readonly secondRange: readonly [number, number];
}

const UTF8_SHAPES: ReadonlyArray<Utf8Shape> = [
    { leadFrom: 0xc2, leadTo: 0xdf, continuations: 1, secondRange: [0x80, 0xbf] },
    { leadFrom: 0xe0, leadTo: 0xe0, continuations: 2, secondRange: [0xa0, 0xbf] },
    { leadFrom: 0xe1, leadTo: 0xec, continuations: 2, secondRange: [0x80, 0xbf] },
    { leadFrom: 0xed, leadTo: 0xed, continuations: 2, secondRange: [0x80, 0x9f] },
    { leadFrom: 0xee, leadTo: 0xef, continuations: 2, secondRange: [0x80, 0xbf] },
    { leadFrom: 0xf0, leadTo: 0xf0, continuations: 3, secondRange: [0x90, 0xbf] },
    { leadFrom: 0xf1, leadTo: 0xf3, continuations: 3, secondRange: [0x80, 0xbf] },
    { leadFrom: 0xf4, leadTo: 0xf4, continuations: 3, secondRange: [0x80, 0x8f] },
];
