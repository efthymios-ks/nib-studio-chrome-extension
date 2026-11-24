import { describe, expect, it } from 'vitest';
import { Md5, md5 } from './md5.js';

describe('md5', () => {
    const vectors = [
        { input: '', digest: 'd41d8cd98f00b204e9800998ecf8427e' },
        { input: 'a', digest: '0cc175b9c0f1b6a831c399e269772661' },
        { input: 'abc', digest: '900150983cd24fb0d6963f7d28e17f72' },
        { input: 'message digest', digest: 'f96b697d7cb7938d525a2f31aaf161d0' },
        { input: 'abcdefghijklmnopqrstuvwxyz', digest: 'c3fcd3d76192e4007dfb496cca67e13b' },
        {
            input: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
            digest: 'd174ab98d277d9f5a5611c2c9f419d9f',
        },
        {
            input: '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
            digest: '57edf4a22be3c955ac49da2e2107b67a',
        },
    ] as const;

    for (const vector of vectors) {
        it(`matches RFC 1321 for "${vector.input.slice(0, 16)}"`, () => {
            expect(md5(vector.input)).toBe(vector.digest);
        });
    }

    it('accepts raw bytes', () => {
        const bytes = new TextEncoder().encode('abc');
        expect(md5(bytes)).toBe('900150983cd24fb0d6963f7d28e17f72');
    });
});

describe('Md5', () => {
    it('gives the same digest however the input is split', () => {
        const bytes = Uint8Array.from({ length: 1000 }, (_, index) => (index * 31) % 256);
        const whole = md5(bytes);

        for (const pieceSize of [1, 7, 63, 64, 65, 333]) {
            const hasher = new Md5();

            for (let offset = 0; offset < bytes.length; offset += pieceSize) {
                hasher.update(bytes.subarray(offset, offset + pieceSize));
            }

            const hex = [...hasher.digest()].map((byte) => byte.toString(16).padStart(2, '0')).join('');
            expect(hex).toBe(whole);
        }
    });

    it('pads correctly at every length around a block boundary', () => {
        // Lengths 55, 56 and 64 change how much padding the last block needs.
        expect(md5('a'.repeat(55))).toBe('ef1772b6dff9a122358552954ad0df65');
        expect(md5('a'.repeat(56))).toBe('3b0c8ac703f828b04c6c197006d17218');
        expect(md5('a'.repeat(64))).toBe('014842d480b571495a4a0363793f7367');
    });
});
