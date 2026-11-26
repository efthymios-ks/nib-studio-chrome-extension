import * as XLSX from 'xlsx';
import { readWorkbookEncryption } from './encryption/officeEncryption.js';
import { unlockedBytesOf } from './encryption/unlockedFiles.js';

export interface Sheet {
    readonly name: string;
    readonly hidden: boolean;
    readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
    // The sheet's row number, counting from 1 as Excel does, of the first row in `rows`.
    readonly firstRow: number;
}

export interface Workbook {
    readonly sheets: ReadonlyArray<Sheet>;
}

// Each workbook is read once per File snapshot, which lives while its tab is open,
// so coming back to a tab, switching sheets or comparing another sheet never reads or parses it again.
// A file changed on disk is a new snapshot and is read again.
const workbooks = new WeakMap<File, Workbook>();

// The workbook already read from this snapshot, or null.
export function cachedWorkbookOf(file: File): Workbook | null {
    return workbooks.get(file) ?? null;
}

// Keeps the workbook read from this snapshot, and hands it back.
export function rememberWorkbook(file: File, workbook: Workbook): Workbook {
    workbooks.set(file, workbook);

    return workbook;
}

// Reads a workbook file. One with a password reads from the plain bytes its tab unlocked; until then it can't be read.
export async function loadWorkbookAsync(input: File): Promise<Workbook> {
    const cached = cachedWorkbookOf(input);

    if (cached != null) {
        return cached;
    }

    const bytes = new Uint8Array(await input.arrayBuffer());

    if (readWorkbookEncryption(bytes) == null) {
        return rememberWorkbook(input, readWorkbook(bytes));
    }

    const unlocked = unlockedBytesOf(input);

    if (unlocked == null) {
        throw new Error('This workbook is protected with a password. Open it in its own tab and enter the password first.');
    }

    return rememberWorkbook(input, readWorkbook(unlocked));
}

// Reads the sheets of workbook bytes that need no password, in workbook order.
export function readWorkbook(bytes: Uint8Array): Workbook {
    const workbook = XLSX.read(bytes, { type: 'array', cellDates: true });
    const sheets = workbook.SheetNames.map((name) => buildSheet(workbook, name));

    return { sheets };
}

// The sheets a person sees as tabs in Excel: every sheet that isn't hidden.
export function visibleSheetsOf(workbook: Workbook): ReadonlyArray<Sheet> {
    return workbook.sheets.filter((sheet) => !sheet.hidden);
}

function buildSheet(workbook: XLSX.WorkBook, name: string): Sheet {
    const worksheet = workbook.Sheets[name];

    if (worksheet == null) {
        return { name, hidden: false, rows: [], firstRow: 1 };
    }

    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        defval: '',
        raw: false,
    });
    const hidden = isSheetHidden(workbook, name);
    const range = worksheet['!ref'] == null ? null : XLSX.utils.decode_range(worksheet['!ref']);

    return { name, hidden, rows, firstRow: (range?.s.r ?? 0) + 1 };
}

// Hidden, or very hidden, which Excel shows only through its code editor.
function isSheetHidden(workbook: XLSX.WorkBook, name: string): boolean {
    const metadata = (workbook.Workbook?.Sheets ?? []).find((entry) => entry.name === name);

    if (metadata == null) {
        return false;
    }

    return metadata.Hidden === 1 || metadata.Hidden === 2;
}
