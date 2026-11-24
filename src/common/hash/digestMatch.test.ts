import { describe, expect, it } from 'vitest';
import { bytesEqual } from '../binary/bytes.js';
import { encodeBase64Bytes } from '../encoding/base64.js';
import { bytesToHex, parseHex } from '../encoding/hex.js';
import { algorithmsForLength, findMatches, parseExpectedDigest, type ExpectedDigest } from './digestMatch.js';

const SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const SHA256_ABC_BYTES = (parseHex(SHA256_ABC) as { value: Uint8Array }).value;
const SHA256_ABC_BASE64 = encodeBase64Bytes(SHA256_ABC_BYTES);

function parsed(text: string): ExpectedDigest {
    const result = parseExpectedDigest(text);

    if (result == null || !result.ok) {
        throw new Error(`Expected "${text}" to parse`);
    }

    return result.value;
}

describe('parseExpectedDigest', () => {
    it('returns null for blank text', () => {
        expect(parseExpectedDigest('')).toBeNull();
        expect(parseExpectedDigest('  \n ')).toBeNull();
    });

    it('reads hex ignoring case and surrounding spaces', () => {
        const digest = parsed(`  ${SHA256_ABC.toUpperCase()}\n`);

        expect(digest.encoding).toBe('hex');
        expect(bytesToHex(digest.bytes)).toBe(SHA256_ABC);
        expect(digest.namedAlgorithm).toBeNull();
    });

    it('reads colon-separated hex', () => {
        expect(parsed('BA:78:16:BF').bytes).toEqual(new Uint8Array([0xba, 0x78, 0x16, 0xbf]));
    });

    it('reads Base64 in either alphabet, with or without padding', () => {
        const urlSafe = SHA256_ABC_BASE64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        expect(parsed(SHA256_ABC_BASE64).encoding).toBe('base64');
        expect(bytesEqual(parsed(SHA256_ABC_BASE64).bytes, SHA256_ABC_BYTES)).toBe(true);
        expect(bytesEqual(parsed(urlSafe).bytes, SHA256_ABC_BYTES)).toBe(true);
    });

    it('reads text made only of hex digits as hex', () => {
        expect(parsed('deadbeef').encoding).toBe('hex');
    });

    it('takes the digest from a sha256sum line', () => {
        const digest = parsed(`${SHA256_ABC}  release.zip`);

        expect(bytesToHex(digest.bytes)).toBe(SHA256_ABC);
        expect(bytesToHex(parsed(`${SHA256_ABC} *release.zip`).bytes)).toBe(SHA256_ABC);
    });

    it('takes the digest and algorithm from a BSD line', () => {
        const digest = parsed(`SHA256 (release.zip) = ${SHA256_ABC}`);

        expect(bytesToHex(digest.bytes)).toBe(SHA256_ABC);
        expect(digest.namedAlgorithm).toBe('SHA-256');
    });

    it('takes the digest and algorithm after sha256-, sha256= and SHA256:', () => {
        expect(parsed(`sha256-${SHA256_ABC_BASE64}`).namedAlgorithm).toBe('SHA-256');
        expect(parsed(`sha256=${SHA256_ABC}`).encoding).toBe('hex');
        expect(parsed(`SHA256:${SHA256_ABC_BASE64.replace(/=+$/, '')}`).encoding).toBe('base64');
        expect(parsed('md5:900150983cd24fb0d6963f7d28e17f72').namedAlgorithm).toBe('MD5');
        expect(parsed('SHA-1=a9993e364706816aba3e25717850c26c9cd0d89d').namedAlgorithm).toBe('SHA-1');
    });

    it('reports an odd number of hex digits where the lone digit is, counting leading spaces', () => {
        const result = parseExpectedDigest('  abc');

        expect(result?.ok).toBe(false);
        expect(result != null && !result.ok && result.error.position).toBe(4);
    });

    it('reports text that is neither hex nor Base64', () => {
        const result = parseExpectedDigest('not a digest!');

        expect(result != null && !result.ok && result.error.message).toBe("Not hex or Base64: Invalid Base64 character '!'");
        expect(result != null && !result.ok && result.error.position).toBe(12);
    });

    it('offsets positions past an algorithm prefix', () => {
        const result = parseExpectedDigest('sha256-ab$d');

        expect(result != null && !result.ok && result.error.position).toBe(9);
    });

    it('reports a prefix with no digest after it', () => {
        const result = parseExpectedDigest('sha256=::');

        expect(result != null && !result.ok && result.error.message).toBe('No digest after the algorithm name');
    });
});

describe('algorithmsForLength', () => {
    it('names the algorithm whose digest has that many bytes', () => {
        expect(algorithmsForLength(16)).toEqual(['MD5']);
        expect(algorithmsForLength(20)).toEqual(['SHA-1']);
        expect(algorithmsForLength(32)).toEqual(['SHA-256']);
        expect(algorithmsForLength(48)).toEqual(['SHA-384']);
        expect(algorithmsForLength(64)).toEqual(['SHA-512']);
        expect(algorithmsForLength(31)).toEqual([]);
    });
});

describe('findMatches', () => {
    it('lists every candidate with the same bytes', () => {
        const candidates = [
            { label: 'MD5', bytes: new Uint8Array(16) },
            { label: 'SHA-256', bytes: SHA256_ABC_BYTES },
            { label: 'HMAC-SHA-256', bytes: new Uint8Array(32) },
        ];

        expect(findMatches(parsed(SHA256_ABC), candidates)).toEqual(['SHA-256']);
        expect(findMatches(parsed('00'.repeat(32)), candidates)).toEqual(['HMAC-SHA-256']);
        expect(findMatches(parsed('11'.repeat(32)), candidates)).toEqual([]);
    });
});
