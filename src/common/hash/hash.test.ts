import { describe, expect, it } from 'vitest';
import { bytesToHex } from '../encoding/hex.js';
import { DIGEST_LENGTHS, HASH_ALGORITHMS, digestAllAsync, digestAsync, toArrayBuffer } from './hash.js';

describe('digestAsync', () => {
    const ABC = new TextEncoder().encode('abc');

    it.each([
        ['MD5', '900150983cd24fb0d6963f7d28e17f72'],
        ['SHA-1', 'a9993e364706816aba3e25717850c26c9cd0d89d'],
        ['SHA-256', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
        [
            'SHA-384',
            'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
        ],
        [
            'SHA-512',
            'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
        ],
    ] as const)('produces the published %s of "abc"', async (algorithm, expected) => {
        expect(bytesToHex(await digestAsync(ABC, algorithm))).toBe(expected);
    });

    it('hashes a view into a larger buffer by its own bytes only', async () => {
        const buffer = new TextEncoder().encode('xxabcxx');

        expect(bytesToHex(await digestAsync(buffer.subarray(2, 5), 'SHA-1'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    });
});

describe('digestAllAsync', () => {
    it('gives every algorithm a digest of its published length', async () => {
        const digests = await digestAllAsync(new TextEncoder().encode('abc'));

        expect([...digests.keys()]).toEqual([...HASH_ALGORITHMS]);

        for (const algorithm of HASH_ALGORITHMS) {
            expect(digests.get(algorithm)?.length).toBe(DIGEST_LENGTHS[algorithm]);
        }
    });
});

describe('toArrayBuffer', () => {
    it('reuses a buffer the bytes fill', () => {
        const bytes = new Uint8Array([1, 2, 3]);

        expect(toArrayBuffer(bytes)).toBe(bytes.buffer);
    });

    it('copies just the viewed bytes otherwise', () => {
        const bytes = new Uint8Array([1, 2, 3, 4]).subarray(1, 3);

        expect([...new Uint8Array(toArrayBuffer(bytes))]).toEqual([2, 3]);
    });
});
