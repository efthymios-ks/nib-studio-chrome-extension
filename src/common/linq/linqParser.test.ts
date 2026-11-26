import { describe, expect, it } from 'vitest';
import type { LinqExpression } from './linqAst.js';
import { LinqError } from './linqErrors.js';
import { parseExpression, parseQuery } from './linqParser.js';

// Renders an expression with full parentheses, to check precedence.
function show(expression: LinqExpression): string {
    switch (expression.kind) {
        case 'literal':
            return typeof expression.value === 'string' ? `"${expression.value}"` : String(expression.value);
        case 'identifier':
            return expression.name;
        case 'star':
            return '*';
        case 'member':
            return `${show(expression.object)}.${expression.name}`;
        case 'index':
            return `${show(expression.object)}[${show(expression.index)}]`;
        case 'call':
            return `${show(expression.callee)}(${expression.args.map(show).join(', ')})`;
        case 'unary':
            return `(${expression.operator}${show(expression.operand)})`;
        case 'binary':
            return `(${show(expression.left)} ${expression.operator} ${show(expression.right)})`;
        case 'conditional':
            return `(${show(expression.test)} ? ${show(expression.whenTrue)} : ${show(expression.whenFalse)})`;
        case 'object':
            return `new { ${expression.members.map((member) => `${member.alias ?? ''}=${show(member.expression)}`).join(', ')} }`;
        case 'like':
            return `(${show(expression.value)} ${expression.negated ? 'not like' : 'like'} ${show(expression.pattern)})`;
        case 'in':
            return `(${show(expression.value)} ${expression.negated ? 'not in' : 'in'} [${expression.items.map(show).join(', ')}])`;
        case 'between':
            return `(${show(expression.value)} ${expression.negated ? 'not between' : 'between'} ${show(expression.low)}..${show(expression.high)})`;
        case 'isNull':
            return `(${show(expression.value)} ${expression.negated ? 'is not null' : 'is null'})`;
        default:
            return '?';
    }
}

function errorOf(action: () => unknown): LinqError {
    try {
        action();
    }
    catch (error: unknown) {
        if (error instanceof LinqError) {
            return error;
        }

        throw error;
    }

    throw new Error('Expected a LinqError.');
}

describe('parseExpression precedence', () => {
    it.each([
        ['a + b * c', '(a + (b * c))'],
        ['(a + b) * c', '((a + b) * c)'],
        ['a - b - c', '((a - b) - c)'],
        ['a || b && c', '(a || (b && c))'],
        ['a and b or not c', '((a && b) || (!c))'],
        ['a == b && c != d', '((a == b) && (c != d))'],
        ['a = 1', '(a == 1)'],
        ['a < b == c > d', '((a < b) == (c > d))'],
        ['a ?? b ?? c', '(a ?? (b ?? c))'],
        ['a ?? b || c', '(a ?? (b || c))'],
        ['a ? b : c ? d : e', '(a ? b : (c ? d : e))'],
        ['!a.b', '(!a.b)'],
        ['-a * b', '((-a) * b)'],
        ['-2', '-2'],
        ['x.name.ToLower().Trim()', 'x.name.ToLower().Trim()'],
        ['a like "x*" && b', '((a like "x*") && b)'],
        ['a + 1 like "1*"', '((a + 1) like "1*")'],
        ['a not like "*x" or b NOT LIKE "y"', '((a not like "*x") || (b not like "y"))'],
        ['a like "x" == true', '((a like "x") == true)'],
        ['a in (1, "b", c + 1)', '(a in [1, "b", (c + 1)])'],
        ['a not in (1) and b', '((a not in [1]) && b)'],
        ['a between 1 and 5', '(a between 1..5)'],
        ['a between 1 and 5 and b', '((a between 1..5) && b)'],
        ['a between b - 1 and c + 1 or d', '((a between (b - 1)..(c + 1)) || d)'],
        ['a not between 1 and 5 && b between 2 and 3', '((a not between 1..5) && (b between 2..3))'],
        ['a is null', '(a is null)'],
        ['a.b Is Not Null and c is null', '((a.b is not null) && (c is null))'],
        ['not a is null', '(!(a is null))'],
        ['not a == b', '(!(a == b))'],
        ['not a like "x*"', '(!(a like "x*"))'],
        ['a == not b', '(a == (!b))'],
        ['x["unit price"] * 2', '(x["unit price"] * 2)'],
        ['Math.Round(x.total / 3, 2)', 'Math.Round((x.total / 3), 2)'],
        ['count(*)', 'count(*)'],
        ['new { A = 1, x.b }', 'new { A=1, =x.b }'],
        ['`unit price` + 1', '(unit price + 1)'],
    ])('%s', (text, expected) => {
        expect(show(parseExpression(text))).toBe(expected);
    });
});

describe('parseQuery', () => {
    it('reads the named form', () => {
        const query = parseQuery('from o in table where o.total > 5 select o.city');

        expect(query.rangeVariable).toBe('o');
        expect(query.clauses.map((clause) => clause.kind)).toEqual(['where', 'select']);
    });

    it('reads from * and from table', () => {
        expect(parseQuery('from * take 3').rangeVariable).toBeNull();
        expect(parseQuery('FROM TABLE TAKE 3').rangeVariable).toBeNull();
    });

    it('treats keywords without regard to case', () => {
        const query = parseQuery('From o In Table Where o.total > 1 OrderBy o.total Descending Select o');

        expect(query.clauses.map((clause) => clause.kind)).toEqual(['where', 'orderby', 'select']);
    });

    it('reads every clause in order', () => {
        const query = parseQuery([
            'from o in table',
            'where o.status == "delivered"',
            'let price = o.total / o.quantity',
            'group o by o.city into g',
            'select new { City = g.Key, Revenue = sum(g.total) }',
            'orderby Revenue descending, City',
            'distinct',
            'skip 10',
            'take 5',
        ].join('\n'));

        expect(query.clauses.map((clause) => clause.kind)).toEqual(['where', 'let', 'group', 'select', 'orderby', 'distinct', 'skip', 'take']);
    });

    it('accepts order as a range variable', () => {
        const query = parseQuery('from order in table where order.total > 1 order by order.total select order.city');

        expect(query.rangeVariable).toBe('order');
        expect(query.clauses.map((clause) => clause.kind)).toEqual(['where', 'orderby', 'select']);
    });

    it('reads order keys and directions', () => {
        const clause = parseQuery('from * order by total desc, city asc, status').clauses[0];

        expect(clause?.kind === 'orderby' ? clause.keys.map((key) => key.descending) : null).toEqual([true, false, false]);
    });

    it('reads group without an element and without into', () => {
        const clause = parseQuery('from * group by city').clauses[0];

        expect(clause).toMatchObject({ kind: 'group', element: null, into: null });
    });

    it('reads group with an element and into', () => {
        const clause = parseQuery('from o in table group o by new { o.city, o.status } into g').clauses[0];

        expect(clause).toMatchObject({ kind: 'group', element: 'o', into: 'g' });
    });

    it('reads select lists with aliases', () => {
        const clause = parseQuery('from * select city, Amount = total, quantity * 2 as Double, *').clauses[0];

        expect(clause?.kind === 'select' ? clause.items.map((item) => item.alias) : null).toEqual([null, 'Amount', 'Double', null]);
        expect(clause?.kind === 'select' ? clause.object : null).toBe(false);
    });

    it('reads select new { }', () => {
        const clause = parseQuery('from o in table select new { o.city, Total = o.total, }').clauses[0];

        expect(clause?.kind === 'select' ? [clause.object, clause.items.length] : null).toEqual([true, 2]);
    });

    it.each([
        ['from *', null, null, '*'],
        ['from table', null, null, 'table'],
        ['from row in table', 'row', null, 'table'],
        ['from Q2', null, 'Q2', 'Q2'],
        ['from row in Q2', 'row', 'Q2', 'Q2'],
        ["from 'North Region'", null, 'North Region', "'North Region'"],
        ['from "North Region"', null, 'North Region', '"North Region"'],
        ['from [North Region]', null, 'North Region', '[North Region]'],
        ['from row in [North Region]', 'row', 'North Region', '[North Region]'],
        ['from `North Region`', null, 'North Region', '`North Region`'],
        ['from [Sales & Ops (draft)]', null, 'Sales & Ops (draft)', '[Sales & Ops (draft)]'],
        ['from 2024', null, '2024', '2024'],
        ['from Order', null, 'Order', 'Order'],
        ['from o', null, 'o', 'o'],
    ])('reads the source of %s', (text, rangeVariable, sheet, written) => {
        const query = parseQuery(`${text} where total > 1`);

        expect([query.rangeVariable, query.source.sheet]).toEqual([rangeVariable, sheet]);
        expect(text.slice(query.source.span.start, query.source.span.end)).toBe(written);
        expect(query.clauses.map((clause) => clause.kind)).toEqual(['where']);
    });

    it('keeps brackets after the source as indexing', () => {
        const query = parseQuery('from row in [Q1] where row["unit price"] > 1');
        const clause = query.clauses[0];

        expect(query.source.sheet).toBe('Q1');
        expect(clause?.kind === 'where' ? show(clause.condition) : null).toBe('(row["unit price"] > 1)');
    });

    it('keeps spans on clauses', () => {
        const text = 'from * where total > 1';
        const clause = parseQuery(text).clauses[0];

        expect(text.slice(clause?.span.start, clause?.span.end)).toBe('where total > 1');
    });

    it.each([
        ['select 1', "Start the query with 'from row in table' or 'from *'."],
        ['from o in select', "After 'from o in', write 'table' or a sheet name, like 'in table' or 'in Q2'."],
        ['from o in *', "After 'from o in', write 'table' or a sheet name, like 'in table' or 'in Q2'."],
        ['from where', "After 'from', write '*', a sheet name or a row name with 'in', like 'from *', 'from Q2' or 'from row in table'."],
        ['from', "After 'from', write '*', a sheet name or a row name with 'in', like 'from *', 'from Q2' or 'from row in table'."],
        ['from * join x in table', 'join is not supported: a query reads just the open table.'],
        ['from * from * ', 'Only one from is allowed: a query reads just the open table.'],
        ['from * select city group by city', "'group' cannot follow select; only where, orderby, distinct, skip and take can."],
        ['from * group by a group by b', 'A query can group only once.'],
        ['from * where', 'The query ends where a value was expected.'],
        ['from * where (a', "Expected ')'."],
        ['from * order total', "Expected a clause (where, let, orderby, group, select, distinct, skip or take) but found 'order'."],
        ['from * frobnicate', "Expected a clause (where, let, orderby, group, select, distinct, skip or take) but found 'frobnicate'."],
        ['from * let = 1', 'let needs a name, like let price = row.total / row.quantity.'],
        ['from * select new { }', 'new { } needs at least one member.'],
        ['from * where select', "Expected a value but found 'select'."],
        ['from * where a in 1', "Expected '(' after 'in', like in (\"a\", \"b\")."],
        ['from * where a in ()', 'in ( ) needs at least one value.'],
        ['from * where a in (1 2)', "Expected ',' or ')' in the in ( … ) list."],
        ['from * where a between 1', "Expected 'and' in between low and high."],
        ['from * where a between 1 or 2', "Expected 'and' in between low and high."],
        ['from * where a is 1', "Expected 'null' after 'is', like note is null or note is not null."],
        ['from * where a like', 'The query ends where a value was expected.'],
        ['from * where a not', "Expected a clause (where, let, orderby, group, select, distinct, skip or take) but found 'not'."],
    ])('rejects %s', (text, message) => {
        expect(errorOf(() => parseQuery(text)).message).toBe(message);
    });

    it.each([
        ['from * where total between 1 or', 'or'],
        ['from * where note is not 5', '5'],
        ['from * where city in "Athens"', '"Athens"'],
    ])('points at the offending token in %s', (text, token) => {
        const error = errorOf(() => parseQuery(text));

        expect(text.slice(error.start, error.end)).toBe(token);
        expect(error.column).toBe(text.indexOf(token) + 1);
    });

    it('reports line and column', () => {
        const error = errorOf(() => parseQuery('from o in table\nwhere o.total >\n'));

        expect([error.line, error.column]).toEqual([3, 1]);
    });

    it('reports the offending span', () => {
        const text = 'from * where total > 1 bogus';
        const error = errorOf(() => parseQuery(text));

        expect(text.slice(error.start, error.end)).toBe('bogus');
        expect([error.line, error.column]).toEqual([1, 24]);
    });
});
