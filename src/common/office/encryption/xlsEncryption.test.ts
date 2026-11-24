import { describe, expect, it, vi } from 'vitest';
import { CFB } from 'xlsx';
import { readCompoundFile } from '../compoundFile.js';
import { buildCompoundFile } from '../testing/docFixtures.js';
import { buildEncryptedWorkbook } from '../testing/encryptionFixtures.js';
import { readWorkbook } from '../xlsxLoader.js';
import type { OfficeEncryption } from './officeEncryptionTypes.js';
import { readXlsEncryption } from './xlsEncryption.js';

const ROWS = [['Name', 'Age'], ['Ada', 36], ['Alan', 41]];

const compound = CFB as unknown as {
    read(data: Uint8Array, options: { readonly type: 'array' }): unknown;
    find(container: unknown, path: string): { readonly content: ArrayLike<number> } | null;
};

function encryptionOf(bytes: Uint8Array): OfficeEncryption | null {
    return readXlsEncryption(bytes, readCompoundFile(bytes));
}

function workbookStream(bytes: Uint8Array): Uint8Array {
    return Uint8Array.from(compound.find(compound.read(bytes, { type: 'array' }), '/Workbook')?.content ?? []);
}

describe('readXlsEncryption', () => {
    it('unlocks RC4, RC4 CryptoAPI and XOR workbooks into ones SheetJS reads without complaint', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

        for (const scheme of ['rc4', 'cryptoapi', 'xor'] as const) {
            const encryption = encryptionOf(buildEncryptedWorkbook(ROWS, 'abc', scheme));
            const plain = encryption?.kind === 'password' ? await encryption.unlockAsync('abc') : null;
            const sheet = readWorkbook(plain ?? new Uint8Array(0)).sheets[0];

            expect(sheet?.name, scheme).toBe('Data');
            expect(sheet?.rows, scheme).toEqual([['Name', 'Age'], ['Ada', '36'], ['Alan', '41']]);
        }

        expect(errors).not.toHaveBeenCalled();
        errors.mockRestore();
    });

    it('names each scheme and refuses a wrong password', async () => {
        const schemes = { rc4: 'RC4 encryption', cryptoapi: 'RC4 CryptoAPI encryption, 128-bit key', xor: 'XOR obfuscation' } as const;

        for (const [scheme, name] of Object.entries(schemes)) {
            const encryption = encryptionOf(buildEncryptedWorkbook(ROWS, 'abc', scheme as keyof typeof schemes));

            expect(encryption?.scheme).toBe(name);
            expect(encryption?.kind === 'password' && await encryption.unlockAsync('abd'), scheme).toBeNull();
        }
    });

    it('unlocks again after a right and a wrong password, as asking again does', async () => {
        for (const scheme of ['rc4', 'cryptoapi', 'xor'] as const) {
            const encryption = encryptionOf(buildEncryptedWorkbook(ROWS, 'abc', scheme));
            const attempts = encryption?.kind === 'password'
                ? [await encryption.unlockAsync('abc'), await encryption.unlockAsync('nope'), await encryption.unlockAsync('abc')]
                : [];

            expect(attempts.map((attempt) => attempt != null), scheme).toEqual([true, false, true]);
        }
    });

    it('turns FILEPASS into a record readers skip, keeping every stream position', async () => {
        const encrypted = buildEncryptedWorkbook(ROWS, 'abc', 'rc4');
        const encryption = encryptionOf(encrypted);
        const plain = encryption?.kind === 'password' ? await encryption.unlockAsync('abc') : null;
        const before = workbookStream(encrypted);
        const after = workbookStream(plain ?? new Uint8Array(0));
        const secondRecordType = (stream: Uint8Array): number => {
            const firstSize = (stream[2] ?? 0) | ((stream[3] ?? 0) << 8);

            return (stream[4 + firstSize] ?? 0) | ((stream[5 + firstSize] ?? 0) << 8);
        };

        expect(after.length).toBe(before.length);
        expect(secondRecordType(before)).toBe(0x002f);
        expect(secondRecordType(after)).toBe(0x00e2);
    });

    it('finds nothing in a workbook without FILEPASS', () => {
        expect(encryptionOf(buildCompoundFile({ Workbook: Uint8Array.of(0x09, 0x08, 2, 0, 0, 6, 0x0a, 0, 0, 0) }))).toBeNull();
    });

    it('says an Excel 5.0/95 workbook and an unknown encryption type can\'t be opened', () => {
        const bof = (version: number): number[] => [0x09, 0x08, 4, 0, version & 0xff, version >>> 8, 0x05, 0x00];
        const biff5 = buildCompoundFile({ Book: Uint8Array.of(...bof(0x0500), 0x2f, 0x00, 4, 0, 1, 2, 3, 4) });
        const unknownType = buildCompoundFile({ Workbook: Uint8Array.of(...bof(0x0600), 0x2f, 0x00, 2, 0, 7, 0) });

        expect(encryptionOf(biff5)).toMatchObject({ kind: 'unsupported', scheme: 'Excel 5.0/95 encryption' });
        expect(encryptionOf(unknownType)).toMatchObject({ kind: 'unsupported', reason: 'Its encryption type 7 isn\'t one the preview knows.' });
    });
});
