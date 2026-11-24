import { describe, expect, it } from 'vitest';
import { DIGEST_FORMATS, formatDigest, isDigestFormat } from './digestFormat.js';

const BYTES = new Uint8Array([0xba, 0x78, 0x16, 0xbf, 0xfb, 0xff]);

describe('formatDigest', () => {
    it('writes lower-case hex by default', () => {
        expect(formatDigest(BYTES, 'hex')).toBe('ba7816bffbff');
    });

    it('writes upper-case HEX', () => {
        expect(formatDigest(BYTES, 'HEX')).toBe('BA7816BFFBFF');
    });

    it('writes padded standard Base64', () => {
        expect(formatDigest(BYTES, 'base64')).toBe('ungWv/v/');
        expect(formatDigest(new Uint8Array([1]), 'base64')).toBe('AQ==');
    });
});

describe('DIGEST_FORMATS', () => {
    it('offers hex, HEX and Base64, hex first', () => {
        expect(DIGEST_FORMATS.map((option) => option.label)).toEqual(['hex', 'HEX', 'Base64']);
    });

    it('recognises its own ids only', () => {
        expect(isDigestFormat('HEX')).toBe(true);
        expect(isDigestFormat('base64')).toBe(true);
        expect(isDigestFormat('Base64')).toBe(false);
    });
});
