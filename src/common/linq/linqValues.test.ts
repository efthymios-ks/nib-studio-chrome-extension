import { describe, expect, it } from 'vitest';
import {
    LinqDate,
    LinqRecord,
    compareValues,
    convertCell,
    estimateValueBytes,
    formatValue,
    inferColumnTypes,
    matchesLike,
    parseDateText,
    parseNumberText,
    typeName,
    valueKey,
    valuesEqual,
} from './linqValues.js';

function date(text: string): LinqDate {
    const parsed = parseDateText(text);

    if (parsed == null) {
        throw new Error(`${text} is not a date.`);
    }

    return parsed;
}

describe('linqValues', () => {
    describe('LinqDate', () => {
        it('prints its original text', () => {
            expect(String(new LinqDate(0, '1970-01-01'))).toBe('1970-01-01');
        });
    });

    describe('LinqRecord', () => {
        const record = new LinqRecord(['City', 'total'], ['Oslo', 12.5]);

        it('finds a field by exact name', () => {
            expect(record.indexOf('total')).toBe(1);
        });

        it('finds a field ignoring case', () => {
            expect(record.indexOf('city')).toBe(0);
            expect(record.indexOf('TOTAL')).toBe(1);
        });

        it('prefers an exact match over a case-insensitive one', () => {
            const mixed = new LinqRecord(['name', 'Name'], ['a', 'b']);

            expect(mixed.indexOf('Name')).toBe(1);
        });

        it('returns -1 for a missing field', () => {
            expect(record.indexOf('country')).toBe(-1);
        });

        it('prints as an anonymous object', () => {
            expect(record.toString()).toBe('{ City = Oslo, total = 12.5 }');
            expect(new LinqRecord(['a'], [null]).toString()).toBe('{ a =  }');
        });
    });

    describe('parseNumberText', () => {
        it.each([
            ['42', 42],
            [' -3.5 ', -3.5],
            ['+7', 7],
            ['.5', 0.5],
            ['5.', 5],
            ['1e3', 1000],
            ['2.5E-1', 0.25],
        ])('reads %j as %d', (text, expected) => {
            expect(parseNumberText(text)).toBe(expected);
        });

        it.each(['', ' ', 'abc', '1,000', '0x10', 'Infinity', 'NaN', '1e', '--1', '1 2'])('rejects %j', (text) => {
            expect(parseNumberText(text)).toBeNull();
        });
    });

    describe('parseDateText', () => {
        it('reads a calendar date as midnight UTC', () => {
            const parsed = date('2024-05-01');

            expect(parsed.time).toBe(Date.UTC(2024, 4, 1));
            expect(parsed.text).toBe('2024-05-01');
        });

        it('reads a timestamp with a T or space separator', () => {
            expect(date('2024-05-01T13:45').time).toBe(Date.UTC(2024, 4, 1, 13, 45));
            expect(date('2024-05-01 13:45:30').time).toBe(Date.UTC(2024, 4, 1, 13, 45, 30));
        });

        it('keeps milliseconds from a fraction of any length', () => {
            expect(date('2024-05-01T00:00:00.5Z').time).toBe(Date.UTC(2024, 4, 1, 0, 0, 0, 500));
            expect(date('2024-05-01T00:00:00.123456789Z').time).toBe(Date.UTC(2024, 4, 1, 0, 0, 0, 123));
        });

        it('applies a zone offset with or without a colon', () => {
            expect(date('2024-05-01T10:00:00+02:00').time).toBe(Date.UTC(2024, 4, 1, 8));
            expect(date('2024-05-01T10:00:00-0530').time).toBe(Date.UTC(2024, 4, 1, 15, 30));
            expect(date('2024-05-01T10:00:00Z').time).toBe(Date.UTC(2024, 4, 1, 10));
        });

        it('trims surrounding spaces', () => {
            expect(date('  2024-05-01 ').text).toBe('2024-05-01');
        });

        it('accepts a leap day', () => {
            expect(date('2024-02-29').time).toBe(Date.UTC(2024, 1, 29));
        });

        it.each(['2023-02-29', '2024-13-01', '2024-04-31', '2024-00-10'])('rejects the impossible date %s', (text) => {
            expect(parseDateText(text)).toBeNull();
        });

        it.each(['', '2024/05/01', '01-05-2024', '2024-5-1', 'yesterday', '2024-05-01T1:00'])('rejects the non-ISO text %j', (text) => {
            expect(parseDateText(text)).toBeNull();
        });
    });

    describe('inferColumnTypes', () => {
        it('picks number, date, boolean or string per column', () => {
            const rows = [
                ['1', '2024-01-01', 'true', 'Oslo'],
                ['2.5', '2024-02-01T10:00', 'FALSE', '7'],
            ];

            expect(inferColumnTypes(4, rows)).toEqual(['number', 'date', 'boolean', 'string']);
        });

        it('ignores empty cells', () => {
            expect(inferColumnTypes(1, [[''], [null], ['3'], [undefined]])).toEqual(['number']);
        });

        it('falls back to string for a column with no values', () => {
            expect(inferColumnTypes(2, [['', null]])).toEqual(['string', 'string']);
            expect(inferColumnTypes(1, [])).toEqual(['string']);
        });

        it('uses native cell types from spreadsheets', () => {
            const rows = [[1, true, new Date(Date.UTC(2024, 0, 1))]];

            expect(inferColumnTypes(3, rows)).toEqual(['number', 'boolean', 'date']);
        });

        it('treats a column mixing numbers and text as string', () => {
            expect(inferColumnTypes(1, [[1], ['abc']])).toEqual(['string']);
        });

        it('treats a missing cell in a short row as empty', () => {
            expect(inferColumnTypes(2, [['1'], ['2', 'x']])).toEqual(['number', 'string']);
        });
    });

    describe('convertCell', () => {
        it('turns empty cells into null', () => {
            expect(convertCell('', 'string')).toBeNull();
            expect(convertCell(null, 'number')).toBeNull();
            expect(convertCell(undefined, 'date')).toBeNull();
        });

        it('keeps native numbers and booleans', () => {
            expect(convertCell(3, 'string')).toBe(3);
            expect(convertCell(false, 'number')).toBe(false);
        });

        it('turns a native Date into a LinqDate', () => {
            const converted = convertCell(new Date(Date.UTC(2024, 0, 2)), 'date');

            expect(converted).toBeInstanceOf(LinqDate);
            expect((converted as LinqDate).time).toBe(Date.UTC(2024, 0, 2));
            expect((converted as LinqDate).text).toBe('2024-01-02T00:00:00.000Z');
        });

        it('parses text according to the column type', () => {
            expect(convertCell(' 12 ', 'number')).toBe(12);
            expect(convertCell('2024-01-02', 'date')).toEqual(date('2024-01-02'));
            expect(convertCell('True', 'boolean')).toBe(true);
            expect(convertCell(' false ', 'boolean')).toBe(false);
            expect(convertCell('12', 'string')).toBe('12');
        });

        it('keeps text that does not fit its column type', () => {
            expect(convertCell('n/a', 'number')).toBe('n/a');
            expect(convertCell('soon', 'date')).toBe('soon');
            expect(convertCell('yes', 'boolean')).toBe('yes');
        });
    });

    describe('typeName', () => {
        it('names every kind of value', () => {
            expect(typeName(null)).toBe('null');
            expect(typeName(1)).toBe('number');
            expect(typeName('a')).toBe('string');
            expect(typeName(true)).toBe('boolean');
            expect(typeName(date('2024-01-01'))).toBe('date');
            expect(typeName(new LinqRecord([], []))).toBe('object');
        });
    });

    describe('compareValues', () => {
        it('orders numbers numerically', () => {
            expect(compareValues(2, 10)).toBeLessThan(0);
            expect(compareValues(10, 2)).toBeGreaterThan(0);
            expect(compareValues(5, 5)).toBe(0);
        });

        it('sorts nulls last', () => {
            expect(compareValues(null, 1)).toBeGreaterThan(0);
            expect(compareValues(1, null)).toBeLessThan(0);
            expect(compareValues(null, null)).toBe(0);
        });

        it('orders dates chronologically', () => {
            expect(compareValues(date('2024-01-02'), date('2023-12-31'))).toBeGreaterThan(0);
        });

        it('orders booleans false before true', () => {
            expect(compareValues(false, true)).toBeLessThan(0);
        });

        it('compares a number with numeric text by value', () => {
            expect(compareValues(10, '9')).toBeGreaterThan(0);
            expect(compareValues('10', 9)).toBeGreaterThan(0);
        });

        it('compares a date with ISO text by time', () => {
            expect(compareValues(date('2024-05-01'), '2024-04-30')).toBeGreaterThan(0);
            expect(compareValues('2024-04-30', date('2024-05-01'))).toBeLessThan(0);
        });

        it('compares a date with non-date text as text', () => {
            expect(compareValues(date('2024-05-01'), 'zzz')).toBeLessThan(0);
        });

        it('orders text by locale', () => {
            expect(compareValues('apple', 'Banana')).toBeLessThan(0);
            expect(compareValues('b', 'a')).toBeGreaterThan(0);
        });
    });

    describe('valuesEqual', () => {
        it('treats only null as equal to null', () => {
            expect(valuesEqual(null, null)).toBe(true);
            expect(valuesEqual(null, '')).toBe(false);
            expect(valuesEqual(0, null)).toBe(false);
        });

        it('compares numbers with numeric text by value', () => {
            expect(valuesEqual(5, '5.0')).toBe(true);
            expect(valuesEqual('5', 6)).toBe(false);
        });

        it('compares text exactly', () => {
            expect(valuesEqual('Oslo', 'Oslo')).toBe(true);
            expect(valuesEqual('Oslo', 'oslo')).toBe(false);
        });

        it('compares dates by time, including against ISO text', () => {
            expect(valuesEqual(date('2024-05-01T02:00+02:00'), date('2024-05-01T00:00Z'))).toBe(true);
            expect(valuesEqual(date('2024-05-01'), '2024-05-01T00:00:00Z')).toBe(true);
            expect(valuesEqual('2024-05-02', date('2024-05-01'))).toBe(false);
        });

        it('compares records field by field', () => {
            expect(valuesEqual(new LinqRecord(['a'], [1]), new LinqRecord(['b'], [1]))).toBe(true);
            expect(valuesEqual(new LinqRecord(['a'], [1]), new LinqRecord(['a'], [2]))).toBe(false);
            expect(valuesEqual(new LinqRecord(['a'], [1]), 1)).toBe(false);
        });

        it('treats booleans as equal only to the same boolean', () => {
            expect(valuesEqual(true, true)).toBe(true);
            expect(valuesEqual(true, 'true')).toBe(false);
        });
    });

    describe('matchesLike', () => {
        it('matches the whole text ignoring case', () => {
            expect(matchesLike('Oslo', 'oslo')).toBe(true);
            expect(matchesLike('Oslo', 'osl')).toBe(false);
        });

        it('treats * as any run of characters', () => {
            expect(matchesLike('Copenhagen', 'cop*')).toBe(true);
            expect(matchesLike('Copenhagen', '*hagen')).toBe(true);
            expect(matchesLike('Copenhagen', '*pen*')).toBe(true);
            expect(matchesLike('Copenhagen', 'c*h*n')).toBe(true);
            expect(matchesLike('Copenhagen', '*xyz*')).toBe(false);
        });

        it('lets * match nothing', () => {
            expect(matchesLike('abc', 'a*bc')).toBe(true);
            expect(matchesLike('', '*')).toBe(true);
            expect(matchesLike('', '**')).toBe(true);
        });

        it('handles empty text and pattern', () => {
            expect(matchesLike('', '')).toBe(true);
            expect(matchesLike('a', '')).toBe(false);
            expect(matchesLike('', 'a')).toBe(false);
        });

        it('backtracks to the last star', () => {
            expect(matchesLike('aaab', '*ab')).toBe(true);
            expect(matchesLike('abcabd', '*abd')).toBe(true);
        });

        it('treats other wildcard characters literally', () => {
            expect(matchesLike('a.c', 'a.c')).toBe(true);
            expect(matchesLike('abc', 'a.c')).toBe(false);
            expect(matchesLike('a?c', 'a?c')).toBe(true);
            expect(matchesLike('abc', 'a%')).toBe(false);
        });

        it('handles characters outside the basic plane', () => {
            expect(matchesLike('😀x', '*x')).toBe(true);
            expect(matchesLike('a😀b', 'a😀b')).toBe(true);
        });

        it('stays fast on a pattern that would blow up a regex', () => {
            const text = 'a'.repeat(5000);
            const started = Date.now();

            expect(matchesLike(text, `${'*a'.repeat(20)}b`)).toBe(false);
            expect(Date.now() - started).toBeLessThan(2000);
        });
    });

    describe('valueKey', () => {
        it('gives each type its own prefix', () => {
            expect(valueKey(null)).toBe('n');
            expect(valueKey(5)).toBe('d5');
            expect(valueKey(true)).toBe('b1');
            expect(valueKey(false)).toBe('b0');
            expect(valueKey('5')).toBe('s5');
            expect(valueKey(date('2024-01-01'))).toBe(`t${Date.UTC(2024, 0, 1)}`);
        });

        it('keeps a number and the same text apart', () => {
            expect(valueKey(1)).not.toBe(valueKey('1'));
        });

        it('keys records by their values, escaping separators', () => {
            expect(valueKey(new LinqRecord(['a', 'b'], [1, 'x']))).toBe('rd1|sx');
            expect(valueKey(new LinqRecord(['a', 'b'], ['x|y', 'z']))).not.toBe(valueKey(new LinqRecord(['a', 'b'], ['x', 'y|z'])));
            expect(valueKey(new LinqRecord(['a'], ['a\\']))).toBe('rsa\\\\');
        });
    });

    describe('formatValue', () => {
        it('prints null as empty text', () => {
            expect(formatValue(null)).toBe('');
        });

        it('prints integers as they are', () => {
            expect(formatValue(42)).toBe('42');
            expect(formatValue(-7)).toBe('-7');
        });

        it('hides floating-point noise', () => {
            expect(formatValue(0.1 + 0.2)).toBe('0.3');
            expect(formatValue(1.5)).toBe('1.5');
        });

        it('prints other values as text', () => {
            expect(formatValue('Oslo')).toBe('Oslo');
            expect(formatValue(true)).toBe('true');
            expect(formatValue(date('2024-01-01'))).toBe('2024-01-01');
        });
    });

    describe('estimateValueBytes', () => {
        it('estimates text by length', () => {
            expect(estimateValueBytes('')).toBe(32);
            expect(estimateValueBytes('abcd')).toBe(40);
        });

        it('estimates dates by their text', () => {
            expect(estimateValueBytes(date('2024-01-01'))).toBe(48 + 20);
        });

        it('sums the values of a record', () => {
            expect(estimateValueBytes(new LinqRecord(['a', 'b'], [1, 'ab']))).toBe(48 + 16 + 36);
        });

        it('uses a flat size for anything else', () => {
            expect(estimateValueBytes(1)).toBe(16);
            expect(estimateValueBytes(null)).toBe(16);
            expect(estimateValueBytes(true)).toBe(16);
        });
    });
});
