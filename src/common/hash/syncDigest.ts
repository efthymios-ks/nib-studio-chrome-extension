import { concatBytes } from '../binary/bytes.js';
import type { HashAlgorithm } from './hash.js';
import { Md5 } from './md5.js';

// FIPS 180-4 digests computed at once on the calling thread. Deriving a key from a password hashes a few dozen bytes
// a hundred thousand times, where a Web Crypto call costs far more than the hashing itself.

// SHA-512 round constants, each as its high then its low 32 bits.
const K512 = Int32Array.from([
    0x428a2f98, 0xd728ae22, 0x71374491, 0x23ef65cd,
    0xb5c0fbcf, 0xec4d3b2f, 0xe9b5dba5, 0x8189dbbc,
    0x3956c25b, 0xf348b538, 0x59f111f1, 0xb605d019,
    0x923f82a4, 0xaf194f9b, 0xab1c5ed5, 0xda6d8118,
    0xd807aa98, 0xa3030242, 0x12835b01, 0x45706fbe,
    0x243185be, 0x4ee4b28c, 0x550c7dc3, 0xd5ffb4e2,
    0x72be5d74, 0xf27b896f, 0x80deb1fe, 0x3b1696b1,
    0x9bdc06a7, 0x25c71235, 0xc19bf174, 0xcf692694,
    0xe49b69c1, 0x9ef14ad2, 0xefbe4786, 0x384f25e3,
    0x0fc19dc6, 0x8b8cd5b5, 0x240ca1cc, 0x77ac9c65,
    0x2de92c6f, 0x592b0275, 0x4a7484aa, 0x6ea6e483,
    0x5cb0a9dc, 0xbd41fbd4, 0x76f988da, 0x831153b5,
    0x983e5152, 0xee66dfab, 0xa831c66d, 0x2db43210,
    0xb00327c8, 0x98fb213f, 0xbf597fc7, 0xbeef0ee4,
    0xc6e00bf3, 0x3da88fc2, 0xd5a79147, 0x930aa725,
    0x06ca6351, 0xe003826f, 0x14292967, 0x0a0e6e70,
    0x27b70a85, 0x46d22ffc, 0x2e1b2138, 0x5c26c926,
    0x4d2c6dfc, 0x5ac42aed, 0x53380d13, 0x9d95b3df,
    0x650a7354, 0x8baf63de, 0x766a0abb, 0x3c77b2a8,
    0x81c2c92e, 0x47edaee6, 0x92722c85, 0x1482353b,
    0xa2bfe8a1, 0x4cf10364, 0xa81a664b, 0xbc423001,
    0xc24b8b70, 0xd0f89791, 0xc76c51a3, 0x0654be30,
    0xd192e819, 0xd6ef5218, 0xd6990624, 0x5565a910,
    0xf40e3585, 0x5771202a, 0x106aa070, 0x32bbd1b8,
    0x19a4c116, 0xb8d2d0c8, 0x1e376c08, 0x5141ab53,
    0x2748774c, 0xdf8eeb99, 0x34b0bcb5, 0xe19b48a8,
    0x391c0cb3, 0xc5c95a63, 0x4ed8aa4a, 0xe3418acb,
    0x5b9cca4f, 0x7763e373, 0x682e6ff3, 0xd6b2b8a3,
    0x748f82ee, 0x5defb2fc, 0x78a5636f, 0x43172f60,
    0x84c87814, 0xa1f0ab72, 0x8cc70208, 0x1a6439ec,
    0x90befffa, 0x23631e28, 0xa4506ceb, 0xde82bde9,
    0xbef9a3f7, 0xb2c67915, 0xc67178f2, 0xe372532b,
    0xca273ece, 0xea26619c, 0xd186b8c7, 0x21c0c207,
    0xeada7dd6, 0xcde0eb1e, 0xf57d4f7f, 0xee6ed178,
    0x06f067aa, 0x72176fba, 0x0a637dc5, 0xa2c898a6,
    0x113f9804, 0xbef90dae, 0x1b710b35, 0x131c471b,
    0x28db77f5, 0x23047d84, 0x32caab7b, 0x40c72493,
    0x3c9ebe0a, 0x15c9bebc, 0x431d67c4, 0x9c100d4c,
    0x4cc5d4be, 0xcb3e42b6, 0x597f299c, 0xfc657e2a,
    0x5fcb6fab, 0x3ad6faec, 0x6c44198c, 0x4a475817,
]);

// SHA-256 uses the high halves of the first 64 SHA-512 constants.
const K256 = Int32Array.from({ length: 64 }, (_, index) => K512[index * 2] ?? 0);

const SHA512_START: ReadonlyArray<number> = [
    0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1,
    0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179,
];

const SHA384_START: ReadonlyArray<number> = [
    0xcbbb9d5d, 0xc1059ed8, 0x629a292a, 0x367cd507, 0x9159015a, 0x3070dd17, 0x152fecd8, 0xf70e5939,
    0x67332667, 0xffc00b31, 0x8eb44a87, 0x68581511, 0xdb0c2e0d, 0x64f98fa7, 0x47b5481d, 0xbefa4fa4,
];

// SHA-256 starts from the high halves of SHA-512's starting values.
const SHA256_START: ReadonlyArray<number> = SHA512_START.filter((_, index) => index % 2 === 0);

const SHA1_START: ReadonlyArray<number> = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];

const TWO_TO_32 = 0x100000000;

type SyncDigest = (bytes: Uint8Array) => Uint8Array;

const DIGESTS: Readonly<Record<HashAlgorithm, SyncDigest>> = Object.freeze({
    'MD5': (bytes) => new Md5().update(bytes).digest(),
    'SHA-1': sha1,
    'SHA-256': sha256,
    'SHA-384': (bytes) => sha512Family(bytes, SHA384_START, 48),
    'SHA-512': (bytes) => sha512Family(bytes, SHA512_START, 64),
});

// The digest of the parts one after another, as if they were one array.
export function digestSync(algorithm: HashAlgorithm, ...parts: ReadonlyArray<Uint8Array>): Uint8Array {
    return DIGESTS[algorithm](parts.length === 1 ? parts[0] ?? new Uint8Array(0) : concatBytes(parts));
}

// The message, a 0x80 byte, zeros, then its length in bits as a big-endian number, filling whole blocks.
function padMessage(bytes: Uint8Array, blockSize: number, lengthSize: number): Uint8Array {
    const total = Math.ceil((bytes.length + 1 + lengthSize) / blockSize) * blockSize;
    const padded = new Uint8Array(total);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    const bits = bytes.length * 8;
    view.setUint32(total - 8, Math.floor(bits / TWO_TO_32));
    view.setUint32(total - 4, bits >>> 0);

    return padded;
}

function writeWords(words: ArrayLike<number>, length: number): Uint8Array {
    const digest = new Uint8Array(length);
    const view = new DataView(digest.buffer);

    for (let index = 0; index * 4 < length; index += 1) {
        view.setInt32(index * 4, words[index] ?? 0);
    }

    return digest;
}

function sha1(bytes: Uint8Array): Uint8Array {
    const padded = padMessage(bytes, 64, 8);
    const view = new DataView(padded.buffer);
    const words = new Int32Array(80);
    const state = Int32Array.from(SHA1_START);

    for (let block = 0; block < padded.length; block += 64) {
        for (let index = 0; index < 16; index += 1) {
            words[index] = view.getInt32(block + index * 4);
        }

        for (let index = 16; index < 80; index += 1) {
            const mixed = (words[index - 3] ?? 0) ^ (words[index - 8] ?? 0) ^ (words[index - 14] ?? 0) ^ (words[index - 16] ?? 0);
            words[index] = (mixed << 1) | (mixed >>> 31);
        }

        let a = state[0] ?? 0;
        let b = state[1] ?? 0;
        let c = state[2] ?? 0;
        let d = state[3] ?? 0;
        let e = state[4] ?? 0;

        for (let index = 0; index < 80; index += 1) {
            const round = sha1Round(index, b, c, d);
            const next = (((a << 5) | (a >>> 27)) + round + e + (words[index] ?? 0)) | 0;
            e = d;
            d = c;
            c = (b << 30) | (b >>> 2);
            b = a;
            a = next;
        }

        state[0] = (state[0] ?? 0) + a;
        state[1] = (state[1] ?? 0) + b;
        state[2] = (state[2] ?? 0) + c;
        state[3] = (state[3] ?? 0) + d;
        state[4] = (state[4] ?? 0) + e;
    }

    return writeWords(state, 20);
}

// The round function and constant of each fifth of SHA-1's 80 rounds, added together.
function sha1Round(index: number, b: number, c: number, d: number): number {
    if (index < 20) {
        return ((b & c) | (~b & d)) + 0x5a827999;
    }

    if (index < 40) {
        return (b ^ c ^ d) + 0x6ed9eba1;
    }

    if (index < 60) {
        return ((b & c) | (b & d) | (c & d)) + 0x8f1bbcdc;
    }

    return (b ^ c ^ d) + 0xca62c1d6;
}

function sha256(bytes: Uint8Array): Uint8Array {
    const padded = padMessage(bytes, 64, 8);
    const view = new DataView(padded.buffer);
    const words = new Int32Array(64);
    const state = Int32Array.from(SHA256_START);

    for (let block = 0; block < padded.length; block += 64) {
        for (let index = 0; index < 16; index += 1) {
            words[index] = view.getInt32(block + index * 4);
        }

        for (let index = 16; index < 64; index += 1) {
            const early = words[index - 15] ?? 0;
            const late = words[index - 2] ?? 0;
            const s0 = rotateRight(early, 7) ^ rotateRight(early, 18) ^ (early >>> 3);
            const s1 = rotateRight(late, 17) ^ rotateRight(late, 19) ^ (late >>> 10);
            words[index] = ((words[index - 16] ?? 0) + s0 + (words[index - 7] ?? 0) + s1) | 0;
        }

        let a = state[0] ?? 0;
        let b = state[1] ?? 0;
        let c = state[2] ?? 0;
        let d = state[3] ?? 0;
        let e = state[4] ?? 0;
        let f = state[5] ?? 0;
        let g = state[6] ?? 0;
        let h = state[7] ?? 0;

        for (let index = 0; index < 64; index += 1) {
            const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
            const choice = (e & f) ^ (~e & g);
            const first = (h + s1 + choice + (K256[index] ?? 0) + (words[index] ?? 0)) | 0;
            const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            h = g;
            g = f;
            f = e;
            e = (d + first) | 0;
            d = c;
            c = b;
            b = a;
            a = (first + s0 + majority) | 0;
        }

        const rounds = [a, b, c, d, e, f, g, h];

        for (let index = 0; index < 8; index += 1) {
            state[index] = (state[index] ?? 0) + (rounds[index] ?? 0);
        }
    }

    return writeWords(state, 32);
}

function rotateRight(value: number, bits: number): number {
    return (value >>> bits) | (value << (32 - bits));
}

// SHA-512 and SHA-384, which differ only in their starting values and how much of the state they give out.
// Each 64-bit word is a pair of 32-bit halves, high first.
function sha512Family(bytes: Uint8Array, start: ReadonlyArray<number>, length: number): Uint8Array {
    const padded = padMessage(bytes, 128, 16);
    const view = new DataView(padded.buffer);
    const words = new Int32Array(160);
    const state = Int32Array.from(start);

    for (let block = 0; block < padded.length; block += 128) {
        for (let index = 0; index < 32; index += 1) {
            words[index] = view.getInt32(block + index * 4);
        }

        expandSha512Words(words);
        compressSha512(state, words);
    }

    return writeWords(state, length);
}

function expandSha512Words(words: Int32Array): void {
    for (let index = 16; index < 80; index += 1) {
        const earlyHigh = words[(index - 15) * 2] ?? 0;
        const earlyLow = words[(index - 15) * 2 + 1] ?? 0;
        const lateHigh = words[(index - 2) * 2] ?? 0;
        const lateLow = words[(index - 2) * 2 + 1] ?? 0;
        // σ0: rotate right by 1 and 8, shift right by 7.
        const s0High = ((earlyHigh >>> 1) | (earlyLow << 31)) ^ ((earlyHigh >>> 8) | (earlyLow << 24)) ^ (earlyHigh >>> 7);
        const s0Low = ((earlyLow >>> 1) | (earlyHigh << 31)) ^ ((earlyLow >>> 8) | (earlyHigh << 24)) ^ ((earlyLow >>> 7) | (earlyHigh << 25));
        // σ1: rotate right by 19 and 61, shift right by 6.
        const s1High = ((lateHigh >>> 19) | (lateLow << 13)) ^ ((lateLow >>> 29) | (lateHigh << 3)) ^ (lateHigh >>> 6);
        const s1Low = ((lateLow >>> 19) | (lateHigh << 13)) ^ ((lateHigh >>> 29) | (lateLow << 3)) ^ ((lateLow >>> 6) | (lateHigh << 26));
        const low = ((words[(index - 16) * 2 + 1] ?? 0) >>> 0) + (s0Low >>> 0) + ((words[(index - 7) * 2 + 1] ?? 0) >>> 0) + (s1Low >>> 0);
        const high = (words[(index - 16) * 2] ?? 0) + s0High + (words[(index - 7) * 2] ?? 0) + s1High + Math.floor(low / TWO_TO_32);
        words[index * 2] = high | 0;
        words[index * 2 + 1] = low | 0;
    }
}

function compressSha512(state: Int32Array, words: Int32Array): void {
    const working = Int32Array.from(state);

    for (let index = 0; index < 80; index += 1) {
        const aHigh = working[0] ?? 0;
        const aLow = working[1] ?? 0;
        const eHigh = working[8] ?? 0;
        const eLow = working[9] ?? 0;
        // Σ1: rotate right by 14, 18 and 41.
        const s1High = ((eHigh >>> 14) | (eLow << 18)) ^ ((eHigh >>> 18) | (eLow << 14)) ^ ((eLow >>> 9) | (eHigh << 23));
        const s1Low = ((eLow >>> 14) | (eHigh << 18)) ^ ((eLow >>> 18) | (eHigh << 14)) ^ ((eHigh >>> 9) | (eLow << 23));
        const choiceHigh = (eHigh & (working[10] ?? 0)) ^ (~eHigh & (working[12] ?? 0));
        const choiceLow = (eLow & (working[11] ?? 0)) ^ (~eLow & (working[13] ?? 0));
        const firstLow = ((working[15] ?? 0) >>> 0) + (s1Low >>> 0) + (choiceLow >>> 0)
            + ((K512[index * 2 + 1] ?? 0) >>> 0) + ((words[index * 2 + 1] ?? 0) >>> 0);
        const firstHigh = ((working[14] ?? 0) + s1High + choiceHigh + (K512[index * 2] ?? 0) + (words[index * 2] ?? 0)
            + Math.floor(firstLow / TWO_TO_32)) | 0;
        // Σ0: rotate right by 28, 34 and 39.
        const s0High = ((aHigh >>> 28) | (aLow << 4)) ^ ((aLow >>> 2) | (aHigh << 30)) ^ ((aLow >>> 7) | (aHigh << 25));
        const s0Low = ((aLow >>> 28) | (aHigh << 4)) ^ ((aHigh >>> 2) | (aLow << 30)) ^ ((aHigh >>> 7) | (aLow << 25));
        const majorityHigh = (aHigh & (working[2] ?? 0)) ^ (aHigh & (working[4] ?? 0)) ^ ((working[2] ?? 0) & (working[4] ?? 0));
        const majorityLow = (aLow & (working[3] ?? 0)) ^ (aLow & (working[5] ?? 0)) ^ ((working[3] ?? 0) & (working[5] ?? 0));
        // e takes d + T1, and a takes T1 + Σ0 + Maj, once every word has moved one place down.
        const eNextLow = ((working[7] ?? 0) >>> 0) + (firstLow >>> 0);
        const aNextLow = (firstLow >>> 0) + (s0Low >>> 0) + (majorityLow >>> 0);
        working.copyWithin(2, 0, 14);
        working[8] = ((working[8] ?? 0) + firstHigh + Math.floor(eNextLow / TWO_TO_32)) | 0;
        working[9] = eNextLow | 0;
        working[0] = (firstHigh + s0High + majorityHigh + Math.floor(aNextLow / TWO_TO_32)) | 0;
        working[1] = aNextLow | 0;
    }

    for (let index = 0; index < 16; index += 2) {
        const low = ((state[index + 1] ?? 0) >>> 0) + ((working[index + 1] ?? 0) >>> 0);
        state[index] = ((state[index] ?? 0) + (working[index] ?? 0) + Math.floor(low / TWO_TO_32)) | 0;
        state[index + 1] = low | 0;
    }
}
