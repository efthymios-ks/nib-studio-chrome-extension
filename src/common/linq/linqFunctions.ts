import { LinqDate, LinqRecord, formatValue, parseDateText, parseNumberText, typeName, type LinqValue } from './linqValues.js';

export type LinqReceiverKind = 'string' | 'date' | 'any';

export interface LinqMethod {
    readonly name: string;
    readonly receiver: LinqReceiverKind;
    readonly minArgs: number;
    readonly maxArgs: number;
    readonly description: string;
    readonly apply: (receiver: LinqValue, args: ReadonlyArray<LinqValue>) => LinqValue;
}

export interface LinqProperty {
    readonly name: string;
    readonly receiver: LinqReceiverKind;
    readonly description: string;
    readonly read: (receiver: LinqValue) => LinqValue;
}

export interface LinqFunction {
    readonly name: string;
    readonly minArgs: number;
    readonly maxArgs: number;
    readonly description: string;
    readonly apply: (args: ReadonlyArray<LinqValue>) => LinqValue;
}

export type LinqAggregateKind = 'count' | 'sum' | 'average' | 'min' | 'max';

export interface LinqAggregate {
    readonly name: string;
    readonly kind: LinqAggregateKind;
    readonly description: string;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Thrown for a value of the wrong type; the evaluator adds the span.
export class LinqTypeError extends Error {}

function text(value: LinqValue, what: string): string {
    if (typeof value === 'string') {
        return value;
    }

    if (value == null) {
        return '';
    }

    if (typeof value === 'number' || typeof value === 'boolean' || value instanceof LinqDate) {
        return formatValue(value);
    }

    throw new LinqTypeError(`${what} needs text, got ${typeName(value)}.`);
}

export function requireNumber(value: LinqValue, what: string): number | null {
    if (value == null) {
        return null;
    }

    if (typeof value === 'number') {
        return value;
    }

    if (typeof value === 'string') {
        const parsed = parseNumberText(value);

        if (parsed != null) {
            return parsed;
        }
    }

    throw new LinqTypeError(`${what} needs a number, got ${typeName(value)} '${formatValue(value)}'.`);
}

function integer(value: LinqValue, what: string): number {
    const number = requireNumber(value, what);

    return number == null ? 0 : Math.trunc(number);
}

function utc(value: LinqValue): Date {
    return new Date((value as LinqDate).time);
}

function roundAwayFromZero(value: number, digits: number): number {
    const factor = 10 ** digits;
    const scaled = Math.abs(value) * factor;
    const rounded = Math.round(Number(scaled.toPrecision(15))) / factor;

    return value < 0 ? -rounded : rounded;
}

// Methods called on a value, like row.city.ToUpper(). Names match without regard to case.
export const LINQ_METHODS: ReadonlyArray<LinqMethod> = [
    {
        name: 'ToLower',
        receiver: 'string',
        minArgs: 0,
        maxArgs: 0,
        description: 'The text in lower case.',
        apply: (receiver) => text(receiver, 'ToLower').toLowerCase(),
    },
    {
        name: 'ToUpper',
        receiver: 'string',
        minArgs: 0,
        maxArgs: 0,
        description: 'The text in upper case.',
        apply: (receiver) => text(receiver, 'ToUpper').toUpperCase(),
    },
    {
        name: 'Trim',
        receiver: 'string',
        minArgs: 0,
        maxArgs: 0,
        description: 'The text without leading and trailing spaces.',
        apply: (receiver) => text(receiver, 'Trim').trim(),
    },
    {
        name: 'Substring',
        receiver: 'string',
        minArgs: 1,
        maxArgs: 2,
        description: 'Part of the text from a 0-based start, optionally of a given length.',
        apply: (receiver, args) => {
            const value = text(receiver, 'Substring');
            const start = Math.max(0, integer(args[0] ?? null, 'Substring'));

            return args.length > 1 ? value.substr(start, Math.max(0, integer(args[1] ?? null, 'Substring'))) : value.slice(start);
        },
    },
    {
        name: 'Replace',
        receiver: 'string',
        minArgs: 2,
        maxArgs: 2,
        description: 'The text with every occurrence of the first value replaced by the second.',
        apply: (receiver, args) => {
            const find = text(args[0] ?? null, 'Replace');

            return find === '' ? text(receiver, 'Replace') : text(receiver, 'Replace').split(find).join(text(args[1] ?? null, 'Replace'));
        },
    },
    {
        name: 'IndexOf',
        receiver: 'string',
        minArgs: 1,
        maxArgs: 1,
        description: 'The 0-based position of the value in the text, or -1.',
        apply: (receiver, args) => text(receiver, 'IndexOf').indexOf(text(args[0] ?? null, 'IndexOf')),
    },
    {
        name: 'ToString',
        receiver: 'any',
        minArgs: 0,
        maxArgs: 0,
        description: 'The value as text.',
        apply: (receiver) => formatValue(receiver),
    },
];

// Properties read from a value, like row.note.Length or row.ordered_at.Year.
export const LINQ_PROPERTIES: ReadonlyArray<LinqProperty> = [
    { name: 'Length', receiver: 'string', description: 'The number of characters in the text.', read: (receiver) => text(receiver, 'Length').length },
    { name: 'Year', receiver: 'date', description: 'The year of a date.', read: (receiver) => utc(receiver).getUTCFullYear() },
    { name: 'Month', receiver: 'date', description: 'The month of a date, 1 to 12.', read: (receiver) => utc(receiver).getUTCMonth() + 1 },
    { name: 'Day', receiver: 'date', description: 'The day of the month, 1 to 31.', read: (receiver) => utc(receiver).getUTCDate() },
    { name: 'Hour', receiver: 'date', description: 'The hour, 0 to 23.', read: (receiver) => utc(receiver).getUTCHours() },
    { name: 'Minute', receiver: 'date', description: 'The minute, 0 to 59.', read: (receiver) => utc(receiver).getUTCMinutes() },
    { name: 'DayOfWeek', receiver: 'date', description: 'The weekday name, like Monday.', read: (receiver) => DAY_NAMES[utc(receiver).getUTCDay()] ?? null },
    {
        name: 'Date',
        receiver: 'date',
        description: 'The date without its time.',
        read: (receiver) => {
            const day = utc(receiver).toISOString().slice(0, 10);

            return new LinqDate(Date.parse(`${day}T00:00:00Z`), day);
        },
    },
];

function mathFunction(name: string, description: string, compute: (values: number[]) => number, minArgs = 1, maxArgs = 1): LinqFunction {
    return {
        name: `Math.${name}`,
        minArgs,
        maxArgs,
        description,
        apply: (args) => {
            const values: number[] = [];

            for (const arg of args) {
                const value = requireNumber(arg, `Math.${name}`);

                if (value == null) {
                    return null;
                }

                values.push(value);
            }

            return compute(values);
        },
    };
}

// Functions called by name. Math functions are written Math.Name(…).
export const LINQ_FUNCTIONS: ReadonlyArray<LinqFunction> = [
    mathFunction('Round', 'Rounds half away from zero, optionally to a number of decimals.', ([value, digits]) => roundAwayFromZero(value as number, Math.trunc(digits ?? 0)), 1, 2),
    mathFunction('Abs', 'The absolute value.', ([value]) => Math.abs(value as number)),
    mathFunction('Floor', 'The largest whole number not above the value.', ([value]) => Math.floor(value as number)),
    mathFunction('Ceiling', 'The smallest whole number not below the value.', ([value]) => Math.ceil(value as number)),
    mathFunction('Min', 'The smaller of two numbers.', ([left, right]) => Math.min(left as number, right as number), 2, 2),
    mathFunction('Max', 'The larger of two numbers.', ([left, right]) => Math.max(left as number, right as number), 2, 2),
    mathFunction('Pow', 'A number raised to a power.', ([base, power]) => (base as number) ** (power as number), 2, 2),
    mathFunction('Sqrt', 'The square root.', ([value]) => Math.sqrt(value as number)),
    {
        name: 'date',
        minArgs: 1,
        maxArgs: 1,
        description: 'Reads ISO text like "2024-05-01" as a date.',
        apply: ([value]) => {
            if (value == null || value instanceof LinqDate) {
                return value ?? null;
            }

            const parsed = parseDateText(text(value, 'date'));

            if (parsed == null) {
                throw new LinqTypeError(`date needs ISO text like "2024-05-01", got '${formatValue(value)}'.`);
            }

            return parsed;
        },
    },
    {
        name: 'number',
        minArgs: 1,
        maxArgs: 1,
        description: 'Reads text as a number, or null when it is not one.',
        apply: ([value]) => (typeof value === 'number' ? value : value == null ? null : parseNumberText(text(value, 'number'))),
    },
];

// Aggregates summarise the rows of each group, or the whole table when there is no group by.
export const LINQ_AGGREGATES: ReadonlyArray<LinqAggregate> = [
    { name: 'count', kind: 'count', description: 'count() counts rows; count(value) counts rows where the value is not empty.' },
    { name: 'sum', kind: 'sum', description: 'The total of the non-empty values, 0 when there are none.' },
    { name: 'average', kind: 'average', description: 'The mean of the non-empty values, empty when there are none.' },
    { name: 'avg', kind: 'average', description: 'Same as average.' },
    { name: 'min', kind: 'min', description: 'The smallest non-empty value: number, date or text.' },
    { name: 'max', kind: 'max', description: 'The largest non-empty value: number, date or text.' },
];

// .NET-style text tests, each with the like pattern that does the same job.
const LIKE_REPLACEMENTS: Readonly<Record<string, string>> = {
    'contains': '"*text*"',
    'startswith': '"text*"',
    'endswith': '"*text"',
};

// A hint that points a .NET-style text test at like, or null for any other name.
export function likeHint(name: string): string | null {
    const pattern = LIKE_REPLACEMENTS[name.toLowerCase()];

    return pattern == null ? null : `Unknown function '${name}'. Use like instead, as in value like ${pattern}; it ignores case.`;
}

export function findMethod(name: string): LinqMethod | undefined {
    const lower = name.toLowerCase();

    return LINQ_METHODS.find((method) => method.name.toLowerCase() === lower);
}

export function findProperty(name: string): LinqProperty | undefined {
    const lower = name.toLowerCase();

    return LINQ_PROPERTIES.find((property) => property.name.toLowerCase() === lower);
}

export function findFunction(name: string): LinqFunction | undefined {
    const lower = name.toLowerCase();

    return LINQ_FUNCTIONS.find((entry) => entry.name.toLowerCase() === lower);
}

export function findAggregate(name: string): LinqAggregate | undefined {
    const lower = name.toLowerCase();

    return LINQ_AGGREGATES.find((entry) => entry.name === lower);
}

export function receiverMatches(kind: LinqReceiverKind, value: LinqValue): boolean {
    if (kind === 'any') {
        return true;
    }

    if (kind === 'date') {
        return value instanceof LinqDate;
    }

    return !(value instanceof LinqRecord);
}
