import { describe, expect, it } from 'vitest';
import { decodeUtf8, encodeUtf8, findInvalidUtf8, findUnpairedSurrogate } from './utf8.js';

describe('encodeUtf8 / decodeUtf8', () => {
    it('round-trips text in every UTF-8 length', () => {
        const text = 'a · π · ✓ · 😀';
        const decoded = decodeUtf8(encodeUtf8(text));

        expect(decoded).toEqual({ text, invalidAt: null });
    });

    it('shows invalid bytes as U+FFFD and reports where they start', () => {
        const decoded = decodeUtf8(new Uint8Array([0x61, 0x62, 0xff, 0x63]));

        expect(decoded).toEqual({ text: 'ab�c', invalidAt: 2 });
    });
});

describe('findInvalidUtf8', () => {
    const invalid = [
        { name: 'a lone continuation byte', bytes: [0x41, 0x80], at: 1 },
        { name: 'an overlong two-byte form', bytes: [0xc0, 0xaf], at: 0 },
        { name: 'an overlong three-byte form', bytes: [0xe0, 0x80, 0xaf], at: 0 },
        { name: 'an encoded surrogate', bytes: [0xed, 0xa0, 0x80], at: 0 },
        { name: 'a code point past U+10FFFF', bytes: [0xf4, 0x90, 0x80, 0x80], at: 0 },
        { name: 'a truncated sequence', bytes: [0x41, 0xe2, 0x82], at: 1 },
        { name: 'a byte that never appears', bytes: [0xfe], at: 0 },
    ];

    for (const vector of invalid) {
        it(`finds ${vector.name}`, () => {
            expect(findInvalidUtf8(new Uint8Array(vector.bytes))).toBe(vector.at);
        });
    }

    it('accepts the edges of each range', () => {
        expect(findInvalidUtf8(encodeUtf8('\u0080߿ࠀ￿\u{10000}\u{10ffff}'))).toBeNull();
    });
});

describe('findUnpairedSurrogate', () => {
    it('ignores proper pairs', () => {
        expect(findUnpairedSurrogate('a😀b')).toBeNull();
    });

    it('finds a high surrogate with nothing after it', () => {
        expect(findUnpairedSurrogate('ab\uD83D')).toBe(2);
    });

    it('finds a low surrogate with nothing before it', () => {
        expect(findUnpairedSurrogate('a\uDE00b')).toBe(1);
    });
});
