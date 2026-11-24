import * as XLSX from 'xlsx';
import { readWorkbookEncryption } from './encryption/officeEncryption.js';
import { unlockedBytesOf } from './encryption/unlockedFiles.js';

export interface Sheet {
    readonly name: string;
    readonly hidden: boolean;
    readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
}

export interface Workbook {
    readonly sheets: ReadonlyArray<Sheet>;
}

// Reads a workbook file. One with a password reads from the plain bytes its tab unlocked; until then it can't be read.
export async function loadWorkbookAsync(input: File): Promise<Workbook> {
    const bytes = new Uint8Array(await input.arrayBuffer());

    if (readWorkbookEncryption(bytes) == null) {
        return readWorkbook(bytes);
    }

    const unlocked = unlockedBytesOf(input);

    if (unlocked == null) {
        throw new Error('This workbook is protected with a password. Open it in its own tab and enter the password first.');
    }

    return readWorkbook(unlocked);
}

// Reads the sheets of workbook bytes that need no password.
export function readWorkbook(bytes: Uint8Array): Workbook {
    const workbook = XLSX.read(bytes, { type: 'array', cellDates: true });
    const sheets = workbook.SheetNames.map((name) => buildSheet(workbook, name));

    return { sheets };
}

function buildSheet(workbook: XLSX.WorkBook, name: string): Sheet {
    const worksheet = workbook.Sheets[name];

    if (worksheet == null) {
        return { name, hidden: false, rows: [] };
    }

    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        defval: '',
        raw: false,
    });
    const hidden = isSheetHidden(workbook, name);

    return { name, hidden, rows };
}

function isSheetHidden(workbook: XLSX.WorkBook, name: string): boolean {
    const metadata = (workbook.Workbook?.Sheets ?? []).find((entry) => entry.name === name);

    if (metadata == null) {
        return false;
    }

    return metadata.Hidden === 1 || metadata.Hidden === 2;
}
