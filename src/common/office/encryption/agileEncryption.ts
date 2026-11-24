import { bytesEqual } from '../../binary/bytes.js';
import { AES_BLOCK_SIZE, decryptAesCbcAsync } from '../../crypto/aes.js';
import { digestSync } from '../../hash/syncDigest.js';
import type { AgileCipher, AgilePasswordKey } from './encryptionInfo.js';
import { littleEndian32, readStreamSize, sizedTo, spinPasswordHash } from './passwordKeys.js';

// Agile encryption of OOXML files ([MS-OFFCRYPTO] 2.3.4.10–2.3.4.13): a key from the password,
// hashed spinCount times,
// unlocks the package's secret key, and the package is AES-CBC in 4096-byte segments,
// each with an IV of its own.

// The block keys that turn the password hash into the three keys of the password key encryptor.
const BLOCK_KEYS = Object.freeze({
    verifierInput: Uint8Array.of(0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79),
    verifierValue: Uint8Array.of(0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e),
    keyValue: Uint8Array.of(0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6),
});

const SEGMENT_SIZE = 4096;
const STREAM_SIZE_BYTES = 8;
// Keys and IVs shorter than their size are padded with this byte.
const KEY_PADDING = 0x36;

export interface AgileUnlockInput {
    readonly keyData: AgileCipher;
    readonly passwordKey: AgilePasswordKey;
    readonly encryptedPackage: Uint8Array;
}

// The plain package, or null when the password is wrong.
export async function unlockAgilePackageAsync(input: AgileUnlockInput, password: string): Promise<Uint8Array | null> {
    const secretKey = await unlockSecretKeyAsync(input.passwordKey, password);

    if (secretKey == null) {
        return null;
    }

    return await decryptSegmentsAsync(input.keyData, secretKey.subarray(0, input.keyData.keyBits / 8), input.encryptedPackage);
}

async function unlockSecretKeyAsync(key: AgilePasswordKey, password: string): Promise<Uint8Array | null> {
    const hash = spinPasswordHash(key.hashAlgorithm, key.saltValue, password, key.spinCount);
    const keyFor = (blockKey: Uint8Array): Uint8Array => sizedTo(digestSync(key.hashAlgorithm, hash, blockKey), key.keyBits / 8, KEY_PADDING);
    const iv = sizedTo(key.saltValue, key.blockSize, KEY_PADDING);
    const verifierInput = await decryptAesCbcAsync(keyFor(BLOCK_KEYS.verifierInput), iv, key.encryptedVerifierHashInput);
    const verifierHash = await decryptAesCbcAsync(keyFor(BLOCK_KEYS.verifierValue), iv, key.encryptedVerifierHashValue);
    const expected = digestSync(key.hashAlgorithm, verifierInput.subarray(0, key.saltValue.length));

    if (!bytesEqual(expected.subarray(0, key.hashSize), verifierHash.subarray(0, key.hashSize))) {
        return null;
    }

    return await decryptAesCbcAsync(keyFor(BLOCK_KEYS.keyValue), iv, key.encryptedKeyValue);
}

// Every segment is decrypted in one CBC pass from the first segment's IV. CBC XORs each block with the ciphertext
// before it, so the first block of each later segment is then corrected to its own IV.
async function decryptSegmentsAsync(keyData: AgileCipher, secretKey: Uint8Array, encryptedPackage: Uint8Array): Promise<Uint8Array> {
    const size = readStreamSize(encryptedPackage);
    const ciphertext = encryptedPackage.subarray(STREAM_SIZE_BYTES);
    const ivOf = (segment: number): Uint8Array => sizedTo(
        digestSync(keyData.hashAlgorithm, keyData.saltValue, littleEndian32(segment)),
        keyData.blockSize,
        KEY_PADDING,
    );
    const plain = await decryptAesCbcAsync(secretKey, ivOf(0), ciphertext);

    for (let start = SEGMENT_SIZE, segment = 1; start < plain.length; start += SEGMENT_SIZE, segment += 1) {
        const iv = ivOf(segment);

        for (let index = 0; index < AES_BLOCK_SIZE; index += 1) {
            plain[start + index] = (plain[start + index] ?? 0) ^ (ciphertext[start - AES_BLOCK_SIZE + index] ?? 0) ^ (iv[index] ?? 0);
        }
    }

    return plain.subarray(0, Math.min(size, plain.length));
}
