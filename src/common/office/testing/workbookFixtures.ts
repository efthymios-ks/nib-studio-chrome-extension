import * as XLSX from 'xlsx';

export interface SheetFixture {
    readonly name: string;
    readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
    readonly hidden?: boolean;
}

// A workbook of several sheets, in this order, as SheetJS writes it in the given format, such as xlsx, biff8 or ods.
export function buildSheetsWorkbook(sheets: ReadonlyArray<SheetFixture>, bookType: XLSX.BookType = 'xlsx'): Uint8Array {
    const book = XLSX.utils.book_new();

    for (const sheet of sheets) {
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheet.rows.map((row) => [...row])), sheet.name);
    }

    book.Workbook = { Sheets: sheets.map((sheet) => ({ Hidden: sheet.hidden === true ? 1 : 0 })) };

    return new Uint8Array(XLSX.write(book, { bookType, type: 'array' }) as ArrayBuffer);
}

// The sheets the tests share: two quarters, a region whose name has a space, and a hidden sheet of rates.
export const SALES_SHEETS: ReadonlyArray<SheetFixture> = [
    {
        name: 'Q1',
        rows: [['order_id', 'city', 'total'], ['Q1-1', 'Patras', 120], ['Q1-2', 'Athens', 80], ['Q1-3', 'Volos', 45]],
    },
    {
        name: 'Q2',
        rows: [['order_id', 'city', 'total'], ['Q2-1', 'Larissa', 300], ['Q2-2', 'Patras', 15]],
    },
    {
        name: 'North Region',
        rows: [['customer', 'city', 'revenue'], ['Thessaly Ironworks', 'Larissa', 5400], ['Olympus Foods', 'Katerini', 2100]],
    },
    {
        name: 'Rates',
        rows: [['product', 'vat'], ['Paper', 24]],
        hidden: true,
    },
];
