import { escapeHtmlText } from '../html/escapeHtml.js';

// Up to this many rows a table copies as an HTML table as well as tab-separated text, so it pastes as cells under
// a header row into documents and mail as well as spreadsheets. Past it, as tab-separated text only,
// which spreadsheets still split into cells and which pastes far faster.
export const RICH_TABLE_ROW_LIMIT = 10_000;

// The most rows a copy takes; a table showing more copies its first rows this many.
export const TABLE_COPY_ROW_LIMIT = 100_000;

// Breaks a line inside a cell when the table pastes into Excel, rather than starting a new row.
const CELL_LINE_BREAK = '<br style="mso-data-placement:same-cell">';

// A table as it shows: its column names and its rows, each row's cells in the order of the columns.
export interface TableCopy {
    readonly columns: ReadonlyArray<string>;
    readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
}

export interface TableCopyPlan {
    // The rows the copy takes: every row shown, or the first TABLE_COPY_ROW_LIMIT of them.
    readonly rowCount: number;
    // Whether an HTML table goes with the tab-separated text.
    readonly rich: boolean;
    // Whether the table shows more rows than the copy takes.
    readonly truncated: boolean;
}

export interface TableCopyMessage {
    readonly message: string;
    readonly tone: 'ok' | 'warn';
}

// How a table showing this many rows goes on the clipboard.
export function planTableCopy(shownRows: number): TableCopyPlan {
    const rowCount = Math.min(shownRows, TABLE_COPY_ROW_LIMIT);

    return { rowCount, rich: rowCount <= RICH_TABLE_ROW_LIMIT, truncated: shownRows > rowCount };
}

// What the toast says once the rows are on the clipboard, such as `1,250 rows copied.`.
export function tableCopyMessage(plan: TableCopyPlan, shownRows: number): TableCopyMessage {
    if (plan.truncated) {
        return {
            message: `First ${formatCount(plan.rowCount)} of ${formatCount(shownRows)} rows copied, as plain text.`,
            tone: 'warn',
        };
    }

    if (plan.rowCount === 0) {
        return { message: 'Column names copied; no rows are shown.', tone: 'ok' };
    }

    const rows = plan.rowCount === 1 ? '1 row' : `${formatCount(plan.rowCount)} rows`;

    return { message: plan.rich ? `${rows} copied.` : `${rows} copied, as plain text.`, tone: 'ok' };
}

// The text of a cell as the table shows it.
export function cellText(value: unknown): string {
    return value == null ? '' : String(value);
}

// The table as tab-separated text with a header line, as spreadsheets paste it: a cell holding a tab,
// a line break or a quote is quoted, its quotes doubled.
export function tableToTsv(table: TableCopy): string {
    return [table.columns, ...table.rows]
        .map((row) => row.map((value) => tsvCell(cellText(value))).join('\t'))
        .join('\n');
}

// The table as an HTML table with a header row and borders.
export function tableToHtml(table: TableCopy): string {
    const header = table.columns.map((name) => `<th>${cellHtml(name)}</th>`).join('');
    const rows = table.rows
        .map((row) => `<tr>${row.map((value) => `<td>${cellHtml(cellText(value))}</td>`).join('')}</tr>`)
        .join('');

    return '<table border="1" cellspacing="0" cellpadding="4" style="border-collapse: collapse;">'
        + `<thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
}

function tsvCell(text: string): string {
    return /[\t\r\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function cellHtml(text: string): string {
    return escapeHtmlText(text).replace(/\r\n?|\n/g, CELL_LINE_BREAK);
}

function formatCount(count: number): string {
    return count.toLocaleString('en-US');
}
