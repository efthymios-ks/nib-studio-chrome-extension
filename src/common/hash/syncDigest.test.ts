import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { HashAlgorithm } from './hash.js';
import { digestSync } from './syncDigest.js';

const NODE_NAMES: Readonly<Record<HashAlgorithm, string>> = {
    'MD5': 'md5',
    'SHA-1': 'sha1',
    'SHA-256': 'sha256',
    'SHA-384': 'sha384',
    'SHA-512': 'sha512',
};

function hex(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('hex');
}

describe('digestSync', () => {
    // Lengths around each padding boundary of 64- and 128-byte blocks.
    const lengths = [0, 1, 55, 56, 63, 64, 65, 111, 112, 119, 127, 128, 129, 300];

    for (const [algorithm, nodeName] of Object.entries(NODE_NAMES)) {
        it(`matches Node's ${algorithm} for every padding case`, () => {
            for (const length of lengths) {
                const bytes = Uint8Array.from({ length }, (_, index) => (index * 31 + length) & 0xff);

                expect(hex(digestSync(algorithm as HashAlgorithm, bytes)), `${length} bytes`).toBe(createHash(nodeName).update(bytes).digest('hex'));
            }
        });
    }

    it('hashes the parts as one array', () => {
        const whole = digestSync('SHA-512', Uint8Array.of(1, 2, 3, 4, 5));

        expect(digestSync('SHA-512', Uint8Array.of(1, 2), Uint8Array.of(3, 4, 5))).toEqual(whole);
    });

    it('gives the FIPS 180 answer for "abc"', () => {
        const abc = new TextEncoder().encode('abc');

        expect(hex(digestSync('SHA-1', abc))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
        expect(hex(digestSync('SHA-256', abc))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });
});
