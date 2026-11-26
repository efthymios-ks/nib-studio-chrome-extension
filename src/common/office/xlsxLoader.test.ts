import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { rememberUnlocked } from './encryption/unlockedFiles.js';
import { buildStandardEncryptedAsync, buildTinyWorkbook, buildTinyXlsx } from './testing/encryptionFixtures.js';
import { SALES_SHEETS, buildSheetsWorkbook } from './testing/workbookFixtures.js';
import { cachedWorkbookOf, loadWorkbookAsync, readWorkbook, rememberWorkbook, visibleSheetsOf } from './xlsxLoader.js';

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

        expect(workbook.sheets.map((sheet) => [sheet.name, sheet.hidden, sheet.rows, sheet.firstRow])).toEqual([['Data', false, [['Name'], ['Ada']], 1]]);
    });

    it('reads macro-enabled and binary Excel workbooks and OpenDocument spreadsheets', () => {
        for (const bookType of ['xlsm', 'xlsb', 'ods'] as const) {
            const workbook = readWorkbook(buildTinyWorkbook([['Name'], ['Ada']], bookType));

            expect(workbook.sheets.map((sheet) => sheet.rows), bookType).toEqual([[['Name'], ['Ada']]]);
        }
    });
});

describe('sheets of a workbook', () => {
    it('lists every sheet in workbook order, marking the hidden ones', () => {
        for (const bookType of ['xlsx', 'biff8', 'xlsb'] as const) {
            const workbook = readWorkbook(buildSheetsWorkbook(SALES_SHEETS, bookType));

            expect(workbook.sheets.map((sheet) => [sheet.name, sheet.hidden]), bookType).toEqual([
                ['Q1', false],
                ['Q2', false],
                ['North Region', false],
                ['Rates', true],
            ]);
            expect(visibleSheetsOf(workbook).map((sheet) => sheet.name), bookType).toEqual(['Q1', 'Q2', 'North Region']);
            expect(workbook.sheets[2]?.rows[1], bookType).toEqual(['Thessaly Ironworks', 'Larissa', '5400']);
        }
    });

    it('reads every sheet of an OpenDocument spreadsheet', () => {
        const workbook = readWorkbook(buildSheetsWorkbook(SALES_SHEETS.slice(0, 3), 'ods'));

        expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(['Q1', 'Q2', 'North Region']);
    });

    it('numbers the first row as the sheet does', () => {
        expect(readWorkbook(buildSheetsWorkbook(SALES_SHEETS)).sheets[0]?.firstRow).toBe(1);

        const book = XLSX.utils.book_new();
        const worksheet: XLSX.WorkSheet = { '!ref': 'B3:B4', 'B3': { t: 's', v: 'name' }, 'B4': { t: 's', v: 'Ada' } };
        XLSX.utils.book_append_sheet(book, worksheet, 'Offset');
        const offset = readWorkbook(new Uint8Array(XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer));

        expect(offset.sheets[0]?.firstRow).toBe(3);
        expect(offset.sheets[0]?.rows).toEqual([['name'], ['Ada']]);
    });

    it('reads a snapshot once, and the next snapshot again', async () => {
        const bytes = buildSheetsWorkbook(SALES_SHEETS);
        const file = new File([bytes.slice()], 'sales.xlsx');
        const read = vi.spyOn(file, 'arrayBuffer');

        const first = await loadWorkbookAsync(file);
        const second = await loadWorkbookAsync(file);

        expect(second).toBe(first);
        expect(cachedWorkbookOf(file)).toBe(first);
        expect(read).toHaveBeenCalledTimes(1);

        const changed = new File([bytes.slice()], 'sales.xlsx');

        expect(cachedWorkbookOf(changed)).toBeNull();
        expect(await loadWorkbookAsync(changed)).not.toBe(first);
    });

    it('keeps a workbook read elsewhere for its snapshot', () => {
        const file = new File([''], 'kept.xlsx');
        const workbook = { sheets: [] };

        expect(rememberWorkbook(file, workbook)).toBe(workbook);
        expect(cachedWorkbookOf(file)).toBe(workbook);
    });

    it('reads every sheet of a locked workbook once its tab unlocked it', async () => {
        const plain = buildSheetsWorkbook(SALES_SHEETS);
        const file = new File([await buildStandardEncryptedAsync({ password: 'pw', plain })], 'locked.xlsx');

        await expect(loadWorkbookAsync(file)).rejects.toThrow('protected with a password');
        expect(cachedWorkbookOf(file)).toBeNull();

        rememberUnlocked(file, plain);

        expect((await loadWorkbookAsync(file)).sheets.map((sheet) => sheet.name)).toEqual(['Q1', 'Q2', 'North Region', 'Rates']);
    });
});
