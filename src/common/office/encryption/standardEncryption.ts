import { bytesEqual, concatBytes } from '../../binary/bytes.js';
import { decryptAesEcbAsync } from '../../crypto/aes.js';
import { digestSync } from '../../hash/syncDigest.js';
import type { CryptoApiHeader } from './binaryEncryption.js';
import { STANDARD_AES_BITS } from './encryptionInfo.js';
import { littleEndian32, readStreamSize, spinPasswordHash } from './passwordKeys.js';

// Standard encryption of OOXML files ([MS-OFFCRYPTO] 2.3.4.5–2.3.4.9): a SHA-1 key from the password hashed
// 50,000 times, checked against the verifier, and the whole package in AES-ECB.

const SPIN_COUNT = 50_000;
const SHA1_SIZE = 20;
const STREAM_SIZE_BYTES = 8;

export interface StandardUnlockInput {
    readonly header: CryptoApiHeader;
    readonly encryptedPackage: Uint8Array;
}

// The plain package, or null when the password is wrong.
export async function unlockStandardPackageAsync(input: StandardUnlockInput, password: string): Promise<Uint8Array | null> {
    const { header, encryptedPackage } = input;
    const key = deriveStandardKey(header, password);
    const verifier = await decryptAesEcbAsync(key, header.encryptedVerifier);
    const verifierHash = await decryptAesEcbAsync(key, header.encryptedVerifierHash);
    const hashSize = Math.min(SHA1_SIZE, header.verifierHashSize);

    if (!bytesEqual(digestSync('SHA-1', verifier).subarray(0, hashSize), verifierHash.subarray(0, hashSize))) {
        return null;
    }

    const plain = await decryptAesEcbAsync(key, encryptedPackage.subarray(STREAM_SIZE_BYTES));

    return plain.subarray(0, Math.min(readStreamSize(encryptedPackage), plain.length));
}

// [MS-OFFCRYPTO] 2.3.4.7: the spun hash, hashed with block number 0, then stretched to the key size
// through two SHA-1 hashes of it XORed into 64 bytes of 0x36 and of 0x5C.
function deriveStandardKey(header: CryptoApiHeader, password: string): Uint8Array {
    const spun = spinPasswordHash('SHA-1', header.salt, password, SPIN_COUNT);
    const final = digestSync('SHA-1', spun, littleEndian32(0));
    const stretched = (fill: number): Uint8Array => {
        const buffer = new Uint8Array(64).fill(fill).map((byte, index) => byte ^ (final[index] ?? 0));

        return digestSync('SHA-1', buffer);
    };
    // The encryption description has already refused an algorithm ID with no key size.
    const keyBits = header.keyBits === 0 ? STANDARD_AES_BITS.get(header.algorithmId) ?? 0 : header.keyBits;

    return concatBytes([stretched(0x36), stretched(0x5c)]).subarray(0, keyBits / 8);
}
