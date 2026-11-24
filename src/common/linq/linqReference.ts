import { LINQ_AGGREGATES, LINQ_FUNCTIONS, LINQ_METHODS, LINQ_PROPERTIES } from './linqFunctions.js';
import { LINQ_KEYWORDS } from './linqParser.js';
import { inferColumnTypes, type LinqColumnType } from './linqValues.js';

const RESERVED = new Set(LINQ_KEYWORDS);

export interface LinqReferenceEntry {
    // How it is written, like `where condition`.
    readonly syntax: string;
    readonly description: string;
    // A whole query using it, against the orders sample columns.
    readonly example: string;
}

export interface LinqReferenceSection {
    readonly title: string;
    readonly intro?: string;
    readonly entries: ReadonlyArray<LinqReferenceEntry>;
}

// Example usage per function and method, keyed by lower-case name.
const CALL_EXAMPLES: Readonly<Record<string, string>> = {
    'tolower': 'from * select customer.ToLower()',
    'toupper': 'from * select city.ToUpper()',
    'trim': 'from * select note.Trim()',
    'substring': 'from * select order_id.Substring(4, 3)',
    'replace': 'from * select product.Replace(" ", "_")',
    'indexof': 'from * select customer.IndexOf(" ")',
    'tostring': 'from * select quantity.ToString() + " pcs"',
    'length': 'from * where note.Length > 0',
    'year': 'from * where ordered_at.Year == 2025',
    'month': 'from * select ordered_at.Month',
    'day': 'from * select ordered_at.Day',
    'hour': 'from * select ordered_at.Hour',
    'minute': 'from * select ordered_at.Minute',
    'dayofweek': 'from * group by ordered_at.DayOfWeek select ordered_at.DayOfWeek, count()',
    'date': 'from * select ordered_at.Date',
    'math.round': 'from * select Math.Round(total / quantity, 2)',
    'math.abs': 'from * select Math.Abs(total - 100)',
    'math.floor': 'from * select Math.Floor(unit_price)',
    'math.ceiling': 'from * select Math.Ceiling(unit_price)',
    'math.min': 'from * select Math.Min(quantity, 10)',
    'math.max': 'from * select Math.Max(quantity, 1)',
    'math.pow': 'from * select Math.Pow(quantity, 2)',
    'math.sqrt': 'from * select Math.Sqrt(total)',
    'date()': 'from * where ordered_at >= date("2025-01-01")',
    'number': 'from * select number(order_id.Substring(4))',
    'count': 'from * group by city select city, count()',
    'sum': 'from * group by city select city, sum(total)',
    'average': 'from * group by product select product, average(unit_price)',
    'avg': 'from * select avg(quantity)',
    'min': 'from * select min(ordered_at)',
    'max': 'from * select max(total)',
};

// Argument names where value would not say enough.
const ARGUMENT_LABELS: Readonly<Record<string, string>> = {
    'substring': 'start[, length]',
    'replace': 'find, replacement',
    'math.round': 'value[, digits]',
};

function callExample(key: string): string {
    return CALL_EXAMPLES[key] ?? 'from * take 1';
}

export const LINQ_REFERENCE: ReadonlyArray<LinqReferenceSection> = [
    {
        title: 'Source',
        intro: 'Every query starts with from and reads the open table. Keywords ignore case.',
        entries: [
            {
                syntax: 'from row in table',
                description: 'Names each row; read columns as row.total, row["unit price"] or just total.',
                example: 'from row in table where row.total > 100',
            },
            {
                syntax: 'from *',
                description: 'No row name; read columns by name, like total. from table means the same.',
                example: 'from * where total > 100',
            },
        ],
    },
    {
        title: 'Clauses',
        intro: 'Clauses run in the order written. After select, only where, orderby, distinct, skip and take may follow, and they use the selected names.',
        entries: [
            { syntax: 'where condition', description: 'Keeps the rows where the condition is true.', example: 'from * where status == "delivered" && total > 100' },
            { syntax: 'let name = value', description: 'Names a computed value for the clauses after it.', example: 'from * let price = total / quantity where price > 20 select order_id, price' },
            {
                syntax: 'orderby value [ascending|descending], …',
                description: 'Sorts by one or more values; asc and desc work too, and so does order by. Empty values go last.',
                example: 'from * orderby city, total descending',
            },
            {
                syntax: 'group [row] by key [into g]',
                description: 'Collects rows with the same key. Afterwards use the key, g.Key, and aggregates over the group.',
                example: 'from row in table group row by row.city into g select g.Key, count(g), sum(g.total)',
            },
            {
                syntax: 'group by new { a, b }',
                description: 'Groups by several values; read them by name or as g.Key.a.',
                example: 'from * group by new { city, status } into g select g.Key.city, status, count()',
            },
            {
                syntax: 'select value, …',
                description: 'Picks the output columns. Name one with Name = value or value as Name; * keeps every column.',
                example: 'from * select order_id, Amount = total, quantity * unit_price as Gross',
            },
            {
                syntax: 'select new { Name = value, … }',
                description: 'The same as a select list, written as an object.',
                example: 'from row in table select new { row.city, Total = row.total }',
            },
            { syntax: 'distinct', description: 'Drops repeated rows.', example: 'from * select city distinct' },
            { syntax: 'skip n', description: 'Leaves out the first n rows.', example: 'from * skip 100' },
            { syntax: 'take n', description: 'Keeps the first n rows; reading stops as soon as it has them.', example: 'from * take 20' },
            { syntax: 'skip n take m', description: 'Pages through rows: skip 40 take 20 is the third page of 20.', example: 'from * orderby total desc skip 40 take 20' },
        ],
    },
    {
        title: 'Aggregates',
        intro: 'Inside an aggregate, names refer to the rows of the group, or of the whole table when there is no group by. Outside one, use the group key.',
        entries: LINQ_AGGREGATES.map((aggregate) => ({
            syntax: aggregate.kind === 'count' ? 'count() or count(value)' : `${aggregate.name}(value)`,
            description: aggregate.description,
            example: callExample(aggregate.name),
        })),
    },
    {
        title: 'Operators',
        intro: 'Loosest first. Comparisons between a number or date and text read the text as one.',
        entries: [
            { syntax: 'a ? b : c', description: 'b when a is true, c otherwise.', example: 'from * select total > 100 ? "big" : "small"' },
            { syntax: 'a ?? b', description: 'a, or b when a is empty.', example: 'from * select note ?? "none"' },
            { syntax: 'a || b, a or b', description: 'Either is true.', example: 'from * where city == "Patras" || city == "Volos"' },
            { syntax: 'a && b, a and b', description: 'Both are true.', example: 'from * where quantity > 1 and total < 50' },
            { syntax: '== != = <>', description: 'Equal and not equal; = and <> are the SQL spellings.', example: 'from * where status = "pending"' },
            { syntax: '< <= > >=', description: 'Numbers by value, dates in time order, text alphabetically.', example: 'from * where ordered_at >= "2025-01-01"' },
            {
                syntax: 'a like "text*", a not like "*text*"',
                description: 'Matches text against a pattern, ignoring case. Each * stands for any run of characters, even none; the rest must match exactly. An empty value never matches.',
                example: 'from * where city like "ath*" or note like "*gift*"',
            },
            {
                syntax: 'a in (x, y, …), a not in (…)',
                description: 'Equal to one of the values, compared as == does.',
                example: 'from * where status in ("shipped", "delivered")',
            },
            {
                syntax: 'a between low and high, a not between …',
                description: 'Within the range, both ends included: numbers, dates or text. The first and belongs to between.',
                example: 'from * where total between 100 and 500 and ordered_at between "2025-01-01" and "2025-12-31"',
            },
            { syntax: 'a is null, a is not null', description: 'The value is empty, or is not.', example: 'from * where note is not null' },
            { syntax: '+ -', description: 'Add and subtract; + joins text.', example: 'from * select city + " / " + product' },
            { syntax: '* / %', description: 'Multiply, divide and remainder; dividing by 0 gives an empty value.', example: 'from * select total / quantity' },
            { syntax: '!a, not a, -a', description: 'Negation; not a == b means not (a == b).', example: 'from * where not status == "pending" and !(note like "*gift*")' },
            { syntax: '"text", \'text\', 12.5, true, false, null', description: 'Literal values.', example: 'from * where note != null' },
            { syntax: '`odd name`', description: 'A column whose name has spaces or is a keyword.', example: 'from * select `order_id`' },
        ],
    },
    {
        title: 'Text',
        intro: 'Called on a value, like city.ToUpper(). Names ignore case; on an empty value they give an empty value. To test whether text contains, starts or ends with something, use like.',
        entries: [
            ...LINQ_METHODS.map((method) => ({
                syntax: `.${method.name}(${ARGUMENT_LABELS[method.name.toLowerCase()] ?? (method.minArgs === 0 ? '' : 'value')})`,
                description: method.description,
                example: callExample(method.name.toLowerCase()),
            })),
            ...LINQ_PROPERTIES.filter((property) => property.receiver === 'string').map((property) => ({
                syntax: `.${property.name}`,
                description: property.description,
                example: callExample(property.name.toLowerCase()),
            })),
        ],
    },
    {
        title: 'Dates',
        intro: 'Columns of ISO dates, like 2024-05-01 or 2024-05-01T10:30:00Z, are dates.',
        entries: LINQ_PROPERTIES.filter((property) => property.receiver === 'date').map((property) => ({
            syntax: `.${property.name}`,
            description: property.description,
            example: callExample(property.name.toLowerCase()),
        })),
    },
    {
        title: 'Functions',
        entries: LINQ_FUNCTIONS.map((entry) => ({
            syntax: `${entry.name}(${ARGUMENT_LABELS[entry.name.toLowerCase()] ?? (entry.minArgs === 1 ? 'value' : 'value, other')})`,
            description: entry.description,
            example: callExample(entry.name === 'date' ? 'date()' : entry.name.toLowerCase()),
        })),
    },
];

export interface LinqExampleQuery {
    readonly title: string;
    readonly query: string;
}

// Ready-made queries built from the table's own columns and the types of a few sample rows.
export function buildExampleQueries(columns: ReadonlyArray<string>, sampleRows: ReadonlyArray<ReadonlyArray<unknown>>): LinqExampleQuery[] {
    const types = inferColumnTypes(columns.length, sampleRows);
    const pick = (type: LinqColumnType, skip: ReadonlyArray<string> = []): string | null => {
        const index = types.findIndex((candidate, position) => candidate === type && !skip.includes(columns[position] ?? ''));

        return index < 0 ? null : quoteName(columns[index] as string);
    };
    const text = pick('string');
    const otherText = pick('string', text == null ? [] : [unquote(text)]);
    const number = pick('number');
    const date = pick('date');
    const first = columns[0] == null ? null : quoteName(columns[0]);
    const examples: LinqExampleQuery[] = [{ title: 'First 20 rows', query: 'from *\ntake 20' }];

    if (number != null) {
        examples.push({ title: 'Largest values', query: `from row in table\nwhere row.${number} > 0\norderby row.${number} descending\ntake 10` });
    }

    if (text != null) {
        const sample = sampleRows.find((row) => row[columns.indexOf(unquote(text))] != null)?.[columns.indexOf(unquote(text))];
        const value = sample == null ? 'A' : String(sample).slice(0, 1);
        examples.push({ title: 'Filter text', query: `from *\nwhere ${text} like ${JSON.stringify(`${value.replace(/\*/g, '')}*`)}\nselect ${[first, text].filter((name, index, all) => name != null && all.indexOf(name) === index).join(', ')}` });
        examples.push({
            title: 'Count per value',
            query: `from row in table\ngroup row by row.${text} into g\nselect new { ${titleCase(unquote(text))} = g.Key, Rows = count(g)${number == null ? '' : `, Total = sum(g.${number}), Average = average(g.${number})`} }\norderby Rows descending`,
        });
    }

    if (text != null && otherText != null) {
        examples.push({ title: 'Group by two columns', query: `from *\ngroup by new { ${text}, ${otherText} }\nselect ${text}, ${otherText}, count()\norderby ${text}` });
    }

    if (number != null) {
        examples.push({ title: 'Summary of the table', query: `from *\nselect Rows = count(), Total = sum(${number}), Smallest = min(${number}), Largest = max(${number})` });
    }

    if (date != null) {
        examples.push({ title: 'Per year', query: `from *\nwhere ${date} != null\ngroup by ${date}.Year into years\nselect Year = years.Key, Rows = count()\norderby Year` });
    }

    if (text != null) {
        examples.push({ title: 'Distinct values', query: `from *\nselect ${text}\ndistinct\norderby ${text}` });
    }

    examples.push({ title: 'Page 3 of 20', query: `from *\n${first == null ? '' : `orderby ${first}\n`}skip 40\ntake 20` });

    return examples;
}

// A column name as it can be written bare, or in backticks when it is not a plain word.
export function quoteName(name: string): string {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED.has(name.toLowerCase()) ? name : `\`${name}\``;
}

function unquote(name: string): string {
    return name.startsWith('`') ? name.slice(1, -1) : name;
}

function titleCase(name: string): string {
    const cleaned = name.replace(/[^A-Za-z0-9_]/g, '');
    const word = /^[A-Za-z_]/.test(cleaned) ? cleaned : `Value${cleaned}`;

    const title = word.charAt(0).toUpperCase() + word.slice(1);

    return RESERVED.has(title.toLowerCase()) ? `${title}Value` : title;
}

