import { toArrayBuffer } from '../binary/bytes.js';

export type HmacAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

export const HMAC_ALGORITHMS: ReadonlyArray<HmacAlgorithm> = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

// HMAC through Web Crypto; the key must not be empty, which Web Crypto refuses.
export async function hmacAsync(key: Uint8Array, message: Uint8Array, algorithm: HmacAlgorithm): Promise<Uint8Array> {
    const cryptoKey = await crypto.subtle.importKey(
        /* format: */ 'raw',
        /* keyData: */ toArrayBuffer(key),
        /* algorithm: */ { name: 'HMAC', hash: algorithm },
        /* extractable: */ false,
        /* keyUsages: */ ['sign'],
    );

    return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, toArrayBuffer(message)));
}

export async function hmacAllAsync(key: Uint8Array, message: Uint8Array): Promise<Map<HmacAlgorithm, Uint8Array>> {
    const signatures = await Promise.all(HMAC_ALGORITHMS.map(async (algorithm) => [algorithm, await hmacAsync(key, message, algorithm)] as const));

    return new Map(signatures);
}
