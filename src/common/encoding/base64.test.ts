import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64, encodeBase64Bytes, parseBase64 } from './base64.js';

describe('encodeBase64 / decodeBase64', () => {
    const vectors = [
        { plain: '', encoded: '' },
        { plain: 'f', encoded: 'Zg==' },
        { plain: 'fo', encoded: 'Zm8=' },
        { plain: 'foo', encoded: 'Zm9v' },
        { plain: 'foob', encoded: 'Zm9vYg==' },
        { plain: 'fooba', encoded: 'Zm9vYmE=' },
        { plain: 'foobar', encoded: 'Zm9vYmFy' },
        { plain: 'Nib Studio', encoded: 'TmliIFN0dWRpbw==' },
    ] as const;

    for (const vector of vectors) {
        it(`encodes "${vector.plain}" per RFC 4648`, () => {
            expect(encodeBase64(vector.plain)).toBe(vector.encoded);
        });

        it(`decodes "${vector.encoded}" back to the original`, () => {
            expect(decodeBase64(vector.encoded)).toBe(vector.plain);
        });
    }

    it('round-trips multi-byte characters', () => {
        const plain = 'π = 3.14 · μ · ✓ · 😀';
        expect(decodeBase64(encodeBase64(plain))).toBe(plain);
    });

    it('produces URL-safe output on request', () => {
        const encoded = encodeBase64('subjects?', { urlSafe: true, padding: false });
        expect(encoded).not.toContain('+');
        expect(encoded).not.toContain('/');
        expect(encoded).not.toContain('=');
    });

    it('accepts URL-safe and unpadded input', () => {
        const encoded = encodeBase64('subjects?', { urlSafe: true, padding: false });
        expect(decodeBase64(encoded)).toBe('subjects?');
    });

    it('rejects lengths that cannot be Base64', () => {
        expect(() => decodeBase64('a')).toThrow(/Invalid Base64/);
    });
});

describe('encodeBase64Bytes', () => {
    it('uses + and / in the standard alphabet and - and _ in the URL-safe one', () => {
        const bytes = new Uint8Array([0xfb, 0xff, 0xbf]);

        expect(encodeBase64Bytes(bytes)).toBe('+/+/');
        expect(encodeBase64Bytes(bytes, { urlSafe: true })).toBe('-_-_');
    });

    it('drops the padding when asked', () => {
        expect(encodeBase64Bytes(new Uint8Array([1]), { padding: false })).toBe('AQ');
        expect(encodeBase64Bytes(new Uint8Array([1, 2]), { padding: false })).toBe('AQI');
    });

    it('matches btoa for every byte value', () => {
        const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
        const binary = String.fromCharCode(...bytes);

        expect(encodeBase64Bytes(bytes)).toBe(btoa(binary));
    });
});

describe('parseBase64', () => {
    it('decodes every byte value back from btoa output', () => {
        const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
        const result = parseBase64(btoa(String.fromCharCode(...bytes)));

        expect(result.ok && [...result.value]).toEqual([...bytes]);
    });

    it('ignores whitespace and line breaks', () => {
        const result = parseBase64(' Zm9v\r\n YmFy \t');

        expect(result.ok && new TextDecoder().decode(result.value)).toBe('foobar');
    });

    it('reports an invalid character with its position', () => {
        const result = parseBase64('Zm9v*mFy');

        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toEqual({ message: "Invalid Base64 character '*'", position: 4, length: 1 });
    });

    it('covers both halves of an astral character in the error', () => {
        const result = parseBase64('Zm😀9v');

        expect(!result.ok && result.error).toEqual({ message: "Invalid Base64 character '😀'", position: 2, length: 2 });
    });

    it('points at a lone last character', () => {
        const result = parseBase64('Zm9vY');

        expect(!result.ok && result.error.position).toBe(4);
        expect(!result.ok && result.error.message).toContain('single character');
    });

    it('rejects data after the padding', () => {
        const result = parseBase64('Zg==Zg');

        expect(!result.ok && result.error).toEqual({ message: "Unexpected 'Z' after the \"=\" padding", position: 4, length: 1 });
    });

    it('rejects too much padding', () => {
        expect(!parseBase64('Zg===').ok).toBe(true);
        expect(!parseBase64('Zm8==').ok).toBe(true);
    });

    it('accepts both alphabets unless only Base64URL is allowed', () => {
        expect(parseBase64('+/8').ok).toBe(true);
        expect(parseBase64('-_8', { urlOnly: true }).ok).toBe(true);

        const result = parseBase64('ab+c', { urlOnly: true });

        expect(!result.ok && result.error).toEqual({ message: "'+' is not Base64URL; use '-'", position: 2, length: 1 });
    });
});
