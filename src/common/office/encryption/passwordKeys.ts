import type { HashAlgorithm } from '../../hash/hash.js';
import { digestSync } from '../../hash/syncDigest.js';

// The pieces Office's password-based keys are built from ([MS-OFFCRYPTO] 2.3.4.7 and 2.3.4.11).

// The password as Office hashes it: UTF-16 little-endian, without a terminator.
export function passwordBytes(password: string): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(password.length * 2);

    for (let index = 0; index < password.length; index += 1) {
        const code = password.charCodeAt(index);
        bytes[index * 2] = code & 0xff;
        bytes[index * 2 + 1] = code >>> 8;
    }

    return bytes;
}

export function littleEndian32(value: number): Uint8Array<ArrayBuffer> {
    return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

// The hash of the salt and the password,
// then hashed again with an iteration counter in front `spinCount` times.
export function spinPasswordHash(algorithm: HashAlgorithm, salt: Uint8Array, password: string, spinCount: number): Uint8Array {
    const counter = new Uint8Array(4);
    const counterView = new DataView(counter.buffer);
    let hash = digestSync(algorithm, salt, passwordBytes(password));

    for (let iteration = 0; iteration < spinCount; iteration += 1) {
        counterView.setUint32(0, iteration, true);
        hash = digestSync(algorithm, counter, hash);
    }

    return hash;
}

// The bytes cut to `size`, or padded to it with `fill`.
export function sizedTo(bytes: Uint8Array, size: number, fill: number): Uint8Array {
    if (bytes.length >= size) {
        return bytes.slice(0, size);
    }

    const sized = new Uint8Array(size).fill(fill);
    sized.set(bytes);

    return sized;
}

// The plain size an EncryptedPackage stream records in its first eight bytes, little-endian.
export function readStreamSize(encryptedPackage: Uint8Array): number {
    const view = new DataView(encryptedPackage.buffer, encryptedPackage.byteOffset, encryptedPackage.byteLength);

    return encryptedPackage.length < 8 ? 0 : view.getUint32(0, true) + view.getUint32(4, true) * 0x100000000;
}
