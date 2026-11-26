import { describe, expect, it } from 'vitest';
import { LinqError } from './linqErrors.js';
import { parseQuery } from './linqParser.js';
import { querySourceFor, quoteSheetName, resolveQuerySheet, sheetNamedIn } from './linqSheets.js';

const SHEETS = ['Q1', 'Q2', 'North Region'];

function resolve(text: string, sheets: ReadonlyArray<string>): number {
    return resolveQuerySheet(parseQuery(text), sheets);
}

function errorOf(text: string, sheets: ReadonlyArray<string>): LinqError {
    try {
        resolve(text, sheets);
    }
    catch (error: unknown) {
        if (error instanceof LinqError) {
            return error.locate(text);
        }

        throw error;
    }

    throw new Error('Expected a LinqError.');
}

describe('resolveQuerySheet', () => {
    it('reads the one table of a CSV or TSV file with from *, from table or from row in table', () => {
        expect(resolve('from * take 1', [])).toBe(0);
        expect(resolve('from table take 1', [])).toBe(0);
        expect(resolve('from row in table take 1', [])).toBe(0);
    });

    it('says a CSV or TSV file has no sheets to name', () => {
        expect(errorOf('from orders take 1', []).message).toBe("This file has no sheets, so 'orders' names none; write 'from *'.");
        expect(errorOf('from o in orders', []).message).toBe("This file has no sheets, so 'orders' names none; write 'from o in table'.");
    });

    it('reads the only sheet of a workbook with from * or by its name, ignoring case', () => {
        expect(resolve('from *', ['Data'])).toBe(0);
        expect(resolve('from row in table', ['Data'])).toBe(0);
        expect(resolve('from data', ['Data'])).toBe(0);
        expect(resolve('from [DATA]', ['Data'])).toBe(0);
    });

    it('names the only sheet when another name is written', () => {
        expect(errorOf('from Summary', ['North Region']).message)
            .toBe("This workbook has no sheet named 'Summary'; its only sheet is 'North Region', which 'from *' reads too.");
    });

    it('rejects from * in a workbook of several sheets, naming them, and marks the star', () => {
        const text = 'from *\nwhere total > 1';
        const error = errorOf(text, SHEETS);

        expect(error.message).toBe("This workbook has 3 sheets; name one: Q1, Q2, 'North Region'.");
        expect(text.slice(error.start, error.end)).toBe('*');
        expect([error.line, error.column]).toEqual([1, 6]);
    });

    it('rejects from table and from row in table in the same way, marking table', () => {
        const text = 'from row in table select row';
        const error = errorOf(text, SHEETS);

        expect(error.message).toBe("This workbook has 3 sheets; name one: Q1, Q2, 'North Region'.");
        expect(text.slice(error.start, error.end)).toBe('table');
        expect(errorOf('from table', SHEETS).message).toBe("This workbook has 3 sheets; name one: Q1, Q2, 'North Region'.");
    });

    it.each([
        ['from Q2', 1],
        ['from q2', 1],
        ['from row in Q1', 0],
        ["from 'North Region'", 2],
        ['from "north region"', 2],
        ['from [North Region]', 2],
        ['from row in [NORTH REGION]', 2],
        ['from `North Region`', 2],
    ])('reads %s', (text, index) => {
        expect(resolve(`${text} take 5`, SHEETS)).toBe(index);
    });

    it('rejects an unknown sheet, listing the sheets and suggesting a close name', () => {
        const text = 'from Q5 take 1';
        const error = errorOf(text, SHEETS);

        expect(error.message).toBe("This workbook has no sheet named 'Q5'; name one: Q1, Q2, 'North Region'. Did you mean Q1?");
        expect(text.slice(error.start, error.end)).toBe('Q5');
        expect(errorOf("from 'South'", SHEETS).message).toBe("This workbook has no sheet named 'South'; name one: Q1, Q2, 'North Region'.");
    });

    it('lists at most twelve sheets', () => {
        const sheets = Array.from({ length: 15 }, (_, index) => `S${index + 1}`);

        expect(errorOf('from *', sheets).message).toBe('This workbook has 15 sheets; name one: S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S12 and 3 more.');
    });
});

describe('quoteSheetName', () => {
    it('leaves a plain word bare and quotes anything else', () => {
        expect(quoteSheetName('Q2')).toBe('Q2');
        expect(quoteSheetName('North Region')).toBe("'North Region'");
        expect(quoteSheetName('2024')).toBe("'2024'");
        expect(quoteSheetName('Select')).toBe("'Select'");
        expect(quoteSheetName("Ada's")).toBe("'Ada\\'s'");
    });

    it('writes names that read back as the same sheet', () => {
        for (const name of ['North Region', "Ada's", 'Q2', 'table', '2024', 'Sales & Ops']) {
            expect(parseQuery(`from ${quoteSheetName(name)}`).source.sheet, name).toBe(name);
        }
    });
});

describe('querySourceFor', () => {
    it('starts a query with * unless a workbook has several sheets', () => {
        expect(querySourceFor([], null)).toBe('*');
        expect(querySourceFor(['Data'], 'Data')).toBe('*');
        expect(querySourceFor(SHEETS, 'North Region')).toBe("'North Region'");
        expect(querySourceFor(SHEETS, 'Q2')).toBe('Q2');
    });
});

describe('sheetNamedIn', () => {
    it.each([
        ['from Q2 where ', 'Q2'],
        ['  FROM row IN q2\nwhere row.', 'q2'],
        ["from 'North Region' where (", 'North Region'],
        ["from 'Ada\\'s' select", "Ada's"],
        ['from "North Region"', 'North Region'],
        ['from [North Region] where', 'North Region'],
        ['from `North Region`', 'North Region'],
        ['from 2024 take', '2024'],
    ])('reads the sheet of %s', (text, sheet) => {
        expect(sheetNamedIn(text)).toBe(sheet);
    });

    it.each(['from * where', 'from table', 'from row in table where', 'where total > 1', 'from '])('reads no sheet from %s', (text) => {
        expect(sheetNamedIn(text)).toBeNull();
    });
});
