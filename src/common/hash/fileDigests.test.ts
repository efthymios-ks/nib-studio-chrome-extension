import { describe, expect, it } from 'vitest';
import { bytesToHex } from '../encoding/hex.js';
import { HASH_ALGORITHMS, digestAllAsync } from './hash.js';
import { digestBlobAsync } from './fileDigests.js';

describe('digestBlobAsync', () => {
    it('matches hashing the same bytes at once, whatever the chunk size', async () => {
        const bytes = Uint8Array.from({ length: 5000 }, (_, index) => (index * 7) % 256);
        const expected = await digestAllAsync(bytes);

        for (const chunkSize of [1000, 4096, 64 * 1024]) {
            const digests = await digestBlobAsync(new Blob([bytes]), { chunkSize });

            expect([...digests.keys()]).toEqual([...HASH_ALGORITHMS]);

            for (const algorithm of HASH_ALGORITHMS) {
                expect(bytesToHex(digests.get(algorithm) as Uint8Array)).toBe(bytesToHex(expected.get(algorithm) as Uint8Array));
            }
        }
    });

    it('hashes an empty file', async () => {
        const digests = await digestBlobAsync(new Blob([]));

        expect(bytesToHex(digests.get('MD5') as Uint8Array)).toBe('d41d8cd98f00b204e9800998ecf8427e');
        expect(bytesToHex(digests.get('SHA-256') as Uint8Array)).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('reports progress rising from 0 to 1', async () => {
        const fractions: number[] = [];

        await digestBlobAsync(new Blob([new Uint8Array(10_000)]), { chunkSize: 2500, onProgress: (fraction) => fractions.push(fraction) });

        expect(fractions[0]).toBe(0);
        expect(fractions.at(-1)).toBeCloseTo(1);
        expect(fractions.every((fraction, index) => index === 0 || fraction >= (fractions[index - 1] ?? 0))).toBe(true);
        expect(fractions.length).toBeGreaterThan(5);
    });

    it('stops when aborted', async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(digestBlobAsync(new Blob(['abc']), { signal: controller.signal })).rejects.toThrow();
    });
});
