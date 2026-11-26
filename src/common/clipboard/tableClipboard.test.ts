import { describe, expect, it } from 'vitest';
import {
    RICH_TABLE_ROW_LIMIT,
    TABLE_COPY_ROW_LIMIT,
    planTableCopy,
    tableCopyMessage,
    tableToHtml,
    tableToTsv,
} from './tableClipboard.js';

describe('tableToTsv', () => {
    it('writes a header line and one line per row, tab-separated', () => {
        const text = tableToTsv({ columns: ['name', 'age'], rows: [['Ada', 36], ['Alan', null]] });

        expect(text).toBe('name\tage\nAda\t36\nAlan\t');
    });

    it('quotes a cell holding a tab, a line break or a quote, doubling its quotes', () => {
        const text = tableToTsv({ columns: ['note'], rows: [['a\tb'], ['line 1\nline 2'], ['say "hi"'], ['plain']] });

        expect(text).toBe('note\n"a\tb"\n"line 1\nline 2"\n"say ""hi"""\nplain');
    });
});

describe('tableToHtml', () => {
    it('writes a bordered table with a header row and escaped cells', () => {
        const html = tableToHtml({ columns: ['name', 'a<b'], rows: [['Ada & Co', 1]] });

        expect(html).toContain('<table border="1"');
        expect(html).toContain('<thead><tr><th>name</th><th>a&lt;b</th></tr></thead>');
        expect(html).toContain('<tbody><tr><td>Ada &amp; Co</td><td>1</td></tr></tbody>');
    });

    it('keeps a line break inside its cell', () => {
        const html = tableToHtml({ columns: ['note'], rows: [['one\ntwo']] });

        expect(html).toContain('<td>one<br style="mso-data-placement:same-cell">two</td>');
    });

    it('never writes a script from a cell', () => {
        const html = tableToHtml({ columns: ['x'], rows: [['<script>alert(1)</script>']] });

        expect(html).not.toContain('<script');
    });
});

describe('planTableCopy', () => {
    it('copies a table of up to the rich limit as HTML and text', () => {
        expect(planTableCopy(RICH_TABLE_ROW_LIMIT)).toEqual({ rowCount: RICH_TABLE_ROW_LIMIT, rich: true, truncated: false });
    });

    it('copies a larger table as text only', () => {
        expect(planTableCopy(RICH_TABLE_ROW_LIMIT + 1)).toEqual({ rowCount: RICH_TABLE_ROW_LIMIT + 1, rich: false, truncated: false });
    });

    it('copies the first rows of a table past the copy limit', () => {
        expect(planTableCopy(250_000)).toEqual({ rowCount: TABLE_COPY_ROW_LIMIT, rich: false, truncated: true });
    });
});

describe('tableCopyMessage', () => {
    it('counts the rows copied', () => {
        expect(tableCopyMessage(planTableCopy(1250), 1250)).toEqual({ message: '1,250 rows copied.', tone: 'ok' });
        expect(tableCopyMessage(planTableCopy(1), 1)).toEqual({ message: '1 row copied.', tone: 'ok' });
    });

    it('says when the rows went as plain text only', () => {
        expect(tableCopyMessage(planTableCopy(25_000), 25_000)).toEqual({ message: '25,000 rows copied, as plain text.', tone: 'ok' });
    });

    it('warns when only the first rows were copied', () => {
        expect(tableCopyMessage(planTableCopy(250_000), 250_000)).toEqual({
            message: 'First 100,000 of 250,000 rows copied, as plain text.',
            tone: 'warn',
        });
    });

    it('says when no rows show', () => {
        expect(tableCopyMessage(planTableCopy(0), 0).message).toBe('Column names copied; no rows are shown.');
    });
});
