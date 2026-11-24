import { describe, expect, it } from 'vitest';
import { CFB } from 'xlsx';
import { buildAgileEncryptedAsync, patternBytes } from '../testing/encryptionFixtures.js';
import { unlockAgilePackageAsync } from './agileEncryption.js';
import { readEncryptionInfo } from './encryptionInfo.js';

const compound = CFB as unknown as {
    read(data: Uint8Array, options: { readonly type: 'array' }): unknown;
    find(container: unknown, path: string): { readonly content: ArrayLike<number> } | null;
};

async function unlockAsync(file: Uint8Array, password: string): Promise<Uint8Array | null> {
    const container = compound.read(file, { type: 'array' });
    const info = readEncryptionInfo(Uint8Array.from(compound.find(container, '/EncryptionInfo')?.content ?? []));
    const encryptedPackage = Uint8Array.from(compound.find(container, '/EncryptedPackage')?.content ?? []);

    if (info.kind !== 'agile') {
        throw new Error('Not Agile encryption.');
    }

    return await unlockAgilePackageAsync({ keyData: info.keyData, passwordKey: info.passwordKey, encryptedPackage }, password);
}

describe('unlockAgilePackageAsync', () => {
    // Over two 4096-byte segments, so a later segment's own IV is used, and not a whole number of blocks.
    const plain = patternBytes(9000, 9);

    it('decrypts a SHA-512, AES-256 package across its segments', async () => {
        const file = await buildAgileEncryptedAsync({ password: 'Correct horse', plain, hash: 'SHA512', keyBits: 256 });

        expect(await unlockAsync(file, 'Correct horse')).toEqual(plain);
    });

    it('decrypts a SHA-1, AES-128 package', async () => {
        const file = await buildAgileEncryptedAsync({ password: 'pw', plain, hash: 'SHA1', keyBits: 128 });

        expect(await unlockAsync(file, 'pw')).toEqual(plain);
    });

    it('gives null for a wrong password', async () => {
        const file = await buildAgileEncryptedAsync({ password: 'pw', plain: Uint8Array.of(1, 2, 3) });

        expect(await unlockAsync(file, 'PW')).toBeNull();
        expect(await unlockAsync(file, '')).toBeNull();
    });
});
