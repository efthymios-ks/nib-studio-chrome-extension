import type {
    LinqBinaryOperator,
    LinqClause,
    LinqExpression,
    LinqOrderKey,
    LinqQuery,
    LinqSelectItem,
    LinqSourceRef,
} from './linqAst.js';
import { LinqError, type LinqSpan } from './linqErrors.js';
import { tokenize, type LinqToken } from './linqTokenizer.js';

// Words with a meaning of their own; a column with one of these names is written `like this`.
export const LINQ_KEYWORDS: ReadonlyArray<string> = [
    'from', 'in', 'table', 'where', 'let', 'orderby', 'by', 'group', 'into', 'select', 'distinct',
    'skip', 'take', 'ascending', 'descending', 'asc', 'desc', 'new', 'as', 'true', 'false', 'null',
    'and', 'or', 'not', 'like', 'between', 'is',
];

// Keywords only where they start a clause, so `from order in table` reads `order` as a name.
export const LINQ_CONTEXTUAL_KEYWORDS: ReadonlyArray<string> = ['order'];

const KEYWORDS = new Set(LINQ_KEYWORDS);

// Whether a word, in any case, is one of the keywords.
export function isLinqKeyword(word: string): boolean {
    return KEYWORDS.has(word.toLowerCase());
}

// Whether a column or sheet name can be written bare: a plain word that isn't a keyword.
export function isBareName(name: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !isLinqKeyword(name);
}

const CLAUSES_AFTER_SELECT = new Set(['where', 'orderby', 'order', 'distinct', 'skip', 'take']);

interface BinaryLevel {
    readonly operators: ReadonlyArray<{ readonly token: string; readonly operator: LinqBinaryOperator }>;
    readonly rightAssociative?: boolean;
}

// Lowest precedence first; each level binds tighter than the one before it.
const BINARY_LEVELS: ReadonlyArray<BinaryLevel> = [
    { operators: [{ token: '??', operator: '??' }], rightAssociative: true },
    { operators: [{ token: '||', operator: '||' }, { token: 'or', operator: '||' }] },
    { operators: [{ token: '&&', operator: '&&' }, { token: 'and', operator: '&&' }] },
    { operators: [{ token: '==', operator: '==' }, { token: '=', operator: '==' }, { token: '!=', operator: '!=' }] },
    {
        operators: [
            { token: '<', operator: '<' },
            { token: '<=', operator: '<=' },
            { token: '>', operator: '>' },
            { token: '>=', operator: '>=' },
        ],
    },
    { operators: [{ token: '+', operator: '+' }, { token: '-', operator: '-' }] },
    { operators: [{ token: '*', operator: '*' }, { token: '/', operator: '/' }, { token: '%', operator: '%' }] },
];

// The level of == and !=; keyword not binds just looser, so not a == b means not (a == b).
const EQUALITY_LEVEL = 3;

// The level of < and >; like, in, between and is sit here too.
const RELATIONAL_LEVEL = 4;

// Keywords that, after a value, start a comparison at the relational level.
const COMPARISON_KEYWORDS = ['like', 'in', 'between', 'is'];

export function parseQuery(text: string): LinqQuery {
    try {
        return new LinqParser(tokenize(text)).parseQuery();
    }
    catch (error: unknown) {
        if (error instanceof LinqError) {
            error.locate(text);
        }

        throw error;
    }
}

// Parses a single expression, for tests and tools.
export function parseExpression(text: string): LinqExpression {
    try {
        const parser = new LinqParser(tokenize(text));
        const expression = parser.parseExpression();
        parser.expectEnd();

        return expression;
    }
    catch (error: unknown) {
        if (error instanceof LinqError) {
            error.locate(text);
        }

        throw error;
    }
}

class LinqParser {
    private position = 0;

    constructor(private readonly tokens: ReadonlyArray<LinqToken>) {}

    parseQuery(): LinqQuery {
        const first = this.peek();

        if (!this.isKeyword(first, 'from')) {
            throw new LinqError("Start the query with 'from row in table' or 'from *'.", first);
        }

        this.advance();
        let rangeVariable: string | null = null;
        const next = this.peek();

        // `from row in …` names each row; anything else after from is the source itself.
        if (next.kind === 'identifier' && !this.isReserved(next) && this.isKeyword(this.peekAt(1), 'in')) {
            rangeVariable = next.text;
            this.advance();
            this.advance();
        }

        const source = this.parseSource(rangeVariable);
        const clauses: LinqClause[] = [];
        let selected = false;
        let grouped = false;

        while (this.peek().kind !== 'eof') {
            const token = this.peek();
            const word = token.kind === 'identifier' && token.quoted !== true ? token.text.toLowerCase() : '';

            if (selected && word !== '' && KEYWORDS.has(word) && !CLAUSES_AFTER_SELECT.has(word)) {
                throw new LinqError(`'${token.text}' cannot follow select; only where, orderby, distinct, skip and take can.`, token);
            }

            const clause = this.parseClause(token, word, grouped);
            selected ||= clause.kind === 'select';
            grouped ||= clause.kind === 'group';
            clauses.push(clause);
        }

        return { rangeVariable, source, clauses, span: { start: first.start, end: this.peek().start } };
    }

    // The open table, written `*` or `table`, or a sheet:
    // `Q2`, `'North Region'`, `[North Region]` or `` `North Region` ``.
    private parseSource(rangeVariable: string | null): LinqSourceRef {
        const token = this.peek();

        if ((rangeVariable == null && this.isPunct(token, '*')) || this.isKeyword(token, 'table')) {
            this.advance();

            return { sheet: null, span: { start: token.start, end: token.end } };
        }

        const isName = token.kind === 'string'
            || token.kind === 'number'
            || (token.kind === 'identifier' && !this.isReserved(token));

        if (isName && token.text.trim() !== '') {
            this.advance();

            return { sheet: token.text, span: { start: token.start, end: token.end } };
        }

        if (rangeVariable != null) {
            throw new LinqError(`After 'from ${rangeVariable} in', write 'table' or a sheet name, like 'in table' or 'in Q2'.`, token);
        }

        throw new LinqError(
            "After 'from', write '*', a sheet name or a row name with 'in', like 'from *', 'from Q2' or 'from row in table'.",
            token,
        );
    }

    private parseClause(token: LinqToken, word: string, grouped: boolean): LinqClause {
        switch (word) {
            case 'where': {
                this.advance();
                const condition = this.parseExpression();

                return { kind: 'where', condition, span: this.spanFrom(token) };
            }
            case 'let': {
                this.advance();
                const name = this.expectName('let needs a name, like let price = row.total / row.quantity.');
                this.expectPunct('=', `Expected '=' after 'let ${name}'.`);
                const value = this.parseExpression();

                return { kind: 'let', name, value, span: this.spanFrom(token) };
            }
            case 'orderby':
                return this.parseOrderBy(token, word);
            case 'order':
                if (this.isKeyword(this.peekAt(1), 'by')) {
                    return this.parseOrderBy(token, word);
                }

                break;
            case 'group':
                if (grouped) {
                    throw new LinqError('A query can group only once.', token);
                }

                return this.parseGroup(token);
            case 'select':
                return this.parseSelect(token);
            case 'distinct':
                this.advance();

                return { kind: 'distinct', span: this.spanFrom(token) };
            case 'skip':
            case 'take': {
                this.advance();
                const count = this.parseExpression();

                return { kind: word, count, span: this.spanFrom(token) };
            }
            case 'from':
                throw new LinqError('Only one from is allowed: a query reads just the open table.', token);
            default:
                break;
        }

        if (token.kind === 'identifier' && token.text.toLowerCase() === 'join') {
            throw new LinqError('join is not supported: a query reads just the open table.', token);
        }

        throw new LinqError(
            `Expected a clause (where, let, orderby, group, select, distinct, skip or take) but found '${describe(token)}'.`,
            token,
        );
    }

    private parseOrderBy(token: LinqToken, word: string): LinqClause {
        this.advance();

        if (word === 'order') {
            const by = this.peek();

            if (!this.isKeyword(by, 'by')) {
                throw new LinqError("Expected 'by' after 'order'.", by);
            }

            this.advance();
        }

        const keys: LinqOrderKey[] = [];

        do {
            const expression = this.parseExpression();
            const direction = this.peek();
            let descending = false;

            if (this.isKeyword(direction, 'descending') || this.isKeyword(direction, 'desc')) {
                descending = true;
                this.advance();
            }
            else if (this.isKeyword(direction, 'ascending') || this.isKeyword(direction, 'asc')) {
                this.advance();
            }

            keys.push({ expression, descending });
        } while (this.acceptPunct(','));

        return { kind: 'orderby', keys, span: this.spanFrom(token) };
    }

    private parseGroup(token: LinqToken): LinqClause {
        this.advance();
        const element = this.peek();

        if (!this.isKeyword(element, 'by')) {
            if (element.kind !== 'identifier' || this.isReserved(element)) {
                throw new LinqError("Expected 'by' after 'group'.", element);
            }

            // `group row by …` names the range variable; anything else would be an element selector.
            this.advance();
            const by = this.peek();

            if (!this.isKeyword(by, 'by')) {
                throw new LinqError(`Expected 'by' after 'group ${element.text}'.`, by);
            }
        }

        const elementName = this.isKeyword(element, 'by') ? null : element.text;
        this.advance();
        const key = this.parseExpression();
        let into: string | null = null;

        if (this.isKeyword(this.peek(), 'into')) {
            this.advance();
            into = this.expectName("into needs a name for the group, like 'into g'.");
        }

        return { kind: 'group', element: elementName, key, into, span: this.spanFrom(token) };
    }

    private parseSelect(token: LinqToken): LinqClause {
        this.advance();
        const next = this.peek();

        if (this.isKeyword(next, 'new') && this.isPunct(this.peekAt(1), '{')) {
            const object = this.parsePrimary();

            if (object.kind === 'object' && !this.isBinaryContinuation()) {
                return { kind: 'select', items: object.members, object: true, span: this.spanFrom(token) };
            }

            throw new LinqError('Write select new { … } on its own, without operators after it.', object.span);
        }

        const items: LinqSelectItem[] = [];

        do {
            items.push(this.parseSelectItem());
        } while (this.acceptPunct(','));

        return { kind: 'select', items, object: false, span: this.spanFrom(token) };
    }

    private isBinaryContinuation(): boolean {
        const token = this.peek();

        return BINARY_LEVELS.some((level) => level.operators.some((entry) => this.matchesOperator(token, entry.token)))
            || COMPARISON_KEYWORDS.some((word) => this.isKeyword(token, word))
            || (this.isKeyword(token, 'not') && COMPARISON_KEYWORDS.some((word) => this.isKeyword(this.peekAt(1), word)));
    }

    private parseSelectItem(): LinqSelectItem {
        const start = this.peek();

        if (this.isPunct(start, '*')) {
            this.advance();

            return { alias: null, expression: { kind: 'star', span: start }, span: start };
        }

        let alias: string | null = null;

        if (start.kind === 'identifier' && !this.isReserved(start) && this.isPunct(this.peekAt(1), '=')) {
            alias = start.text;
            this.advance();
            this.advance();
        }

        const expression = this.parseExpression();

        if (alias == null && this.isKeyword(this.peek(), 'as')) {
            this.advance();
            alias = this.expectName("as needs a name, like 'as Revenue'.");
        }

        return { alias, expression, span: this.spanFrom(start) };
    }

    parseExpression(): LinqExpression {
        const test = this.parseBinary(0);

        if (!this.acceptPunct('?')) {
            return test;
        }

        const whenTrue = this.parseExpression();
        this.expectPunct(':', "Expected ':' in the condition ? value : other value.");
        const whenFalse = this.parseExpression();

        return { kind: 'conditional', test, whenTrue, whenFalse, span: join(test.span, whenFalse.span) };
    }

    expectEnd(): void {
        const token = this.peek();

        if (token.kind !== 'eof') {
            throw new LinqError(`Unexpected '${describe(token)}'.`, token);
        }
    }

    private parseBinary(levelIndex: number): LinqExpression {
        const level = BINARY_LEVELS[levelIndex];

        if (level == null) {
            return this.parseUnary();
        }

        if (levelIndex === EQUALITY_LEVEL) {
            const not = this.peek();

            if (this.isKeyword(not, 'not')) {
                this.advance();
                const operand = this.parseBinary(levelIndex);

                return { kind: 'unary', operator: '!', operand, span: join(not, operand.span) };
            }
        }

        let left = this.parseBinary(levelIndex + 1);

        for (;;) {
            const token = this.peek();

            if (levelIndex === RELATIONAL_LEVEL) {
                const comparison = this.parseKeywordComparison(left, levelIndex);

                if (comparison != null) {
                    left = comparison;
                    continue;
                }
            }

            const match = level.operators.find((entry) => this.matchesOperator(token, entry.token));

            if (match == null) {
                return left;
            }

            this.advance();
            const right = level.rightAssociative === true ? this.parseBinary(levelIndex) : this.parseBinary(levelIndex + 1);
            left = { kind: 'binary', operator: match.operator, left, right, span: join(left.span, right.span) };
        }
    }

    // Reads `like`, `in`, `between` and `is` after a value, each with an optional not; null when none follows.
    private parseKeywordComparison(value: LinqExpression, levelIndex: number): LinqExpression | null {
        let token = this.peek();
        const negated = this.isKeyword(token, 'not');

        if (negated) {
            const next = this.peekAt(1);

            if (!['like', 'in', 'between'].some((word) => this.isKeyword(next, word))) {
                return null;
            }

            this.advance();
            token = this.peek();
        }

        if (this.isKeyword(token, 'like')) {
            this.advance();
            const pattern = this.parseBinary(levelIndex + 1);

            return { kind: 'like', value, pattern, negated, span: join(value.span, pattern.span) };
        }

        if (this.isKeyword(token, 'in')) {
            this.advance();
            this.expectPunct('(', "Expected '(' after 'in', like in (\"a\", \"b\").");

            if (this.isPunct(this.peek(), ')')) {
                throw new LinqError('in ( ) needs at least one value.', this.peek());
            }

            const items: LinqExpression[] = [];

            do {
                items.push(this.parseExpression());
            } while (this.acceptPunct(','));

            const close = this.expectPunct(')', "Expected ',' or ')' in the in ( … ) list.");

            return { kind: 'in', value, items, negated, span: join(value.span, close) };
        }

        if (this.isKeyword(token, 'between')) {
            this.advance();
            // The bounds are read above the logical level, so the first `and` always belongs to between.
            const low = this.parseBinary(levelIndex + 1);

            if (!this.isKeyword(this.peek(), 'and')) {
                throw new LinqError("Expected 'and' in between low and high.", this.peek());
            }

            this.advance();
            const high = this.parseBinary(levelIndex + 1);

            return { kind: 'between', value, low, high, negated, span: join(value.span, high.span) };
        }

        if (this.isKeyword(token, 'is')) {
            this.advance();
            const notNull = this.isKeyword(this.peek(), 'not');

            if (notNull) {
                this.advance();
            }

            const end = this.peek();

            if (!this.isKeyword(end, 'null')) {
                throw new LinqError("Expected 'null' after 'is', like note is null or note is not null.", end);
            }

            this.advance();

            return { kind: 'isNull', value, negated: notNull, span: join(value.span, end) };
        }

        return null;
    }

    private matchesOperator(token: LinqToken, operator: string): boolean {
        return /^[a-z]+$/.test(operator) ? this.isKeyword(token, operator) : this.isPunct(token, operator);
    }

    private parseUnary(): LinqExpression {
        const token = this.peek();

        if (this.isPunct(token, '!') || this.isKeyword(token, 'not')) {
            this.advance();
            const operand = this.parseUnary();

            return { kind: 'unary', operator: '!', operand, span: join(token, operand.span) };
        }

        if (this.isPunct(token, '-')) {
            this.advance();
            const operand = this.parseUnary();

            if (operand.kind === 'literal' && typeof operand.value === 'number') {
                return { kind: 'literal', value: -operand.value, span: join(token, operand.span) };
            }

            return { kind: 'unary', operator: '-', operand, span: join(token, operand.span) };
        }

        if (this.isPunct(token, '+')) {
            this.advance();

            return this.parseUnary();
        }

        return this.parsePostfix(this.parsePrimary());
    }

    private parsePostfix(target: LinqExpression): LinqExpression {
        let expression = target;

        for (;;) {
            if (this.acceptPunct('.')) {
                const name = this.peek();

                if (name.kind !== 'identifier') {
                    throw new LinqError("Expected a name after '.'.", name);
                }

                this.advance();
                expression = { kind: 'member', object: expression, name: name.text, span: join(expression.span, name) };
                continue;
            }

            if (this.acceptPunct('[')) {
                const index = this.parseExpression();
                const close = this.expectPunct(']', "Expected ']'.");
                expression = { kind: 'index', object: expression, index, span: join(expression.span, close) };
                continue;
            }

            if (this.isPunct(this.peek(), '(')) {
                this.advance();
                const args: LinqExpression[] = [];

                if (!this.isPunct(this.peek(), ')')) {
                    do {
                        const star = this.peek();

                        if (this.isPunct(star, '*') && (this.isPunct(this.peekAt(1), ')') || this.isPunct(this.peekAt(1), ','))) {
                            this.advance();
                            args.push({ kind: 'star', span: star });
                        }
                        else {
                            args.push(this.parseExpression());
                        }
                    } while (this.acceptPunct(','));
                }

                const close = this.expectPunct(')', "Expected ')' to close the argument list.");
                expression = { kind: 'call', callee: expression, args, span: join(expression.span, close) };
                continue;
            }

            return expression;
        }
    }

    private parsePrimary(): LinqExpression {
        const token = this.peek();

        if (token.kind === 'number') {
            this.advance();

            return { kind: 'literal', value: token.number ?? 0, span: token };
        }

        if (token.kind === 'string') {
            this.advance();

            return { kind: 'literal', value: token.text, span: token };
        }

        if (this.acceptPunct('(')) {
            const inner = this.parseExpression();
            const close = this.expectPunct(')', "Expected ')'.");

            return { ...inner, span: join(token, close) } as LinqExpression;
        }

        if (token.kind === 'identifier') {
            if (token.quoted === true) {
                this.advance();

                return { kind: 'identifier', name: token.text, span: token };
            }

            const word = token.text.toLowerCase();

            if (word === 'true' || word === 'false' || word === 'null') {
                this.advance();

                return { kind: 'literal', value: word === 'null' ? null : word === 'true', span: token };
            }

            if (word === 'new') {
                return this.parseObject(token);
            }

            if (!KEYWORDS.has(word)) {
                this.advance();

                return { kind: 'identifier', name: token.text, span: token };
            }
        }

        if (token.kind === 'eof') {
            throw new LinqError('The query ends where a value was expected.', token);
        }

        throw new LinqError(`Expected a value but found '${describe(token)}'.`, token);
    }

    private parseObject(token: LinqToken): LinqExpression {
        this.advance();
        this.expectPunct('{', "Expected '{' after 'new'.");
        const members: LinqSelectItem[] = [];

        while (!this.isPunct(this.peek(), '}')) {
            members.push(this.parseSelectItem());

            if (!this.acceptPunct(',')) {
                break;
            }
        }

        const close = this.expectPunct('}', "Expected ',' or '}' in new { … }.");

        if (members.length === 0) {
            throw new LinqError('new { } needs at least one member.', join(token, close));
        }

        return { kind: 'object', members, span: join(token, close) };
    }

    private expectName(message: string): string {
        const token = this.peek();

        if (token.kind !== 'identifier' || this.isReserved(token)) {
            throw new LinqError(message, token);
        }

        this.advance();

        return token.text;
    }

    private expectPunct(text: string, message: string): LinqToken {
        const token = this.peek();

        if (!this.isPunct(token, text)) {
            throw new LinqError(message, token);
        }

        this.advance();

        return token;
    }

    private acceptPunct(text: string): boolean {
        if (!this.isPunct(this.peek(), text)) {
            return false;
        }

        this.advance();

        return true;
    }

    private isPunct(token: LinqToken, text: string): boolean {
        return token.kind === 'punct' && token.text === text;
    }

    private isKeyword(token: LinqToken, word: string): boolean {
        return token.kind === 'identifier' && token.quoted !== true && token.text.toLowerCase() === word;
    }

    private isReserved(token: LinqToken): boolean {
        return token.quoted !== true && KEYWORDS.has(token.text.toLowerCase());
    }

    private spanFrom(token: LinqToken): LinqSpan {
        const previous = this.tokens[this.position - 1] ?? token;

        return { start: token.start, end: previous.end };
    }

    private peek(): LinqToken {
        return this.peekAt(0);
    }

    private peekAt(offset: number): LinqToken {
        return this.tokens[Math.min(this.position + offset, this.tokens.length - 1)] as LinqToken;
    }

    private advance(): void {
        if (this.position < this.tokens.length - 1) {
            this.position += 1;
        }
    }
}

function join(left: LinqSpan, right: LinqSpan): LinqSpan {
    return { start: left.start, end: right.end };
}

function describe(token: LinqToken): string {
    if (token.kind === 'eof') {
        return 'the end of the query';
    }

    return token.kind === 'string' ? `"${token.text}"` : token.text;
}
