import { describe, expect, it } from 'vitest';
import { isAbortError } from '../csv/csvLimits.js';
import { LinqError } from './linqErrors.js';
import { compileQuery, runQueryAsync, type LinqResult } from './linqEvaluator.js';
import { buildCsvRowIndexAsync } from '../csv/csvRowIndex.js';
import { createArrayTableSource, createCsvTableSource, type LinqTableSource } from './linqSources.js';
import { formatValue, matchesLike } from './linqValues.js';

const COLUMNS = ['order_id', 'customer', 'city', 'product', 'quantity', 'unit_price', 'total', 'status', 'ordered_at', 'note'];

const ROWS: string[][] = [
    ['ORD-1', 'Ann', 'Patras', 'Ruler', '2', '5', '10', 'delivered', '2024-01-15', ''],
    ['ORD-2', 'Bob', 'Athens', 'Marker', '1', '7.5', '7.5', 'pending', '2024-03-02', 'gift'],
    ['ORD-3', 'Cy', 'Patras', 'Ruler', '4', '5', '20', 'delivered', '2025-02-01', ''],
    ['ORD-4', 'Di', 'Athens', 'Scissors', '3', '30', '90', 'delivered', '2025-06-30', 'rush'],
    ['ORD-5', 'Ed', 'Volos', 'Marker', '10', '7.5', '75', 'shipped', '2023-12-31', ''],
    ['ORD-6', 'Fo', 'Patras', 'Glue', '', '', '', 'cancelled', '', 'no data'],
];

const source = (): LinqTableSource => createArrayTableSource(COLUMNS, ROWS, 2);

async function runAsync(text: string): Promise<LinqResult> {
    return runQueryAsync(text, source());
}

async function tableAsync(text: string): Promise<{ columns: ReadonlyArray<string>; rows: string[][] }> {
    const result = await runAsync(text);

    if (result.kind !== 'table') {
        throw new Error('Expected a table result.');
    }

    return { columns: result.columns, rows: result.rows.map((row) => row.map((value) => formatValue(value))) };
}

async function scalarAsync(text: string): Promise<unknown> {
    const result = await runAsync(text);

    if (result.kind !== 'scalar') {
        throw new Error('Expected a scalar result.');
    }

    return result.value;
}

async function errorAsync(text: string, run: () => Promise<unknown> = () => runAsync(text)): Promise<LinqError> {
    try {
        await run();
    }
    catch (error: unknown) {
        if (error instanceof LinqError) {
            return error;
        }

        throw error;
    }

    throw new Error('Expected a LinqError.');
}

describe('matchesLike', () => {
    it.each([
        ['Athens', 'ath*', true],
        ['Athens', '*ENS', true],
        ['Athens', '*the*', true],
        ['Athens', 'a*h*s', true],
        ['Athens', '*a*b', false],
        ['ab', '*a*b', true],
        ['aXbYc', 'a*b*c', true],
        ['abc', 'a*b*c*', true],
        ['abd', 'a*b*c', false],
        ['', '*', true],
        ['', '**', true],
        ['', '', true],
        ['x', '', false],
        ['anything', '**', true],
        ['anything', '*', true],
        ['ATHENS', 'athens', true],
        ['Athens', 'Athen', false],
        ['Athens', 'thens', false],
        ['a.b(c)', 'a.b(c)', true],
        ['a+b', 'a?b', false],
        ['ΑΘΗΝΑ', 'αθ*', true],
        ['mississippi', '*sip*', true],
        ['mississippi', 'm*iss*ppi', true],
        ['mississippi', 'm*iss*ppix', false],
    ])('%s like %s is %s', (text, pattern, expected) => {
        expect(matchesLike(text, pattern)).toBe(expected);
    });

    it('finishes quickly on a pathological pattern', () => {
        const text = 'a'.repeat(200_000);
        const started = performance.now();

        expect(matchesLike(text, '*a*a*a*a*a*b')).toBe(false);
        expect(matchesLike(`${text}b`, '*a*a*a*a*a*b')).toBe(true);
        expect(performance.now() - started).toBeLessThan(1000);
    });
});

describe('runQueryAsync: rows', () => {
    it('returns every row and column without a select', async () => {
        const result = await tableAsync('from *');

        expect(result.columns).toEqual(COLUMNS);
        expect(result.rows).toHaveLength(6);
    });

    it('filters with where in both source forms', async () => {
        const named = await tableAsync('from o in table where o.total > 15 && o.status == "delivered" select o.order_id');
        const star = await tableAsync('from * where total > 15 and status = "delivered" select order_id');

        expect(named.rows).toEqual([['ORD-3'], ['ORD-4']]);
        expect(star.rows).toEqual(named.rows);
    });

    it('compares numbers numerically, not as text', async () => {
        const result = await tableAsync('from * where quantity >= 3 select quantity');

        expect(result.rows.map((row) => row[0])).toEqual(['4', '3', '10']);
    });

    it('treats empty cells as null', async () => {
        expect((await tableAsync('from * where total == null select order_id')).rows).toEqual([['ORD-6']]);
        expect((await tableAsync('from * where note != null select order_id')).rows).toEqual([['ORD-2'], ['ORD-4'], ['ORD-6']]);
        expect((await tableAsync('from * where order_id == "ORD-6" select total ?? -1 as t, quantity * 2 as q')).rows).toEqual([['-1', '']]);
    });

    it('compares dates chronologically and reads their parts', async () => {
        const result = await tableAsync('from o in table where o.ordered_at >= "2025-01-01" select o.order_id, o.ordered_at.Year, o.ordered_at.Month, o.ordered_at.Day');

        expect(result.columns).toEqual(['order_id', 'Year', 'Month', 'Day']);
        expect(result.rows).toEqual([['ORD-3', '2025', '2', '1'], ['ORD-4', '2025', '6', '30']]);
        expect((await tableAsync('from * where ordered_at < date("2024-01-01") select order_id')).rows).toEqual([['ORD-5']]);
    });

    it('selects all columns with * and with the range variable', async () => {
        expect((await tableAsync('from * take 1 select *')).columns).toEqual(COLUMNS);
        expect((await tableAsync('from o in table take 1 select o')).columns).toEqual(COLUMNS);
    });

    it('builds anonymous objects with inferred and explicit names', async () => {
        const result = await tableAsync('from o in table take 1 select new { o.city, Amount = o.total * 2, o["unit price" == "x" ? "city" : "status"] }');

        expect(result.columns).toEqual(['city', 'Amount', 'o["unit price" == "x" ? "city" : "status"]']);
        expect(result.rows).toEqual([['Patras', '20', 'delivered']]);
    });

    it('names duplicate columns apart', async () => {
        expect((await tableAsync('from * take 1 select city, city')).columns).toEqual(['city', 'city 2']);
    });

    it('evaluates let and string methods', async () => {
        const result = await tableAsync([
            'from o in table',
            'let label = o.city.ToUpper() + "-" + o.product.Substring(0, 3)',
            'where label like "PAT*" && o.status not like "*cancel*"',
            'select label, o.product.Length, o.customer.ToLower(), o.note.Trim(), o.city.IndexOf("t"), o.city.Replace("a", "4")',
        ].join('\n'));

        expect(result.rows).toEqual([
            ['PATRAS-Rul', '5', 'ann', '', '2', 'P4tr4s'],
            ['PATRAS-Rul', '5', 'cy', '', '2', 'P4tr4s'],
        ]);
    });

    it('matches like patterns with * wildcards, ignoring case', async () => {
        const idsAsync = async (condition: string): Promise<string[]> => (await tableAsync(`from * where ${condition} select order_id`)).rows.map((row) => row[0] as string);

        expect(await idsAsync('city like "ath*"')).toEqual(['ORD-2', 'ORD-4']);
        expect(await idsAsync('city LIKE "*RAS"')).toEqual(['ORD-1', 'ORD-3', 'ORD-6']);
        expect(await idsAsync('city like "p*t*s"')).toEqual(['ORD-1', 'ORD-3', 'ORD-6']);
        expect(await idsAsync('city like "volos"')).toEqual(['ORD-5']);
        expect(await idsAsync('city like "volo"')).toEqual([]);
        expect(await idsAsync('note like "*gift*"')).toEqual(['ORD-2']);
        expect(await idsAsync('total like "7*"')).toEqual(['ORD-2', 'ORD-5']);
    });

    it('never matches an empty value with like or not like', async () => {
        const idsAsync = async (condition: string): Promise<string[]> => (await tableAsync(`from * where ${condition} select order_id`)).rows.map((row) => row[0] as string);

        expect(await idsAsync('note like "*"')).toEqual(['ORD-2', 'ORD-4', 'ORD-6']);
        expect(await idsAsync('note not like "*gift*"')).toEqual(['ORD-4', 'ORD-6']);
        expect(await idsAsync('not (note like "*gift*")')).toEqual(['ORD-1', 'ORD-3', 'ORD-4', 'ORD-5', 'ORD-6']);
        expect(await idsAsync('city like null')).toEqual([]);
    });

    it('evaluates in with typed equality', async () => {
        const idsAsync = async (condition: string): Promise<string[]> => (await tableAsync(`from * where ${condition} select order_id`)).rows.map((row) => row[0] as string);

        expect(await idsAsync('status in ("shipped", "pending")')).toEqual(['ORD-2', 'ORD-5']);
        expect(await idsAsync('quantity in (2, "4", true)')).toEqual(['ORD-1', 'ORD-3']);
        expect(await idsAsync('total in (7.5) or ordered_at in ("2025-06-30")')).toEqual(['ORD-2', 'ORD-4']);
        expect(await idsAsync('status not in ("delivered", "cancelled")')).toEqual(['ORD-2', 'ORD-5']);
        expect(await idsAsync('total in (null)')).toEqual(['ORD-6']);
        expect(await idsAsync('status in ("Shipped")')).toEqual([]);
    });

    it('evaluates between on numbers, dates and text, inclusive', async () => {
        const idsAsync = async (condition: string): Promise<string[]> => (await tableAsync(`from * where ${condition} select order_id`)).rows.map((row) => row[0] as string);

        expect(await idsAsync('total between 10 and 75')).toEqual(['ORD-1', 'ORD-3', 'ORD-5']);
        expect(await idsAsync('total between 10 and 75 and city == "Patras"')).toEqual(['ORD-1', 'ORD-3']);
        expect(await idsAsync('ordered_at between "2024-01-15" and date("2024-12-31")')).toEqual(['ORD-1', 'ORD-2']);
        expect(await idsAsync('customer between "B" and "D"')).toEqual(['ORD-2', 'ORD-3']);
        expect(await idsAsync('total not between 10 and 75')).toEqual(['ORD-2', 'ORD-4']);
        expect(await idsAsync('total between 1 + 9 and 15 * 5')).toEqual(['ORD-1', 'ORD-3', 'ORD-5']);
    });

    it('evaluates is null and is not null', async () => {
        expect((await tableAsync('from * where note is not null select order_id')).rows).toEqual([['ORD-2'], ['ORD-4'], ['ORD-6']]);
        expect((await tableAsync('from * where total IS NULL select order_id')).rows).toEqual([['ORD-6']]);
        expect((await tableAsync('from * where order_id == "ORD-1" select note is null as Empty, city like "pat*" as Patras')).rows).toEqual([['true', 'true']]);
    });

    it('uses the new comparisons in let, orderby and after group by', async () => {
        expect((await tableAsync('from * let big = total between 50 and 100 where big select order_id')).rows).toEqual([['ORD-4'], ['ORD-5']]);
        expect((await tableAsync('from * where total is not null orderby city like "a*" descending, order_id select order_id take 2')).rows).toEqual([['ORD-2'], ['ORD-4']]);
        expect((await tableAsync('from * group by city like "p*" into g select g.Key, count()')).rows).toEqual([['true', '3'], ['false', '3']]);
    });

    it('evaluates arithmetic, conditionals and Math', async () => {
        const result = await tableAsync('from * where order_id == "ORD-2" select total * 3 % 4, total > 5 ? "big" : "small", Math.Round(total / 3, 2), Math.Abs(-2), Math.Floor(7.5), Math.Ceiling(7.1), 7 / 0');

        expect(result.rows).toEqual([['2.5', 'big', '2.5', '2', '7', '8', '']]);
    });

    it('rounds half away from zero', async () => {
        expect(await scalarAsync('from * take 1 select min(Math.Round(2.5) + Math.Round(-2.5) * 10)')).toBe(-27);
    });

    it('accepts backtick names for columns with odd names', async () => {
        const odd = createArrayTableSource(['unit price', 'from'], [['3', 'x']]);
        const result = await runQueryAsync('from o in table select `unit price` * 2, o["unit price"], `from`', odd);

        expect(result.kind === 'table' ? result.rows[0] : null).toEqual([6, 3, 'x']);
    });
});

describe('runQueryAsync: ordering and paging', () => {
    it('orders by several keys with empty values last', async () => {
        const result = await tableAsync('from * orderby city, total descending select city, total');

        expect(result.rows).toEqual([
            ['Athens', '90'], ['Athens', '7.5'], ['Patras', '20'], ['Patras', '10'], ['Patras', ''], ['Volos', '75'],
        ]);
    });

    it('keeps empty values last when descending', async () => {
        const result = await tableAsync('from * orderby total desc select total');

        expect(result.rows.map((row) => row[0])).toEqual(['90', '75', '20', '10', '7.5', '']);
    });

    it('pages with skip and take before and after select', async () => {
        expect((await tableAsync('from * skip 1 take 2 select order_id')).rows).toEqual([['ORD-2'], ['ORD-3']]);
        expect((await tableAsync('from * select order_id skip 4 take 20')).rows).toEqual([['ORD-5'], ['ORD-6']]);
        expect((await tableAsync('from * orderby total desc select order_id skip 1 take 2')).rows).toEqual([['ORD-5'], ['ORD-3']]);
        expect((await tableAsync('from * take 0')).rows).toEqual([]);
    });

    it('orders by selected names after select', async () => {
        const result = await tableAsync('from o in table select o.city, Amount = o.total orderby Amount descending take 2');

        expect(result.rows).toEqual([['Athens', '90'], ['Volos', '75']]);
    });

    it('removes duplicates with distinct', async () => {
        expect((await tableAsync('from * select city distinct orderby city')).rows).toEqual([['Athens'], ['Patras'], ['Volos']]);
        expect((await tableAsync('from * select product, unit_price distinct')).rows).toHaveLength(4);
    });
});

describe('runQueryAsync: grouping and aggregates', () => {
    it('groups with into and aggregates on the group', async () => {
        const result = await tableAsync([
            'from o in table',
            'where o.status != "cancelled"',
            'group o by o.city into g',
            'select new { City = g.Key, Orders = count(g), Revenue = sum(g.total), Average = average(g.unit_price), Low = min(g.total), High = max(g.total) }',
            'orderby Revenue descending',
        ].join('\n'));

        expect(result.columns).toEqual(['City', 'Orders', 'Revenue', 'Average', 'Low', 'High']);
        expect(result.rows).toEqual([
            ['Athens', '2', '97.5', '18.75', '7.5', '90'],
            ['Volos', '1', '75', '7.5', '75', '75'],
            ['Patras', '2', '30', '5', '10', '20'],
        ]);
    });

    it('groups in the from * form with bare key names', async () => {
        const result = await tableAsync('from * group by city select city, count(), sum(total), avg(quantity) orderby city');

        expect(result.columns).toEqual(['city', 'count()', 'sum(total)', 'avg(quantity)']);
        expect(result.rows).toEqual([
            ['Athens', '2', '97.5', '2'],
            ['Patras', '3', '30', '3'],
            ['Volos', '1', '75', '10'],
        ]);
    });

    it('groups by a composite key', async () => {
        const result = await tableAsync('from o in table group o by new { o.city, o.status } into g where count(g) > 1 select g.Key.city, g.Key.status, n = count()');

        expect(result.rows).toEqual([['Patras', 'delivered', '2']]);
    });

    it('reads composite key members by name', async () => {
        const result = await tableAsync('from * group by new { city, Year = ordered_at.Year } select city, Year, count() orderby city, Year take 2');

        expect(result.rows).toEqual([['Athens', '2024', '1'], ['Athens', '2025', '1']]);
    });

    it('counts non-empty values with count(value)', async () => {
        expect(await scalarAsync('from * select count(note)')).toBe(3);
        expect(await scalarAsync('from * select count(*)')).toBe(6);
    });

    it('aggregates the whole table into a scalar', async () => {
        expect(await scalarAsync('from o in table select sum(o.total)')).toBe(202.5);
        expect(await scalarAsync('from * where city == "Nowhere" select sum(total)')).toBe(0);
        expect(await scalarAsync('from * where city == "Nowhere" select average(total)')).toBeNull();
        expect(await scalarAsync('from * select max(ordered_at)')).toMatchObject({ text: '2025-06-30' });
        expect(await scalarAsync('from * select min(city)')).toBe('Athens');
    });

    it('returns a one-row table for several whole-table aggregates', async () => {
        const result = await tableAsync('from * select Orders = count(), Revenue = sum(total)');

        expect(result.rows).toEqual([['6', '202.5']]);
    });

    it('lists keys and counts when the query ends with group by', async () => {
        const result = await tableAsync('from * group by status');

        expect(result.columns).toEqual(['Key', 'Count']);
        expect(result.rows).toEqual([['delivered', '3'], ['pending', '1'], ['shipped', '1'], ['cancelled', '1']]);
    });

    it('filters and orders groups by aggregates before select', async () => {
        const result = await tableAsync('from * group by product into g where sum(g.total) > 20 orderby sum(g.total) descending select g.Key');

        expect(result.rows).toEqual([['Scissors'], ['Marker'], ['Ruler']]);
    });

    it('feeds lets into aggregates', async () => {
        expect(await scalarAsync('from o in table let double = o.total * 2 select sum(double)')).toBe(405);
    });

    it('allows let after group by', async () => {
        const result = await tableAsync('from * group by city into g let revenue = sum(g.total) where revenue > 50 select g.Key, revenue orderby revenue');

        expect(result.rows).toEqual([['Volos', '75'], ['Athens', '97.5']]);
    });
});

describe('runQueryAsync: errors', () => {
    it('suggests the nearest column name', async () => {
        const error = await errorAsync('from o in table where o.totl > 1');

        expect(error.message).toBe("Unknown column 'totl'. Did you mean 'total'?");
        expect([error.line, error.column]).toEqual([1, 23]);
    });

    it('suggests in the from * form and after select', async () => {
        expect((await errorAsync('from * select cty')).message).toBe("Unknown column 'cty'. Did you mean 'city'?");
        expect((await errorAsync('from * select Revenue = sum(total) orderby revenu')).message).toBe("Unknown column 'revenu'; after select, use the selected names. Did you mean 'Revenue'?");
    });

    it('explains columns outside aggregates after group by', async () => {
        expect((await errorAsync('from * group by city select total')).message).toBe("'total' is not part of the group key. Use it inside an aggregate, like sum(total), or group by it.");
        expect((await errorAsync('from * select city, count()')).message).toBe("'city' needs an aggregate here, because the select also uses aggregates. Wrap it, like min(city), or add group by.");
        expect((await errorAsync('from * group by city into g select g')).message).toBe("The group 'g' works inside an aggregate, like count(g) or sum(g.total), or as g.Key.");
    });

    it('rejects aggregates in the wrong place', async () => {
        expect((await errorAsync('from * where sum(total) > 1')).message).toBe('sum() works in select, or after group by.');
        expect((await errorAsync('from * group by city select sum(count())')).message).toBe('Aggregates cannot be nested inside sum().');
        expect((await errorAsync('from * group by city select sum()')).message).toBe('sum needs a value, like sum(total).');
    });

    it('rejects unknown functions, methods and properties', async () => {
        expect((await errorAsync('from * select summ(total)')).message).toBe("Unknown function 'summ'. Did you mean 'sum'?");
        expect((await errorAsync('from * select city.ToLowr()')).message).toBe("Unknown method 'ToLowr'. Did you mean 'ToLower'?");
        expect((await errorAsync('from * select Math.Roud(total)')).message).toBe("Unknown function 'Math.Roud'. Did you mean 'Round'?");
        expect((await errorAsync('from * select ordered_at.Yer')).message).toBe("Unknown property 'Yer'. Did you mean 'Year'?");
    });

    it('rejects a wrong argument count', async () => {
        expect((await errorAsync('from * select city.Substring()')).message).toBe('Substring takes 1 to 2 arguments, not 0.');
    });

    it('points text tests to like', async () => {
        const text = 'from * where city.Contains("at")';
        const error = await errorAsync(text);

        expect(error.message).toBe(`Unknown function 'Contains'. Use like instead, as in value like "*text*"; it ignores case.`);
        expect(text.slice(error.start, error.end)).toBe('city.Contains');
        expect((await errorAsync('from * where city.startsWith("A")')).message).toContain('value like "text*"');
        expect((await errorAsync('from * where endswith(city, "s")')).message).toBe(`Unknown function 'endswith'. Use like instead, as in value like "*text"; it ignores case.`);
    });

    it('rejects non-boolean conditions and bad arithmetic at run time with a span', async () => {
        const text = 'from * where city';
        const error = await errorAsync(text);

        expect(error.message).toBe("where needs a true or false value, got string 'Patras'.");
        expect(text.slice(error.start, error.end)).toBe('city');
        expect((await errorAsync('from * select city * 2')).message).toBe("'*' needs a number, got string 'Patras'.");
        expect((await errorAsync('from * select sum(city)')).message).toBe("sum needs a number, got string 'Patras'.");
    });

    it('rejects bad skip and take counts', async () => {
        expect((await errorAsync('from * take -1')).message).toBe('take needs a whole number of 0 or more.');
        expect((await errorAsync('from * skip total')).message).toBe('skip needs a plain number, like skip 10.');
    });

    it('rejects a group element other than the range variable', async () => {
        expect((await errorAsync('from o in table group x by o.city')).message).toBe("Write 'group o by …': a group collects whole rows.");
        expect((await errorAsync('from * group x by city')).message).toBe("With 'from *', write 'group by …' without 'x'.");
    });

    it('checks names without reading rows', () => {
        expect(() => compileQuery('from * select totl', COLUMNS)).toThrow("Did you mean 'total'?");
        expect(compileQuery('from * select sum(total)', COLUMNS).scalar).toBe(true);
    });
});

// A synthetic table that counts how many batches were read.
function countingSource(rowCount: number, batchRows: number): { source: LinqTableSource; batchesRead: () => number } {
    let read = 0;

    return {
        batchesRead: () => read,
        source: {
            columns: ['id', 'group', 'value', 'text'],
            batches: async function* (signal) {
                for (let start = 0; start < rowCount; start += batchRows) {
                    if (signal?.aborted === true) {
                        const error = new Error('cancelled');
                        error.name = 'AbortError';
                        throw error;
                    }

                    read += 1;
                    const rows: string[][] = [];

                    for (let row = start; row < Math.min(rowCount, start + batchRows); row += 1) {
                        rows.push([String(row), `g${row % 7}`, String(row % 100), `row number ${row} with some padding text`]);
                    }

                    yield { rows, done: Math.min(rowCount, start + batchRows), total: rowCount };
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
            },
        },
    };
}

describe('runQueryAsync: streaming', () => {
    it('aggregates a large source batch by batch', async () => {
        const { source: large } = countingSource(100_000, 10_000);
        const progress: number[] = [];
        const result = await runQueryAsync('from * group by `group` select `group`, count(), sum(value) orderby `group`', large, {
            onProgress: (update) => {
                if (update.phase === 'scanning') {
                    progress.push(update.done);
                }
            },
        });

        expect(result.kind === 'table' ? result.rows.length : 0).toBe(7);
        expect(result.scannedRows).toBe(100_000);
        expect(progress).toHaveLength(10);
        expect(progress.at(-1)).toBe(100_000);
    });

    it('stops reading once take is satisfied', async () => {
        const counted = countingSource(100_000, 1000);
        const result = await runQueryAsync('from * where value > 50 take 10', counted.source);

        expect(result.kind === 'table' ? result.rows.length : 0).toBe(10);
        expect(counted.batchesRead()).toBe(1);
    });

    it('stops reading for skip then take after select', async () => {
        const counted = countingSource(100_000, 1000);
        const result = await runQueryAsync('from * select id skip 2500 take 20', counted.source);

        expect(result.kind === 'table' ? result.rows[0] : null).toEqual([2500]);
        expect(counted.batchesRead()).toBe(3);
    });

    it('reads everything when an orderby comes before take', async () => {
        const counted = countingSource(20_000, 1000);
        await runQueryAsync('from * orderby value desc take 5', counted.source);

        expect(counted.batchesRead()).toBe(20);
    });

    it('cancels with an AbortSignal', async () => {
        const counted = countingSource(1_000_000, 1000);
        const controller = new AbortController();
        const running = runQueryAsync('from * select sum(value)', counted.source, {
            signal: controller.signal,
            onProgress: (update) => {
                if (update.done >= 3000) {
                    controller.abort();
                }
            },
        });

        await expect(running).rejects.toSatisfy(isAbortError);
        expect(counted.batchesRead()).toBeLessThan(10);
    });

    it('stops with a clear error past the memory cap', async () => {
        const counted = countingSource(50_000, 5000);
        const error = await errorAsync('', () => runQueryAsync('from * orderby text', counted.source, { memoryLimitBytes: 1024 * 1024 }));

        expect(error.message).toBe('The query needs more than 1.0 MB of memory to sort. Narrow it with where, or select fewer columns first.');
        expect(counted.batchesRead()).toBeLessThan(10);
    });

    it('caps the size of the result', async () => {
        const counted = countingSource(50_000, 5000);
        const error = await errorAsync('', () => runQueryAsync('from *', counted.source, { memoryLimitBytes: 1024 * 1024 }));

        expect(error.message).toContain('to hold the result');
    });

    it('scans a CSV file chunk by chunk and stops early for take', async () => {
        const lines = ['id,city,total'];

        for (let row = 0; row < 30_000; row += 1) {
            lines.push(`${row},"City, ${row % 5}",${row % 50}`);
        }

        const blob = new Blob([lines.join('\n')]);
        const index = await buildCsvRowIndexAsync(blob);
        const csv = createCsvTableSource({ columns: ['id', 'city', 'total'], blob, index, delimiter: ',', batchRecords: 5000 });
        const first = await runQueryAsync('from * where total > 10 skip 5 take 10 select id', csv);
        const grouped = await runQueryAsync('from * group by city select city, sum(total) orderby city take 1', csv);

        expect(first.scannedRows).toBe(5000);
        expect(first.kind === 'table' ? first.rows[0] : null).toEqual([16]);
        expect(grouped.scannedRows).toBe(30_000);
        expect(grouped.kind === 'table' ? grouped.rows[0] : null).toEqual(['City, 0', 6000 * 22.5]);
    });

    it('streams aggregates without holding rows', async () => {
        const counted = countingSource(200_000, 20_000);
        const result = await runQueryAsync('from * select count(), sum(value)', counted.source, { memoryLimitBytes: 64 * 1024 });

        expect(result.kind === 'table' ? result.rows[0] : null).toEqual([200_000, 200_000 * 49.5]);
    });
});
