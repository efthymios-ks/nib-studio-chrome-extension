// The XOR obfuscation of Excel 97–2003 workbooks,
// method 1 of [MS-OFFCRYPTO] 2.3.7. The data transform follows
// LibreOffice and Apache POI, which read real files: each byte is rotated left by three bits, then XORed.

const MAX_PASSWORD_LENGTH = 15;

const PAD_BYTES: ReadonlyArray<number> = [0xbb, 0xff, 0xff, 0xba, 0xff, 0xff, 0xb9, 0x80, 0x00, 0xbe, 0x0f, 0x00, 0xbf, 0x0f, 0x00];

// The starting key for each password length, 1 to 15.
const INITIAL_CODES: ReadonlyArray<number> = [
    0xe1f0, 0x1d0f, 0xcc9c, 0x84c0, 0x110c, 0x0e10, 0xf1ce, 0x313e, 0x1872, 0xe139, 0xd40f, 0x84f9, 0x280c, 0xa96a, 0x4ec3,
];

// Seven words per character position, mixed into the key for each set bit of the character.
const ENCRYPTION_MATRIX: ReadonlyArray<number> = [
    0xaefc, 0x4dd9, 0x9bb2, 0x2745, 0x4e8a, 0x9d14, 0x2a09,
    0x7b61, 0xf6c2, 0xfda5, 0xeb6b, 0xc6f7, 0x9dcf, 0x2bbf,
    0x4563, 0x8ac6, 0x05ad, 0x0b5a, 0x16b4, 0x2d68, 0x5ad0,
    0x0375, 0x06ea, 0x0dd4, 0x1ba8, 0x3750, 0x6ea0, 0xdd40,
    0xd849, 0xa0b3, 0x5147, 0xa28e, 0x553d, 0xaa7a, 0x44d5,
    0x6f45, 0xde8a, 0xad35, 0x4a4b, 0x9496, 0x390d, 0x721a,
    0xeb23, 0xc667, 0x9cef, 0x29ff, 0x53fe, 0xa7fc, 0x5fd9,
    0x47d3, 0x8fa6, 0x0f6d, 0x1eda, 0x3db4, 0x7b68, 0xf6d0,
    0xb861, 0x60e3, 0xc1c6, 0x93ad, 0x377b, 0x6ef6, 0xddec,
    0x45a0, 0x8b40, 0x06a1, 0x0d42, 0x1a84, 0x3508, 0x6a10,
    0xaa51, 0x4483, 0x8906, 0x022d, 0x045a, 0x08b4, 0x1168,
    0x76b4, 0xed68, 0xcaf1, 0x85c3, 0x1ba7, 0x374e, 0x6e9c,
    0x3730, 0x6e60, 0xdcc0, 0xa9a1, 0x4363, 0x86c6, 0x1dad,
    0x3331, 0x6662, 0xccc4, 0x89a9, 0x0373, 0x06e6, 0x0dcc,
    0x1021, 0x2042, 0x4084, 0x8108, 0x1231, 0x2462, 0x48c4,
];

const BITS_PER_CHARACTER = 7;
const XOR_ARRAY_SIZE = 16;

// The password as single bytes, at most 15: each character's low byte,
// or its high byte when the low one is zero.
export function xorPasswordBytes(password: string): Uint8Array {
    const length = Math.min(password.length, MAX_PASSWORD_LENGTH);

    return Uint8Array.from({ length }, (_, index) => {
        const code = password.charCodeAt(index);

        return (code & 0xff) !== 0 ? code & 0xff : (code >>> 8) & 0xff;
    });
}

// The 16-bit verifier a workbook stores for its password (2.3.7.1).
export function createXorVerifier(password: Uint8Array): number {
    let verifier = 0;

    for (let index = password.length - 1; index >= 0; index -= 1) {
        verifier = rotateLeft15(verifier) ^ (password[index] ?? 0);
    }

    return (rotateLeft15(verifier) ^ password.length ^ 0xce4b) & 0xffff;
}

// The 16-bit key a workbook stores beside the verifier (CreateXorKey_Method1).
export function createXorKey(password: Uint8Array): number {
    if (password.length === 0) {
        return 0;
    }

    let key = INITIAL_CODES[password.length - 1] ?? 0;

    for (let index = 0; index < password.length; index += 1) {
        const row = MAX_PASSWORD_LENGTH - password.length + index;

        for (let bit = 0; bit < BITS_PER_CHARACTER; bit += 1) {
            if (((password[index] ?? 0) & (1 << bit)) !== 0) {
                key ^= ENCRYPTION_MATRIX[row * BITS_PER_CHARACTER + bit] ?? 0;
            }
        }
    }

    return key;
}

// The 16 bytes XORed into the data: the password padded to 16 bytes, mixed with the key's bytes and rotated.
export function createXorArray(password: Uint8Array): Uint8Array {
    const key = createXorKey(password);
    const keyBytes = [key & 0xff, (key >>> 8) & 0xff];
    const array = new Uint8Array(XOR_ARRAY_SIZE);
    array.set(password);
    array.set(PAD_BYTES.slice(0, XOR_ARRAY_SIZE - password.length), password.length);

    return array.map((byte, index) => rotateLeft8(byte ^ (keyBytes[index & 1] ?? 0), 2));
}

// Decrypts one byte of a record. The array index is the byte's stream offset plus the size of its record.
export function decryptXorByte(byte: number, array: Uint8Array, arrayIndex: number): number {
    return rotateLeft8(byte, 3) ^ (array[arrayIndex & (XOR_ARRAY_SIZE - 1)] ?? 0);
}

function rotateLeft15(value: number): number {
    return ((value >>> 14) & 1) | ((value << 1) & 0x7fff);
}

function rotateLeft8(value: number, bits: number): number {
    return ((value << bits) | (value >>> (8 - bits))) & 0xff;
}
