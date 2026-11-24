import { describe, expect, it } from 'vitest';
import { CFB } from 'xlsx';
import { buildStandardEncryptedAsync, patternBytes } from '../testing/encryptionFixtures.js';
import { readEncryptionInfo } from './encryptionInfo.js';
import { unlockStandardPackageAsync } from './standardEncryption.js';

const compound = CFB as unknown as {
    read(data: Uint8Array, options: { readonly type: 'array' }): unknown;
    find(container: unknown, path: string): { readonly content: ArrayLike<number> } | null;
};

async function unlockAsync(file: Uint8Array, password: string): Promise<Uint8Array | null> {
    const container = compound.read(file, { type: 'array' });
    const info = readEncryptionInfo(Uint8Array.from(compound.find(container, '/EncryptionInfo')?.content ?? []));
    const encryptedPackage = Uint8Array.from(compound.find(container, '/EncryptedPackage')?.content ?? []);

    if (info.kind !== 'standard') {
        throw new Error('Not Standard encryption.');
    }

    return await unlockStandardPackageAsync({ header: info.header, encryptedPackage }, password);
}

describe('unlockStandardPackageAsync', () => {
    const plain = patternBytes(1000, 4);

    it('decrypts an AES-128 and an AES-256 package to its recorded size', async () => {
        for (const keyBits of [128, 256] as const) {
            const file = await buildStandardEncryptedAsync({ password: 'tika', plain, keyBits });

            expect(await unlockAsync(file, 'tika'), `${keyBits}`).toEqual(plain);
        }
    });

    it('gives null for a wrong password', async () => {
        const file = await buildStandardEncryptedAsync({ password: 'tika', plain });

        expect(await unlockAsync(file, 'Tika')).toBeNull();
    });
});
