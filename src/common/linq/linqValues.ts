// A calendar date or timestamp read from a cell. Dates without a zone are taken as UTC so
// Year, Month and Day read back exactly what the cell says.
export class LinqDate {
    constructor(readonly time: number, readonly text: string) {}

    toString(): string {
        return this.text;
    }
}

// A row, an anonymous object or a composite group key: named values in order.
export class LinqRecord {
    constructor(readonly names: ReadonlyArray<string>, readonly values: ReadonlyArray<LinqValue>) {}

    indexOf(name: string): number {
        const exact = this.names.indexOf(name);

        if (exact >= 0) {
            return exact;
        }

        const lower = name.toLowerCase();

        return this.names.findIndex((candidate) => candidate.toLowerCase() === lower);
    }

    toString(): string {
        return `{ ${this.names.map((name, index) => `${name} = ${formatValue(this.values[index] ?? null)}`).join(', ')} }`;
    }
}

export type LinqValue = null | number | string | boolean | LinqDate | LinqRecord;

export type LinqColumnType = 'number' | 'date' | 'boolean' | 'string';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const NUMBER_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function parseNumberText(text: string): number | null {
    const trimmed = text.trim();

    return NUMBER_TEXT.test(trimmed) ? Number(trimmed) : null;
}

export function parseDateText(text: string): LinqDate | null {
    const trimmed = text.trim();
    const match = ISO_DATE.exec(trimmed);

    if (match == null) {
        return null;
    }

    const [, year, month, day, hour, minute, second, fraction, zone] = match;
    const milliseconds = fraction == null ? 0 : Math.floor(Number(`0.${fraction}`) * 1000);
    let time = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour ?? 0), Number(minute ?? 0), Number(second ?? 0), milliseconds);

    if (zone != null && zone !== 'Z') {
        const sign = zone.startsWith('-') ? -1 : 1;
        const digits = zone.slice(1).replace(':', '');
        time -= sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))) * 60_000;
    }

    const check = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

    if (check.getUTCMonth() !== Number(month) - 1 || check.getUTCDate() !== Number(day)) {
        return null;
    }

    return new LinqDate(time, trimmed);
}

// Picks one type per column from sample cells: number, ISO date or boolean when every
// non-empty cell fits, text otherwise.
export function inferColumnTypes(columnCount: number, rows: ReadonlyArray<ReadonlyArray<unknown>>): LinqColumnType[] {
    const types: LinqColumnType[] = [];

    for (let column = 0; column < columnCount; column += 1) {
        let number = true;
        let date = true;
        let boolean = true;
        let seen = 0;

        for (const row of rows) {
            const cell = row[column];

            if (cell == null || cell === '') {
                continue;
            }

            seen += 1;

            if (typeof cell === 'number') {
                date = false;
                boolean = false;
                continue;
            }

            if (typeof cell === 'boolean') {
                number = false;
                date = false;
                continue;
            }

            if (cell instanceof Date) {
                number = false;
                boolean = false;
                continue;
            }

            const text = String(cell);
            number &&= parseNumberText(text) != null;
            date &&= parseDateText(text) != null;
            boolean &&= /^(true|false)$/i.test(text.trim());

            if (!number && !date && !boolean) {
                break;
            }
        }

        types.push(seen === 0 ? 'string' : number ? 'number' : date ? 'date' : boolean ? 'boolean' : 'string');
    }

    return types;
}

// Turns a raw cell into a typed value; a cell that doesn't fit its column type stays text.
export function convertCell(cell: unknown, type: LinqColumnType): LinqValue {
    if (cell == null || cell === '') {
        return null;
    }

    if (typeof cell === 'number' || typeof cell === 'boolean') {
        return cell;
    }

    if (cell instanceof Date) {
        return new LinqDate(cell.getTime(), cell.toISOString());
    }

    const text = String(cell);

    if (type === 'number') {
        return parseNumberText(text) ?? text;
    }

    if (type === 'date') {
        return parseDateText(text) ?? text;
    }

    if (type === 'boolean') {
        const lower = text.trim().toLowerCase();

        return lower === 'true' ? true : lower === 'false' ? false : text;
    }

    return text;
}

export function typeName(value: LinqValue): string {
    if (value == null) {
        return 'null';
    }

    if (value instanceof LinqDate) {
        return 'date';
    }

    if (value instanceof LinqRecord) {
        return 'object';
    }

    return typeof value;
}

const collator = new Intl.Collator();

// Orders two non-null values: numbers numerically, dates chronologically, text by locale.
// A number or date against text that parses as one compares by value.
export function compareValues(left: LinqValue, right: LinqValue): number {
    if (left == null || right == null) {
        return left == null ? (right == null ? 0 : 1) : -1;
    }

    const pair = coercePair(left, right);

    if (typeof pair[0] === 'number' && typeof pair[1] === 'number') {
        return pair[0] - pair[1];
    }

    if (typeof pair[0] === 'boolean' && typeof pair[1] === 'boolean') {
        return Number(pair[0]) - Number(pair[1]);
    }

    return collator.compare(formatValue(pair[0]), formatValue(pair[1]));
}

export function valuesEqual(left: LinqValue, right: LinqValue): boolean {
    if (left == null || right == null) {
        return left == null && right == null;
    }

    if (left instanceof LinqRecord || right instanceof LinqRecord) {
        return valueKey(left) === valueKey(right);
    }

    const pair = coercePair(left, right);

    if (typeof pair[0] === 'string' && typeof pair[1] === 'string') {
        return pair[0] === pair[1];
    }

    return pair[0] === pair[1];
}

// Brings a mixed pair onto one footing: dates become times, and text next to a number or
// date is read as one when it parses.
function coercePair(left: LinqValue, right: LinqValue): [LinqValue, LinqValue] {
    let coercedLeft: LinqValue = left;
    let coercedRight: LinqValue = right;

    if (coercedLeft instanceof LinqDate && typeof coercedRight === 'string') {
        coercedRight = parseDateText(coercedRight)?.time ?? coercedRight;
        coercedLeft = typeof coercedRight === 'number' ? coercedLeft.time : coercedLeft.text;
    }
    else if (coercedRight instanceof LinqDate && typeof coercedLeft === 'string') {
        coercedLeft = parseDateText(coercedLeft)?.time ?? coercedLeft;
        coercedRight = typeof coercedLeft === 'number' ? coercedRight.time : coercedRight.text;
    }

    if (coercedLeft instanceof LinqDate) {
        coercedLeft = coercedLeft.time;
    }

    if (coercedRight instanceof LinqDate) {
        coercedRight = coercedRight.time;
    }

    if (typeof coercedLeft === 'number' && typeof coercedRight === 'string') {
        coercedRight = parseNumberText(coercedRight) ?? coercedRight;
    }
    else if (typeof coercedRight === 'number' && typeof coercedLeft === 'string') {
        coercedLeft = parseNumberText(coercedLeft) ?? coercedLeft;
    }

    return [coercedLeft, coercedRight];
}

// Whole-text match where each * in the pattern stands for any run of characters, including none;
// everything else matches itself, ignoring case. Greedy with backtracking to the last *, so the
// work is at most text length times pattern length, whatever the pattern.
export function matchesLike(text: string, pattern: string): boolean {
    const value = Array.from(text.toLowerCase());
    const wanted = Array.from(pattern.toLowerCase());
    let position = 0;
    let index = 0;
    let star = -1;
    let resume = 0;

    while (position < value.length) {
        if (index < wanted.length && wanted[index] === '*') {
            star = index;
            index += 1;
            resume = position;
        }
        else if (index < wanted.length && wanted[index] === value[position]) {
            index += 1;
            position += 1;
        }
        else if (star >= 0) {
            index = star + 1;
            resume += 1;
            position = resume;
        }
        else {
            return false;
        }
    }

    while (index < wanted.length && wanted[index] === '*') {
        index += 1;
    }

    return index === wanted.length;
}

// A string that is equal for equal values, used for grouping and distinct.
export function valueKey(value: LinqValue): string {
    if (value == null) {
        return 'n';
    }

    if (typeof value === 'number') {
        return `d${value}`;
    }

    if (typeof value === 'boolean') {
        return value ? 'b1' : 'b0';
    }

    if (value instanceof LinqDate) {
        return `t${value.time}`;
    }

    if (value instanceof LinqRecord) {
        return `r${value.values.map((item) => valueKey(item).replace(/[\\|]/g, '\\$&')).join('|')}`;
    }

    return `s${value}`;
}

// Display text: numbers rounded to 12 significant digits to hide floating-point noise.
export function formatValue(value: LinqValue): string {
    if (value == null) {
        return '';
    }

    if (typeof value === 'number') {
        return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)));
    }

    return String(value);
}

// Rough memory a value holds, for the materialisation cap.
export function estimateValueBytes(value: unknown): number {
    if (typeof value === 'string') {
        return 32 + value.length * 2;
    }

    if (value instanceof LinqRecord) {
        return 48 + value.values.reduce<number>((sum, item) => sum + estimateValueBytes(item), 0);
    }

    if (value instanceof LinqDate) {
        return 48 + value.text.length * 2;
    }

    return 16;
}
