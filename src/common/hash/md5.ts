const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
] as const;

const K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
    0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
    0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
    0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
    0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
    0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
] as const;

const BLOCK_SIZE = 64;

export function md5(input: string | Uint8Array): string {
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
    const digest = new Md5().update(bytes).digest();
    let hex = '';

    for (const byte of digest) {
        hex += byte.toString(16).padStart(2, '0');
    }

    return hex;
}

// RFC 1321 MD5, fed in pieces so a large file can be hashed a chunk at a time.
export class Md5 {
    private readonly state = Int32Array.from([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
    private readonly pending = new Uint8Array(BLOCK_SIZE);
    private readonly words = new Int32Array(16);
    private pendingLength = 0;
    private totalLength = 0;

    update(bytes: Uint8Array): this {
        let offset = 0;
        this.totalLength += bytes.length;

        if (this.pendingLength > 0) {
            const taken = Math.min(BLOCK_SIZE - this.pendingLength, bytes.length);
            this.pending.set(bytes.subarray(0, taken), this.pendingLength);
            this.pendingLength += taken;
            offset = taken;

            if (this.pendingLength < BLOCK_SIZE) {
                return this;
            }

            this.processBlock(this.pending, 0);
            this.pendingLength = 0;
        }

        while (offset + BLOCK_SIZE <= bytes.length) {
            this.processBlock(bytes, offset);
            offset += BLOCK_SIZE;
        }

        this.pending.set(bytes.subarray(offset), 0);
        this.pendingLength = bytes.length - offset;

        return this;
    }

    // The 16-byte digest; the instance is spent afterwards.
    digest(): Uint8Array {
        const bitLength = this.totalLength * 8;
        const paddingLength = this.pendingLength < 56 ? 56 - this.pendingLength : 120 - this.pendingLength;
        const tail = new Uint8Array(paddingLength + 8);
        tail[0] = 0x80;

        const tailView = new DataView(tail.buffer);
        tailView.setUint32(paddingLength, bitLength >>> 0, true);
        tailView.setUint32(paddingLength + 4, Math.floor(bitLength / 0x100000000), true);
        this.update(tail);

        const digest = new Uint8Array(16);
        const digestView = new DataView(digest.buffer);

        for (let index = 0; index < 4; index += 1) {
            digestView.setInt32(index * 4, this.state[index] ?? 0, true);
        }

        return digest;
    }

    private processBlock(bytes: Uint8Array, offset: number): void {
        const words = this.words;

        for (let index = 0; index < 16; index += 1) {
            const start = offset + index * 4;
            words[index] = (bytes[start] ?? 0)
                | ((bytes[start + 1] ?? 0) << 8)
                | ((bytes[start + 2] ?? 0) << 16)
                | ((bytes[start + 3] ?? 0) << 24);
        }

        let a = this.state[0] ?? 0;
        let b = this.state[1] ?? 0;
        let c = this.state[2] ?? 0;
        let d = this.state[3] ?? 0;

        for (let index = 0; index < 64; index += 1) {
            let f = 0;
            let g = 0;

            if (index < 16) {
                f = (b & c) | (~b & d);
                g = index;
            }
            else if (index < 32) {
                f = (d & b) | (~d & c);
                g = (5 * index + 1) % 16;
            }
            else if (index < 48) {
                f = b ^ c ^ d;
                g = (3 * index + 5) % 16;
            }
            else {
                f = c ^ (b | ~d);
                g = (7 * index) % 16;
            }

            const temp = d;
            d = c;
            c = b;
            b = add32(b, rotateLeft(add32(add32(a, f), add32(K[index] ?? 0, words[g] ?? 0)), S[index] ?? 0));
            a = temp;
        }

        this.state[0] = add32(this.state[0] ?? 0, a);
        this.state[1] = add32(this.state[1] ?? 0, b);
        this.state[2] = add32(this.state[2] ?? 0, c);
        this.state[3] = add32(this.state[3] ?? 0, d);
    }
}

function add32(a: number, b: number): number {
    return (a + b) | 0;
}

function rotateLeft(value: number, amount: number): number {
    return (value << amount) | (value >>> (32 - amount));
}
