// An XML parser without `DOMParser`, so it also runs in a worker. Namespace prefixes, CDATA text and whitespace are kept,
// entities are decoded, and declarations, processing instructions, comments and DOCTYPE are dropped.
export interface XmlNode {
    name: string;
    attributes: Record<string, string>;
    text: string;
    children: XmlNode[];
}

export interface XmlParseError {
    readonly ok: false;
    readonly message: string;
    readonly position: number;
    readonly line: number;
    readonly column: number;
}

export interface XmlParseSuccess {
    readonly ok: true;
    readonly root: XmlNode;
}

export type XmlParseResult = XmlParseSuccess | XmlParseError;

export function parseXml(source: string): XmlParseResult {
    const parser = new Parser(source);
    try {
        const root = parser.parse();

        return { ok: true, root };
    }
    catch (error) {
        if (error instanceof ParseError) {
            return {
                ok: false,
                message: error.message,
                position: error.position,
                line: error.line,
                column: error.column,
            };
        }

        throw error;
    }
}

class ParseError extends Error {
    constructor(
        message: string,
        public readonly position: number,
        public readonly line: number,
        public readonly column: number,
    ) {
        super(message);
    }
}

class Parser {
    private index = 0;

    constructor(private readonly source: string) {}

    parse(): XmlNode {
        this.skipProlog();
        this.skipWhitespace();

        if (this.index >= this.source.length) {
            this.fail('Empty XML document');
        }

        const root = this.readElement();

        // Allow trailing comments / whitespace after the root element.
        this.skipTrailing();

        if (this.index < this.source.length) {
            this.fail(`Unexpected content after root element: ${this.peek(16)}`);
        }

        return root;
    }

    private skipProlog(): void {
        while (true) {
            this.skipWhitespace();
            if (this.startsWith('<?')) {
                this.consumeUntil('?>', 'Unterminated processing instruction');
                continue;
            }

            if (this.startsWith('<!--')) {
                this.consumeUntil('-->', 'Unterminated comment');
                continue;
            }

            if (this.startsWith('<!DOCTYPE')) {
                this.consumeDoctype();
                continue;
            }

            return;
        }
    }

    private skipTrailing(): void {
        while (true) {
            this.skipWhitespace();
            if (this.startsWith('<!--')) {
                this.consumeUntil('-->', 'Unterminated comment');
                continue;
            }

            if (this.startsWith('<?')) {
                this.consumeUntil('?>', 'Unterminated processing instruction');
                continue;
            }

            return;
        }
    }

    private consumeDoctype(): void {
        // Handle DOCTYPE which may contain internal subset [ ... ].
        let depth = 0;
        while (this.index < this.source.length) {
            const ch = this.source[this.index];
            if (ch === '[') {
                depth += 1;
            }
            else if (ch === ']') {
                depth -= 1;
            }
            else if (ch === '>' && depth === 0) {
                this.index += 1;

                return;
            }

            this.index += 1;
        }

        this.fail('Unterminated DOCTYPE');
    }

    private readElement(): XmlNode {
        this.expect('<');
        const name = this.readName();
        const attributes = this.readAttributes();
        this.skipWhitespace();

        if (this.startsWith('/>')) {
            this.index += 2;

            return { name, attributes, text: '', children: [] };
        }

        this.expect('>');

        const children: XmlNode[] = [];
        let text = '';

        while (true) {
            if (this.index >= this.source.length) {
                this.fail(`Unterminated element <${name}>`);
            }

            if (this.startsWith('</')) {
                this.index += 2;
                const closing = this.readName();
                this.skipWhitespace();
                this.expect('>');
                if (closing !== name) {
                    this.fail(`Mismatched closing tag </${closing}> for <${name}>`);
                }

                return { name, attributes, text, children };
            }

            if (this.startsWith('<!--')) {
                this.consumeUntil('-->', 'Unterminated comment');
                continue;
            }

            if (this.startsWith('<![CDATA[')) {
                const end = this.source.indexOf(']]>', this.index + 9);
                if (end === -1) {
                    this.fail('Unterminated CDATA');
                }

                text += this.source.slice(this.index + 9, end);
                this.index = end + 3;
                continue;
            }

            if (this.startsWith('<?')) {
                this.consumeUntil('?>', 'Unterminated processing instruction');
                continue;
            }

            if (this.source[this.index] === '<') {
                children.push(this.readElement());
                continue;
            }

            text += this.readCharData();
        }
    }

    private readName(): string {
        const start = this.index;
        while (this.index < this.source.length) {
            const ch = this.source[this.index];
            if (ch == null) {
                break;
            }

            if (isNameChar(ch)) {
                this.index += 1;
                continue;
            }

            break;
        }

        if (start === this.index) {
            this.fail('Expected a name');
        }

        return this.source.slice(start, this.index);
    }

    private readAttributes(): Record<string, string> {
        const result: Record<string, string> = {};

        while (true) {
            this.skipWhitespace();
            const ch = this.source[this.index];
            if (ch == null || ch === '>' || ch === '/') {
                return result;
            }

            const name = this.readName();
            this.skipWhitespace();
            this.expect('=');
            this.skipWhitespace();
            const value = this.readAttributeValue();
            result[name] = value;
        }
    }

    private readAttributeValue(): string {
        const quote = this.source[this.index];
        if (quote !== '"' && quote !== "'") {
            this.fail('Expected a quoted attribute value');
        }

        this.index += 1;
        const start = this.index;
        const end = this.source.indexOf(quote, start);
        if (end === -1) {
            this.fail('Unterminated attribute value');
        }

        const raw = this.source.slice(start, end);
        this.index = end + 1;

        return decodeEntities(raw);
    }

    private readCharData(): string {
        const start = this.index;
        while (this.index < this.source.length) {
            const ch = this.source[this.index];
            if (ch === '<') {
                break;
            }

            this.index += 1;
        }

        return decodeEntities(this.source.slice(start, this.index));
    }

    private skipWhitespace(): void {
        while (this.index < this.source.length) {
            const ch = this.source[this.index];
            if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
                this.index += 1;
                continue;
            }

            return;
        }
    }

    private startsWith(token: string): boolean {
        return this.source.startsWith(token, this.index);
    }

    private expect(token: string): void {
        if (!this.startsWith(token)) {
            this.fail(`Expected '${token}'`);
        }

        this.index += token.length;
    }

    private consumeUntil(terminator: string, errorMessage: string): void {
        const end = this.source.indexOf(terminator, this.index);
        if (end === -1) {
            this.fail(errorMessage);
        }

        this.index = end + terminator.length;
    }

    private peek(count: number): string {
        return this.source.slice(this.index, this.index + count);
    }

    private fail(message: string): never {
        const { line, column } = locate(this.source, this.index);
        throw new ParseError(message, this.index, line, column);
    }
}

function isNameChar(ch: string): boolean {
    return /[A-Za-z0-9_\-.:]/.test(ch);
}

function decodeEntities(value: string): string {
    return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (match, inner: string) => {
        if (inner.startsWith('#x') || inner.startsWith('#X')) {
            const codePoint = Number.parseInt(inner.slice(2), 16);
            if (Number.isFinite(codePoint)) {
                return String.fromCodePoint(codePoint);
            }

            return match;
        }

        if (inner.startsWith('#')) {
            const codePoint = Number.parseInt(inner.slice(1), 10);
            if (Number.isFinite(codePoint)) {
                return String.fromCodePoint(codePoint);
            }

            return match;
        }

        const named: Record<string, string> = {
            lt: '<',
            gt: '>',
            amp: '&',
            quot: '"',
            apos: "'",
        };

        return named[inner] ?? match;
    });
}

function locate(source: string, position: number): { line: number; column: number } {
    let line = 1;
    let column = 1;
    const target = Math.min(position, source.length);
    for (let index = 0; index < target; index += 1) {
        if (source[index] === '\n') {
            line += 1;
            column = 1;
            continue;
        }

        column += 1;
    }

    return { line, column };
}
