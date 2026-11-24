import { describe, expect, it } from 'vitest';
import { createXorArray, createXorKey, createXorVerifier, decryptXorByte, xorPasswordBytes } from './xorObfuscation.js';

describe('xorPasswordBytes', () => {
    it('takes each character\'s low byte, or its high byte when the low one is zero, up to 15 characters', () => {
        expect([...xorPasswordBytes('abc')]).toEqual([0x61, 0x62, 0x63]);
        expect([...xorPasswordBytes('Ā')]).toEqual([0x01]);
        expect(xorPasswordBytes('x'.repeat(20))).toHaveLength(15);
    });
});

describe('createXorVerifier and createXorKey', () => {
    // The key and verifier Excel stored for the password "abc".
    it('give what Excel stores for a password', () => {
        const password = xorPasswordBytes('abc');

        expect(createXorKey(password)).toBe(0x514a);
        expect(createXorVerifier(password)).toBe(0xcc1a);
    });

    it('differ for another password, and the key is zero for no password', () => {
        expect(createXorVerifier(xorPasswordBytes('abd'))).not.toBe(0xcc1a);
        expect(createXorKey(new Uint8Array(0))).toBe(0);
    });
});

describe('createXorArray and decryptXorByte', () => {
    it('make 16 bytes that undo the obfuscation of each byte by its position', () => {
        const array = createXorArray(xorPasswordBytes('secret'));
        const obfuscate = (byte: number, index: number): number => {
            const mixed = byte ^ (array[index & 15] ?? 0);

            return ((mixed >>> 3) | (mixed << 5)) & 0xff;
        };

        expect(array).toHaveLength(16);

        for (const [byte, index] of [[0x00, 0], [0x41, 7], [0xff, 15], [0x80, 33]] as const) {
            expect(decryptXorByte(obfuscate(byte, index), array, index)).toBe(byte);
        }
    });
});
