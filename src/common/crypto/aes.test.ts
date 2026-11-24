import { createCipheriv } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptAesCbcAsync, decryptAesEcbAsync } from './aes.js';

function pattern(length: number, seed: number): Uint8Array {
    return Uint8Array.from({ length }, (_, index) => (index * 37 + seed) & 0xff);
}

function nodeEncrypt(mode: 'cbc' | 'ecb', key: Uint8Array, iv: Uint8Array | null, data: Uint8Array): Uint8Array {
    const cipher = createCipheriv(`aes-${key.length * 8}-${mode}`, key, iv);
    cipher.setAutoPadding(false);

    return new Uint8Array(Buffer.concat([cipher.update(data), cipher.final()]));
}

describe('decryptAesCbcAsync', () => {
    it('decrypts unpadded CBC data with 128- and 256-bit keys', async () => {
        for (const keySize of [16, 32]) {
            const key = pattern(keySize, 1);
            const iv = pattern(16, 2);
            const plain = pattern(16 * 7, 3);

            expect(await decryptAesCbcAsync(key, iv, nodeEncrypt('cbc', key, iv, plain))).toEqual(plain);
        }
    });

    it('leaves out a trailing part block and returns nothing for no data', async () => {
        const key = pattern(16, 4);
        const iv = pattern(16, 5);
        const plain = pattern(32, 6);
        const encrypted = nodeEncrypt('cbc', key, iv, plain);

        expect(await decryptAesCbcAsync(key, iv, Uint8Array.of(...encrypted, 1, 2, 3))).toEqual(plain);
        expect(await decryptAesCbcAsync(key, iv, new Uint8Array(0))).toEqual(new Uint8Array(0));
    });

    it('refuses key sizes the browser can\'t use', async () => {
        await expect(decryptAesCbcAsync(pattern(24, 1), pattern(16, 2), pattern(16, 3))).rejects.toThrow('AES keys of 192 bits can\'t be used here.');
    });
});

describe('decryptAesEcbAsync', () => {
    it('decrypts ECB data block by block', async () => {
        const key = pattern(32, 7);
        const plain = pattern(16 * 5, 8);

        expect(await decryptAesEcbAsync(key, nodeEncrypt('ecb', key, null, plain))).toEqual(plain);
    });
});
