import { describe, expect, it } from 'vitest';
import { decodeUrlComponent, encodeUrlComponent } from './urlCodec.js';

describe('encodeUrlComponent', () => {
    it('matches encodeURIComponent', () => {
        const text = 'a b&c=d/é?😀#';

        expect(encodeUrlComponent(text)).toEqual({ ok: true, value: encodeURIComponent(text), warning: null });
    });

    it('reports half of a surrogate pair with its position', () => {
        const result = encodeUrlComponent('ab\uD83Dc');

        expect(!result.ok && result.error.position).toBe(2);
    });
});

describe('decodeUrlComponent', () => {
    it('round-trips Unicode text', () => {
        const text = 'Ελληνικά & emoji 😀 / ?=';
        const encoded = encodeUrlComponent(text);
        const decoded = encoded.ok ? decodeUrlComponent(encoded.value) : null;

        expect(decoded?.ok && decoded.value).toBe(text);
    });

    it('accepts escapes in either case and leaves + alone', () => {
        const result = decodeUrlComponent('%c3%A9+x');

        expect(result.ok && result.value).toBe('é+x');
    });

    it('reports a % without two hex digits', () => {
        const result = decodeUrlComponent('100%zz');

        expect(!result.ok && result.error).toEqual({
            message: "Malformed % sequence: '%' must be followed by two hex digits",
            position: 3,
            length: 3,
        });
    });

    it('reports a % at the very end', () => {
        const result = decodeUrlComponent('abc%');

        expect(!result.ok && result.error.position).toBe(3);
        expect(!result.ok && result.error.length).toBe(1);
    });

    it('reports the escape that breaks UTF-8', () => {
        const result = decodeUrlComponent('ok%C3%A9%FF');

        expect(!result.ok && result.error).toEqual({ message: '%FF is not part of valid UTF-8', position: 8, length: 3 });
    });

    it('reports a truncated multi-byte sequence at its lead byte', () => {
        const result = decodeUrlComponent('x%E2%82y');

        expect(!result.ok && result.error.position).toBe(1);
    });
});
