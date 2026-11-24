import { describe, expect, it } from 'vitest';
import { rememberUnlocked } from './encryption/unlockedFiles.js';
import { buildStandardEncryptedAsync, buildTinyWorkbook, buildTinyXlsx } from './testing/encryptionFixtures.js';
import { loadWorkbookAsync, readWorkbook } from './xlsxLoader.js';

describe('loadWorkbookAsync', () => {
    it('reads sheets from a minimal workbook via the vendored SheetJS', async () => {
        const csv = 'A,B\n1,2\n';
        const file = new File([csv], 'tiny.csv', { type: 'text/csv' });
        const workbook = await loadWorkbookAsync(file);

        expect(workbook.sheets.length).toBeGreaterThan(0);
        const first = workbook.sheets[0];
        expect(first?.rows?.[0]?.[0]).toBe('A');
    });

    it('asks for an encrypted workbook to be unlocked in its tab first, then reads what its tab unlocked', async () => {
        const plain = buildTinyXlsx([['Locked'], ['row']]);
        const file = new File([await buildStandardEncryptedAsync({ password: 'pw', plain })], 'locked.xlsx');

        await expect(loadWorkbookAsync(file)).rejects.toThrow('This workbook is protected with a password.');

        rememberUnlocked(file, plain);

        expect((await loadWorkbookAsync(file)).sheets[0]?.rows).toEqual([['Locked'], ['row']]);
    });
});

describe('readWorkbook', () => {
    it('reads the sheets of workbook bytes', () => {
        const workbook = readWorkbook(buildTinyXlsx([['Name'], ['Ada']]));

        expect(workbook.sheets.map((sheet) => [sheet.name, sheet.hidden, sheet.rows])).toEqual([['Data', false, [['Name'], ['Ada']]]]);
    });

    it('reads macro-enabled and binary Excel workbooks and OpenDocument spreadsheets', () => {
        for (const bookType of ['xlsm', 'xlsb', 'ods'] as const) {
            const workbook = readWorkbook(buildTinyWorkbook([['Name'], ['Ada']], bookType));

            expect(workbook.sheets.map((sheet) => sheet.rows), bookType).toEqual([[['Name'], ['Ada']]]);
        }
    });
});
