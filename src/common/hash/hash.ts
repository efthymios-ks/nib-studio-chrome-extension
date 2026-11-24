import { Md5 } from './md5.js';

export type HashAlgorithm = 'MD5' | 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

export const HASH_ALGORITHMS: ReadonlyArray<HashAlgorithm> = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

// Digest sizes in bytes.
export const DIGEST_LENGTHS: Readonly<Record<HashAlgorithm, number>> = Object.freeze({
    'MD5': 16,
    'SHA-1': 20,
    'SHA-256': 32,
    'SHA-384': 48,
    'SHA-512': 64,
});

export type Digests = ReadonlyMap<HashAlgorithm, Uint8Array>;

export async function digestAsync(bytes: Uint8Array, algorithm: HashAlgorithm): Promise<Uint8Array> {
    if (algorithm === 'MD5') {
        return new Md5().update(bytes).digest();
    }

    return new Uint8Array(await crypto.subtle.digest(algorithm, toArrayBuffer(bytes)));
}

// Every algorithm's digest of the same bytes.
export async function digestAllAsync(bytes: Uint8Array): Promise<Map<HashAlgorithm, Uint8Array>> {
    const digests = await Promise.all(HASH_ALGORITHMS.map(async (algorithm) => [algorithm, await digestAsync(bytes, algorithm)] as const));

    return new Map(digests);
}

// The bytes as an ArrayBuffer for Web Crypto, without a copy when they already fill one.
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
        return bytes.buffer;
    }

    return bytes.slice().buffer as ArrayBuffer;
}
