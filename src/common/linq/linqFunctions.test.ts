import { describe, expect, it } from 'vitest';
import {
    LINQ_AGGREGATES,
    LINQ_FUNCTIONS,
    LINQ_METHODS,
    LINQ_PROPERTIES,
    LinqTypeError,
    findAggregate,
    findFunction,
    findMethod,
    findProperty,
    likeHint,
    receiverMatches,
    requireNumber,
    type LinqFunction,
    type LinqMethod,
    type LinqProperty,
} from './linqFunctions.js';
import { LinqDate, LinqRecord, parseDateText, type LinqValue } from './linqValues.js';

function method(name: string): LinqMethod {
    const found = findMethod(name);

    if (found == null) {
        throw new Error(`No method ${name}.`);
    }

    return found;
}

function property(name: string): LinqProperty {
    const found = findProperty(name);

    if (found == null) {
        throw new Error(`No property ${name}.`);
    }

    return found;
}

function fn(name: string): LinqFunction {
    const found = findFunction(name);

    if (found == null) {
        throw new Error(`No function ${name}.`);
    }

    return found;
}

function call(name: string, receiver: LinqValue, ...args: LinqValue[]): LinqValue {
    return method(name).apply(receiver, args);
}

function apply(name: string, ...args: LinqValue[]): LinqValue {
    return fn(name).apply(args);
}

function date(text: string): LinqDate {
    return parseDateText(text) as LinqDate;
}

describe('linqFunctions', () => {
    describe('requireNumber', () => {
        it('passes numbers through and null as null', () => {
            expect(requireNumber(4.5, 'Test')).toBe(4.5);
            expect(requireNumber(null, 'Test')).toBeNull();
        });

        it('reads numeric text', () => {
            expect(requireNumber(' 12 ', 'Test')).toBe(12);
        });

        it('throws a type error for anything else', () => {
            expect(() => requireNumber('abc', 'Math.Abs')).toThrow(new LinqTypeError("Math.Abs needs a number, got string 'abc'."));
            expect(() => requireNumber(true, 'Math.Abs')).toThrow(LinqTypeError);
            expect(() => requireNumber(date('2024-01-01'), 'Math.Abs')).toThrow("got date '2024-01-01'");
        });
    });

    describe('methods', () => {
        it('changes case', () => {
            expect(call('ToLower', 'OsLo')).toBe('oslo');
            expect(call('ToUpper', 'OsLo')).toBe('OSLO');
        });

        it('trims spaces', () => {
            expect(call('Trim', '  Oslo \t')).toBe('Oslo');
        });

        it('treats null as empty text and formats numbers', () => {
            expect(call('ToUpper', null)).toBe('');
            expect(call('Trim', 1.5)).toBe('1.5');
            expect(call('ToLower', true)).toBe('true');
        });

        it('rejects a record receiver', () => {
            expect(() => call('ToLower', new LinqRecord(['a'], [1]))).toThrow('ToLower needs text, got object.');
        });

        it('takes a substring from a start', () => {
            expect(call('Substring', 'Copenhagen', 4)).toBe('nhagen');
            expect(call('Substring', 'Copenhagen', 0, 4)).toBe('Cope');
        });

        it('clamps a negative start or length', () => {
            expect(call('Substring', 'Oslo', -3)).toBe('Oslo');
            expect(call('Substring', 'Oslo', 1, -2)).toBe('');
        });

        it('truncates fractional and reads numeric-text substring arguments', () => {
            expect(call('Substring', 'Oslo', 1.9, '2')).toBe('sl');
        });

        it('rejects non-numeric substring arguments', () => {
            expect(() => call('Substring', 'Oslo', 'x')).toThrow(LinqTypeError);
        });

        it('replaces every occurrence', () => {
            expect(call('Replace', 'a-b-c', '-', '+')).toBe('a+b+c');
            expect(call('Replace', 'a-b', '-', null)).toBe('ab');
        });

        it('leaves the text alone when replacing empty text', () => {
            expect(call('Replace', 'abc', '', 'x')).toBe('abc');
        });

        it('finds the position of text', () => {
            expect(call('IndexOf', 'Copenhagen', 'hag')).toBe(5);
            expect(call('IndexOf', 'Copenhagen', 'xyz')).toBe(-1);
        });

        it('formats any value as text', () => {
            expect(call('ToString', 0.1 + 0.2)).toBe('0.3');
            expect(call('ToString', null)).toBe('');
            expect(call('ToString', new LinqRecord(['a'], [1]))).toBe('{ a = 1 }');
        });
    });

    describe('properties', () => {
        const timestamp = date('2024-05-04T13:45:00Z');

        it('reads text length', () => {
            expect(property('Length').read('Oslo')).toBe(4);
            expect(property('Length').read(null)).toBe(0);
        });

        it('reads date parts in UTC', () => {
            expect(property('Year').read(timestamp)).toBe(2024);
            expect(property('Month').read(timestamp)).toBe(5);
            expect(property('Day').read(timestamp)).toBe(4);
            expect(property('Hour').read(timestamp)).toBe(13);
            expect(property('Minute').read(timestamp)).toBe(45);
            expect(property('DayOfWeek').read(timestamp)).toBe('Saturday');
        });

        it('reads the date without its time', () => {
            const day = property('Date').read(timestamp) as LinqDate;

            expect(day).toBeInstanceOf(LinqDate);
            expect(day.text).toBe('2024-05-04');
            expect(day.time).toBe(Date.UTC(2024, 4, 4));
        });

        it('reads parts of an offset timestamp in UTC', () => {
            expect(property('Day').read(date('2024-05-01T01:00:00+02:00'))).toBe(30);
        });
    });

    describe('math functions', () => {
        it('rounds half away from zero', () => {
            expect(apply('Math.Round', 2.5)).toBe(3);
            expect(apply('Math.Round', -2.5)).toBe(-3);
            expect(apply('Math.Round', 2.4)).toBe(2);
        });

        it('rounds to a number of decimals without floating-point surprises', () => {
            expect(apply('Math.Round', 1.005, 2)).toBe(1.01);
            expect(apply('Math.Round', -1.235, 2)).toBe(-1.24);
            expect(apply('Math.Round', 1234.5, -2)).toBe(1200);
        });

        it('computes the other functions', () => {
            expect(apply('Math.Abs', -4)).toBe(4);
            expect(apply('Math.Floor', -1.5)).toBe(-2);
            expect(apply('Math.Ceiling', 1.1)).toBe(2);
            expect(apply('Math.Min', 3, 7)).toBe(3);
            expect(apply('Math.Max', 3, 7)).toBe(7);
            expect(apply('Math.Pow', 2, 10)).toBe(1024);
            expect(apply('Math.Sqrt', 81)).toBe(9);
        });

        it('returns null when any argument is null', () => {
            expect(apply('Math.Abs', null)).toBeNull();
            expect(apply('Math.Max', 1, null)).toBeNull();
        });

        it('reads numeric text arguments', () => {
            expect(apply('Math.Abs', '-3')).toBe(3);
        });

        it('throws a type error naming the function', () => {
            expect(() => apply('Math.Sqrt', 'nine')).toThrow("Math.Sqrt needs a number, got string 'nine'.");
        });

        it('declares the argument counts', () => {
            expect(fn('Math.Round')).toMatchObject({ minArgs: 1, maxArgs: 2 });
            expect(fn('Math.Pow')).toMatchObject({ minArgs: 2, maxArgs: 2 });
            expect(fn('Math.Abs')).toMatchObject({ minArgs: 1, maxArgs: 1 });
        });
    });

    describe('conversion functions', () => {
        it('reads ISO text as a date', () => {
            expect(apply('date', '2024-05-01')).toEqual(date('2024-05-01'));
        });

        it('passes a date or null through', () => {
            const value = date('2024-05-01');

            expect(apply('date', value)).toBe(value);
            expect(apply('date', null)).toBeNull();
        });

        it('throws for text that is not an ISO date', () => {
            expect(() => apply('date', '05/01/2024')).toThrow(`date needs ISO text like "2024-05-01", got '05/01/2024'.`);
        });

        it('reads text as a number, or null', () => {
            expect(apply('number', '42')).toBe(42);
            expect(apply('number', 7)).toBe(7);
            expect(apply('number', 'n/a')).toBeNull();
            expect(apply('number', null)).toBeNull();
        });
    });

    describe('lookups', () => {
        it('finds methods, properties and functions ignoring case', () => {
            expect(findMethod('toupper')?.name).toBe('ToUpper');
            expect(findProperty('LENGTH')?.name).toBe('Length');
            expect(findFunction('math.round')?.name).toBe('Math.Round');
        });

        it('returns undefined for unknown names', () => {
            expect(findMethod('Split')).toBeUndefined();
            expect(findProperty('Second')).toBeUndefined();
            expect(findFunction('Math.Log')).toBeUndefined();
            expect(findAggregate('median')).toBeUndefined();
        });

        it('finds aggregates by lower-case name, with avg as an alias', () => {
            expect(findAggregate('count')?.kind).toBe('count');
            expect(findAggregate('AVG')?.kind).toBe('average');
            expect(findAggregate('Average')?.kind).toBe('average');
        });

        it('keeps names unique within each table', () => {
            for (const table of [LINQ_METHODS, LINQ_PROPERTIES, LINQ_FUNCTIONS, LINQ_AGGREGATES]) {
                const names = table.map((entry) => entry.name.toLowerCase());

                expect(new Set(names).size).toBe(names.length);
            }
        });

        it('describes every entry', () => {
            for (const entry of [...LINQ_METHODS, ...LINQ_PROPERTIES, ...LINQ_FUNCTIONS, ...LINQ_AGGREGATES]) {
                expect(entry.description.length).toBeGreaterThan(0);
            }
        });
    });

    describe('likeHint', () => {
        it('points .NET text tests at like', () => {
            expect(likeHint('Contains')).toBe(`Unknown function 'Contains'. Use like instead, as in value like "*text*"; it ignores case.`);
            expect(likeHint('startsWith')).toContain('"text*"');
            expect(likeHint('ENDSWITH')).toContain('"*text"');
        });

        it('returns null for other names', () => {
            expect(likeHint('Split')).toBeNull();
            expect(likeHint('toString')).toBeNull();
        });
    });

    describe('receiverMatches', () => {
        it('accepts anything for any', () => {
            expect(receiverMatches('any', new LinqRecord([], []))).toBe(true);
            expect(receiverMatches('any', null)).toBe(true);
        });

        it('accepts only dates for date', () => {
            expect(receiverMatches('date', date('2024-01-01'))).toBe(true);
            expect(receiverMatches('date', '2024-01-01')).toBe(false);
            expect(receiverMatches('date', null)).toBe(false);
        });

        it('accepts anything but a record for string', () => {
            expect(receiverMatches('string', 'a')).toBe(true);
            expect(receiverMatches('string', 1)).toBe(true);
            expect(receiverMatches('string', null)).toBe(true);
            expect(receiverMatches('string', new LinqRecord([], []))).toBe(false);
        });
    });
});
