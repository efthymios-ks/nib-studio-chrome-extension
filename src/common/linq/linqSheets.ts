import type { LinqQuery } from './linqAst.js';
import { LinqError, suggestName } from './linqErrors.js';
import { isBareName } from './linqParser.js';

// Which table of a file a query reads. A CSV or TSV file is one table without a name, read with `from *`.
// A workbook with one sheet reads it with `from *` or by its name; a workbook with more sheets must name one,
// as in `from Q2` or `from 'North Region'`, and names match ignoring case.

// Sheets an error lists before it says how many more there are.
const LISTED_SHEETS = 12;

// A sheet name as a query writes it: bare when it is a plain word that isn't a keyword, in single quotes otherwise.
export function quoteSheetName(name: string): string {
    if (isBareName(name)) {
        return name;
    }

    return `'${name.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`;
}

// The source a query on this table starts with: `*` for a CSV or TSV file or a workbook of one sheet,
// the sheet's name in a workbook of several.
export function querySourceFor(sheets: ReadonlyArray<string>, sheet: string | null): string {
    return sheets.length > 1 && sheet != null ? quoteSheetName(sheet) : '*';
}

// The sheet named after `from`, or after `from row in`, while the rest of the query may still be half written;
// null for `*`, `table`, or a query that doesn't start with from yet.
const SOURCE_WRITTEN = /^\s*from\s+(?:[A-Za-z_]\w*\s+in\s+)?(?:\[([^\]\n]*)\]|'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`([^`\n]*)`|([A-Za-z_]\w*|\d+))/i;

export function sheetNamedIn(text: string): string | null {
    const match = SOURCE_WRITTEN.exec(text);

    if (match == null) {
        return null;
    }

    const [, bracketed, single, double, backticked, bare] = match;

    if (bare != null) {
        return bare.toLowerCase() === 'table' ? null : bare;
    }

    const quoted = single ?? double;

    return quoted != null ? quoted.replace(/\\(.)/gu, '$1') : bracketed ?? backticked ?? null;
}

// The index among `sheets`, the sheet names of a workbook in order, of the sheet the query reads;
// `sheets` is empty for a CSV or TSV file, whose one table is index 0.
export function resolveQuerySheet(query: LinqQuery, sheets: ReadonlyArray<string>): number {
    const { sheet, span } = query.source;

    if (sheets.length === 0) {
        if (sheet == null) {
            return 0;
        }

        throw new LinqError(`This file has no sheets, so '${sheet}' names none; write ${openTableHint(query)}.`, span);
    }

    if (sheet == null) {
        if (sheets.length === 1) {
            return 0;
        }

        throw new LinqError(`This workbook has ${sheets.length} sheets; name one: ${listSheets(sheets)}.`, span);
    }

    const wanted = sheet.toLowerCase();
    const index = sheets.findIndex((name) => name.toLowerCase() === wanted);

    if (index >= 0) {
        return index;
    }

    if (sheets.length === 1) {
        const only = quoteSheetName(sheets[0] as string);

        throw new LinqError(`This workbook has no sheet named '${sheet}'; its only sheet is ${only}, which 'from *' reads too.`, span);
    }

    const suggestion = suggestName(sheet, sheets);
    const hint = suggestion == null ? '' : ` Did you mean ${quoteSheetName(suggestion)}?`;

    throw new LinqError(`This workbook has no sheet named '${sheet}'; name one: ${listSheets(sheets)}.${hint}`, span);
}

function openTableHint(query: LinqQuery): string {
    return query.rangeVariable == null ? "'from *'" : `'from ${query.rangeVariable} in table'`;
}

function listSheets(sheets: ReadonlyArray<string>): string {
    const listed = sheets.slice(0, LISTED_SHEETS).map(quoteSheetName).join(', ');
    const more = sheets.length - LISTED_SHEETS;

    return more > 0 ? `${listed} and ${more} more` : listed;
}
