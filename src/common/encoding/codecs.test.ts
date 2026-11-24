import { describe, expect, it } from 'vitest';
import { CODECS, findCodec, type CodecOptions } from './codecs.js';

const OPTIONS: CodecOptions = { urlSafe: false, padding: true };
const SAMPLES = ['', 'Nib Studio', 'a b&c=d/e?f#g', '<tag attr="v">it\'s</tag>', 'Ελληνικά · ✓ · 😀', 'line one\nline two\r\n'];

describe('CODECS', () => {
    it('lists Base64, URL, Hex and HTML entities in that order', () => {
        expect(CODECS.map((codec) => codec.label)).toEqual(['Base64', 'URL', 'Hex', 'HTML entities']);
    });

    for (const codec of CODECS) {
        for (const sample of SAMPLES) {
            it(`${codec.label} round-trips ${JSON.stringify(sample).slice(0, 24)}`, () => {
                const encoded = codec.encode(sample, OPTIONS);
                const decoded = encoded.ok ? codec.decode(encoded.value, OPTIONS) : null;

                expect(decoded).toEqual({ ok: true, value: sample, warning: null });
            });
        }
    }

    it('Base64 applies the URL-safe and padding options', () => {
        const encoded = findCodec('base64').encode('??>', { urlSafe: true, padding: false });

        expect(encoded.ok && encoded.value).toBe('Pz8-');
    });

    it('Base64 decodes either alphabet whatever the options', () => {
        const decoded = findCodec('base64').decode('Pz8-', OPTIONS);

        expect(decoded.ok && decoded.value).toBe('??>');
    });

    it('Hex encodes the UTF-8 bytes in lower case', () => {
        const encoded = findCodec('hex').encode('é', OPTIONS);

        expect(encoded.ok && encoded.value).toBe('c3a9');
    });

    it('reports where Base64 is invalid', () => {
        const decoded = findCodec('base64').decode('Zm9v!', OPTIONS);

        expect(!decoded.ok && decoded.error.position).toBe(4);
    });

    it('warns, with the byte, when decoded bytes are not UTF-8', () => {
        const decoded = findCodec('hex').decode('61ff62', OPTIONS);

        expect(decoded.ok && decoded.value).toBe('a�b');
        expect(decoded.ok && decoded.warning?.message).toBe('Byte 2 of 3 is not valid UTF-8 text; such bytes show as �');
    });

    it('passes the entity resolver to the HTML codec', () => {
        const decoded = findCodec('html').decode('&Aacute;', { ...OPTIONS, resolveEntity: () => 'Á' });

        expect(decoded.ok && decoded.value).toBe('Á');
    });

    it('reports a malformed URL escape', () => {
        const decoded = findCodec('url').decode('a%2', OPTIONS);

        expect(!decoded.ok && decoded.error.position).toBe(1);
    });
});
