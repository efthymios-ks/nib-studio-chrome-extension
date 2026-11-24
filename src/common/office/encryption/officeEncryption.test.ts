import { describe, expect, it } from 'vitest';
import { readCompoundFile } from '../compoundFile.js';
import { buildCompoundFile } from '../testing/docFixtures.js';
import {
    buildAgileEncryptedAsync,
    buildEncryptedWorkbook,
    buildStandardEncryptedAsync,
    buildTinyXlsx,
    encryptedPackageFile,
    encryptionInfoStream,
} from '../testing/encryptionFixtures.js';
import { readPackageEncryption, readWorkbookEncryption } from './officeEncryption.js';
import type { OfficeEncryption } from './officeEncryptionTypes.js';

function expectPassword(encryption: OfficeEncryption | null): Extract<OfficeEncryption, { kind: 'password' }> {
    if (encryption?.kind !== 'password') {
        throw new Error(`Expected a password lock, got ${JSON.stringify(encryption)}.`);
    }

    return encryption;
}

describe('readPackageEncryption', () => {
    it('opens an Agile and a Standard package with the password and refuses a wrong one', async () => {
        const plain = buildTinyXlsx([['Name'], ['Ada']]);
        const files = [
            await buildAgileEncryptedAsync({ password: 'pw', plain, spinCount: 10 }),
            await buildStandardEncryptedAsync({ password: 'pw', plain }),
        ];

        for (const file of files) {
            const encryption = expectPassword(readPackageEncryption(readCompoundFile(file)));

            expect(await encryption.unlockAsync('pw')).toEqual(plain);
            expect(await encryption.unlockAsync('nope')).toBeNull();
        }
    });

    it('says a package that decrypts to something other than a ZIP is damaged', async () => {
        const encryption = expectPassword(readPackageEncryption(readCompoundFile(await buildStandardEncryptedAsync({ password: 'pw', plain: Uint8Array.of(1, 2, 3) }))));

        await expect(encryption.unlockAsync('pw')).rejects.toThrow('so its encrypted data is damaged');
    });

    it('says rights management, missing details and unknown versions can\'t be opened', () => {
        const rights = readPackageEncryption(readCompoundFile(buildCompoundFile({ '\u0009DRMContent': Uint8Array.of(1), 'EncryptedPackage': Uint8Array.of(2) })));
        const missing = readPackageEncryption(readCompoundFile(buildCompoundFile({ EncryptedPackage: Uint8Array.of(2) })));
        const unknown = readPackageEncryption(readCompoundFile(encryptedPackageFile(encryptionInfoStream(3, 3, 0, new Uint8Array(8)), Uint8Array.of(1))));

        expect(rights).toMatchObject({ kind: 'unsupported', scheme: 'Information Rights Management' });
        expect(missing).toMatchObject({ kind: 'unsupported', scheme: 'Unknown encryption' });
        expect(unknown).toMatchObject({ kind: 'unsupported', scheme: 'Extensible encryption' });
    });

    it('finds nothing in a compound file without an encrypted package', () => {
        expect(readPackageEncryption(readCompoundFile(buildCompoundFile({ WordDocument: new Uint8Array(64) })))).toBeNull();
    });
});

describe('readWorkbookEncryption', () => {
    it('finds the encryption of an XLSX and of an Excel 97–2003 workbook', async () => {
        const xlsx = await buildStandardEncryptedAsync({ password: 'pw', plain: buildTinyXlsx([['A']]) });
        const xls = buildEncryptedWorkbook([['A']], 'pw', 'rc4');

        expect(readWorkbookEncryption(xlsx)).toMatchObject({ kind: 'password', scheme: 'Standard encryption, AES-128 with SHA-1' });
        expect(readWorkbookEncryption(xls)).toMatchObject({ kind: 'password', scheme: 'RC4 encryption' });
    });

    it('finds nothing in a plain XLSX, a plain .xls or bytes that aren\'t a compound file', () => {
        expect(readWorkbookEncryption(buildTinyXlsx([['A']]))).toBeNull();
        expect(readWorkbookEncryption(buildCompoundFile({ Workbook: Uint8Array.of(0x09, 0x08, 0, 0) }))).toBeNull();
        expect(readWorkbookEncryption(Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0))).toBeNull();
    });
});
