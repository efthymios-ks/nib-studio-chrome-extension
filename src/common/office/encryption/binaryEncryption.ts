import { bytesEqual, concatBytes } from '../../binary/bytes.js';
import { Rc4 } from '../../crypto/rc4.js';
import { digestSync } from '../../hash/syncDigest.js';
import { readUint16, readUint32 } from '../../binary/littleEndian.js';
import { littleEndian32, passwordBytes } from './passwordKeys.js';

// The RC4 encryption of Word 97–2003 and Excel 97–2003 files,
// with an MD5 key ([MS-OFFCRYPTO] 2.3.6) or through
// CryptoAPI with a SHA-1 key (2.3.5),
// and the CryptoAPI header that Standard encryption of OOXML files shares (2.3.4.5).

// The algorithm identifiers a CryptoAPI header names; zero means the scheme's default.
export const ALGORITHM_IDS = Object.freeze({
    rc4: 0x6801,
    aes128: 0x660e,
    aes192: 0x660f,
    aes256: 0x6610,
    sha1: 0x8004,
});

// The fixed part of a CryptoAPI EncryptionHeader before its provider name.
const HEADER_FIXED_SIZE = 32;
const SALT_SIZE = 16;
const VERIFIER_SIZE = 16;
// RC4 encryption truncates its MD5 hashes to 40 bits.
const RC4_TRUNCATED_SIZE = 5;
const RC4_INTERMEDIATE_REPEATS = 16;

// A CryptoAPI EncryptionHeader and EncryptionVerifier, as binary files and Standard encryption store them.
export interface CryptoApiHeader {
    readonly algorithmId: number;
    readonly hashAlgorithmId: number;
    // The key size in bits; zero means the algorithm's default.
    readonly keyBits: number;
    readonly salt: Uint8Array;
    readonly encryptedVerifier: Uint8Array;
    readonly verifierHashSize: number;
    readonly encryptedVerifierHash: Uint8Array;
}

// The encryption header at the start of a binary file's encrypted data: plain RC4, RC4 through CryptoAPI,
// or a version this reader doesn't know.
export type BinaryRc4Header =
    | {
        readonly kind: 'rc4';
        readonly salt: Uint8Array;
        readonly encryptedVerifier: Uint8Array;
        readonly encryptedVerifierHash: Uint8Array;
    }
    | ({ readonly kind: 'cryptoapi' } & CryptoApiHeader)
    | { readonly kind: 'unknown'; readonly version: string };

// Gives the RC4 key of each block of a stream, once the password has been checked.
export type Rc4BlockKeys = (block: number) => Uint8Array;

// Reads the header that starts at `offset` with its EncryptionVersionInfo.
export function readBinaryRc4Header(bytes: Uint8Array, offset: number): BinaryRc4Header {
    const major = readUint16(bytes, offset);
    const minor = readUint16(bytes, offset + 2);
    const version = `${major}.${minor}`;

    if (major === 1 && minor === 1) {
        const at = offset + 4;

        if (at + SALT_SIZE + VERIFIER_SIZE * 2 > bytes.length) {
            return { kind: 'unknown', version };
        }

        return {
            kind: 'rc4',
            salt: bytes.slice(at, at + SALT_SIZE),
            encryptedVerifier: bytes.slice(at + SALT_SIZE, at + SALT_SIZE + VERIFIER_SIZE),
            encryptedVerifierHash: bytes.slice(at + SALT_SIZE + VERIFIER_SIZE, at + SALT_SIZE + VERIFIER_SIZE * 2),
        };
    }

    const header = minor === 2 && major >= 2 && major <= 4 ? readCryptoApiHeader(bytes, offset + 4) : null;

    return header == null ? { kind: 'unknown', version } : { kind: 'cryptoapi', ...header };
}

// Reads the Flags, the header size, the EncryptionHeader and the EncryptionVerifier that follow a version.
export function readCryptoApiHeader(bytes: Uint8Array, offset: number): CryptoApiHeader | null {
    const headerSize = readUint32(bytes, offset + 4);
    const headerAt = offset + 8;
    const verifierAt = headerAt + headerSize;

    if (headerSize < HEADER_FIXED_SIZE || verifierAt + 4 + SALT_SIZE + VERIFIER_SIZE + 4 > bytes.length) {
        return null;
    }

    const saltSize = readUint32(bytes, verifierAt);

    if (saltSize !== SALT_SIZE) {
        return null;
    }

    const saltAt = verifierAt + 4;
    const verifierHashAt = saltAt + SALT_SIZE + VERIFIER_SIZE + 4;

    return {
        algorithmId: readUint32(bytes, headerAt + 8),
        hashAlgorithmId: readUint32(bytes, headerAt + 12),
        keyBits: readUint32(bytes, headerAt + 16),
        salt: bytes.slice(saltAt, saltAt + SALT_SIZE),
        encryptedVerifier: bytes.slice(saltAt + SALT_SIZE, saltAt + SALT_SIZE + VERIFIER_SIZE),
        verifierHashSize: readUint32(bytes, saltAt + SALT_SIZE + VERIFIER_SIZE),
        encryptedVerifierHash: bytes.slice(verifierHashAt),
    };
}

// Why a binary RC4 header can't be opened, or null when it can.
export function unsupportedRc4Reason(header: BinaryRc4Header): string | null {
    if (header.kind === 'unknown') {
        return `Its encryption header has version ${header.version}, which isn't one the preview knows.`;
    }

    if (header.kind === 'rc4') {
        return null;
    }

    if (header.algorithmId !== 0 && header.algorithmId !== ALGORITHM_IDS.rc4) {
        return 'It is encrypted through CryptoAPI with a cipher other than RC4, which the preview can\'t decrypt.';
    }

    if (header.hashAlgorithmId !== 0 && header.hashAlgorithmId !== ALGORITHM_IDS.sha1) {
        return 'It is encrypted through CryptoAPI with a hash other than SHA-1, which the preview can\'t use.';
    }

    return null;
}

// "RC4 encryption" or "RC4 CryptoAPI encryption, 128-bit key", for the Info panel.
export function describeRc4Header(header: BinaryRc4Header): string {
    if (header.kind === 'rc4') {
        return 'RC4 encryption';
    }

    if (header.kind === 'cryptoapi') {
        return `RC4 CryptoAPI encryption, ${cryptoApiKeyBits(header)}-bit key`;
    }

    return `Unknown encryption (version ${header.version})`;
}

function cryptoApiKeyBits(header: CryptoApiHeader): number {
    return header.keyBits === 0 ? 40 : header.keyBits;
}

// The block keys for a password, or null when the header's verifier says the password is wrong.
export function unlockRc4(header: BinaryRc4Header, password: string): Rc4BlockKeys | null {
    if (header.kind === 'unknown' || unsupportedRc4Reason(header) != null) {
        return null;
    }

    const keys = header.kind === 'rc4' ? rc4BlockKeys(header.salt, password) : cryptoApiBlockKeys(header, password);
    const cipher = new Rc4(keys(0));
    const verifier = cipher.apply(header.encryptedVerifier.slice());

    if (header.kind === 'rc4') {
        const verifierHash = cipher.apply(header.encryptedVerifierHash.slice());

        return bytesEqual(digestSync('MD5', verifier), verifierHash) ? keys : null;
    }

    const hashSize = Math.min(header.verifierHashSize, header.encryptedVerifierHash.length);
    const verifierHash = cipher.apply(header.encryptedVerifierHash.slice(0, hashSize));

    return bytesEqual(digestSync('SHA-1', verifier).subarray(0, hashSize), verifierHash) ? keys : null;
}

// [MS-OFFCRYPTO] 2.3.6.2: the MD5 of the password, cut to 40 bits and salted sixteen times,
// hashed and cut again;
// each block's key is the MD5 of that and the block number.
function rc4BlockKeys(salt: Uint8Array, password: string): Rc4BlockKeys {
    const first = digestSync('MD5', passwordBytes(password)).subarray(0, RC4_TRUNCATED_SIZE);
    const salted = concatBytes(new Array<Uint8Array>(RC4_INTERMEDIATE_REPEATS).fill(concatBytes([first, salt])));
    const base = digestSync('MD5', salted).subarray(0, RC4_TRUNCATED_SIZE);

    return (block) => digestSync('MD5', base, littleEndian32(block));
}

// [MS-OFFCRYPTO] 2.3.5.2: SHA-1 of the salt and the password, then of that and the block number,
// cut to the key size;
// a 40-bit key is padded with zeros to 128 bits, as CryptoAPI does.
function cryptoApiBlockKeys(header: CryptoApiHeader, password: string): Rc4BlockKeys {
    const base = digestSync('SHA-1', header.salt, passwordBytes(password));
    const keyBytes = Math.min(20, cryptoApiKeyBits(header) / 8);

    return (block) => {
        const key = digestSync('SHA-1', base, littleEndian32(block)).slice(0, keyBytes);

        return keyBytes === RC4_TRUNCATED_SIZE ? concatBytes([key, new Uint8Array(16 - RC4_TRUNCATED_SIZE)]) : key;
    };
}

// A copy of an RC4-encrypted stream with its encrypted ranges decrypted. The byte at stream offset N uses
// the keystream of block ⌊N / blockSize⌋ at position N mod blockSize,
// so bytes left in the clear still use up keystream.
export function decryptRc4Stream(
    stream: Uint8Array,
    keys: Rc4BlockKeys,
    blockSize: number,
    encryptedRanges: ReadonlyArray<readonly [start: number, end: number]>,
): Uint8Array<ArrayBuffer> {
    const plain = Uint8Array.from(stream);
    const keystream = new Uint8Array(stream.length);

    for (let start = 0, block = 0; start < stream.length; start += blockSize, block += 1) {
        new Rc4(keys(block)).apply(keystream.subarray(start, Math.min(stream.length, start + blockSize)));
    }

    for (const [start, end] of encryptedRanges) {
        for (let index = Math.max(0, start); index < Math.min(end, stream.length); index += 1) {
            plain[index] = (plain[index] ?? 0) ^ (keystream[index] ?? 0);
        }
    }

    return plain;
}
