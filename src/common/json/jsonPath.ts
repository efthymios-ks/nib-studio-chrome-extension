import { JSONPath } from 'jsonpath-plus';
import type { JsonPathSegment } from '../paths/jsonPathBuilder.js';
import { errorMessage } from '../errorMessage.js';

export interface JsonPathMatch {
    // The normalised path, such as `$['orders'][0]['id']`.
    readonly path: string;
    readonly value: unknown;
    // Where the value sits in the document, or null when it is not one of its values, such as an array's `length`.
    readonly segments: ReadonlyArray<JsonPathSegment> | null;
}

export interface JsonPathResult {
    readonly ok: true;
    readonly matches: ReadonlyArray<JsonPathMatch>;
}

export interface JsonPathError {
    readonly ok: false;
    readonly message: string;
    // The part of the expression at fault, as 0-based offsets, when it is known.
    readonly span: { readonly start: number; readonly end: number } | null;
}

export function runJsonPath(root: unknown, expression: string): JsonPathResult | JsonPathError {
    const trimmed = expression.trim();

    if (trimmed === '') {
        return {
            ok: true,
            matches: [],
        };
    }

    const syntaxError = findSyntaxError(expression);

    if (syntaxError != null) {
        return syntaxError;
    }

    try {
        const result = JSONPath({
            json: root as object,
            path: trimmed,
            resultType: 'all',
        }) as unknown as Array<{ path: string; value: unknown; pointer: string }>;

        return {
            ok: true,
            matches: result.map((node) => ({
                path: node.path,
                value: node.value,
                segments: jsonPointerSegments(root, node.pointer),
            })),
        };
    }
    catch (error) {
        const message = errorMessage(error, 'Invalid JSONPath expression.');

        return {
            ok: false,
            message: cleanMessage(message),
            span: filterAtFault(expression, message),
        };
    }
}

// Unbalanced brackets, parentheses and quotes, which jsonpath-plus would otherwise read leniently or report vaguely.
function findSyntaxError(expression: string): JsonPathError | null {
    const open: Array<{ readonly character: string; readonly index: number }> = [];

    for (let index = 0; index < expression.length; index += 1) {
        const character = expression[index] ?? '';

        if (character === '"' || character === "'") {
            const end = closingQuote(expression, index);

            if (end < 0) {
                return syntaxError('Unterminated string', index, expression.length);
            }

            index = end;
            continue;
        }

        if (character === '[' || character === '(') {
            open.push({ character, index });
            continue;
        }

        if (character !== ']' && character !== ')') {
            continue;
        }

        const innermost = open.pop();

        if (innermost == null) {
            return syntaxError(`Unexpected '${character}'`, index, index + 1);
        }

        const expected = CLOSERS[innermost.character];

        if (expected !== character) {
            return syntaxError(`Expected '${expected}' but found '${character}'`, index, index + 1);
        }
    }

    const unclosed = open.pop();

    return unclosed == null ? null : syntaxError(`Unclosed '${unclosed.character}'`, unclosed.index, unclosed.index + 1);
}

const CLOSERS: Readonly<Record<string, string>> = Object.freeze({ '[': ']', '(': ')' });

function closingQuote(expression: string, start: number): number {
    const quote = expression[start];

    for (let index = start + 1; index < expression.length; index += 1) {
        if (expression[index] === '\\') {
            index += 1;
            continue;
        }

        if (expression[index] === quote) {
            return index;
        }
    }

    return -1;
}

function syntaxError(message: string, start: number, end: number): JsonPathError {
    return { ok: false, message, span: { start, end } };
}

// jsonpath-plus counts characters within its rewritten filter, so that count is left out.
function cleanMessage(message: string): string {
    return message
        .replace(/^jsonPath:\s*/, '')
        .replace(/ at character \d+$/, '')
        .replace(/\.$/, '');
}

// The filter `?(…)` an evaluation error comes from: the one the message quotes, or the only one.
function filterAtFault(expression: string, message: string): { start: number; end: number } | null {
    const filters = filterSpans(expression);
    const quoted = filters.find((filter) => message.includes(expression.slice(filter.start + 2, filter.end - 1).trim()));

    if (quoted != null) {
        return quoted;
    }

    return filters.length === 1 ? filters[0] ?? null : null;
}

function filterSpans(expression: string): Array<{ start: number; end: number }> {
    const spans: Array<{ start: number; end: number }> = [];
    let start = expression.indexOf('?(');

    while (start >= 0) {
        let depth = 0;
        let end = -1;

        for (let index = start + 1; index < expression.length && end < 0; index += 1) {
            const character = expression[index];

            if (character === '"' || character === "'") {
                index = Math.max(index, closingQuote(expression, index));
                continue;
            }

            depth += character === '(' ? 1 : 0;
            depth -= character === ')' ? 1 : 0;

            if (depth === 0) {
                end = index + 1;
            }
        }

        if (end < 0) {
            break;
        }

        spans.push({ start, end });
        start = expression.indexOf('?(', end);
    }

    return spans;
}

// Follows a JSON Pointer through the document, so array items get number segments and object keys string ones.
export function jsonPointerSegments(root: unknown, pointer: string): JsonPathSegment[] | null {
    if (pointer === '') {
        return [];
    }

    const segments: JsonPathSegment[] = [];
    let current = root;

    for (const raw of pointer.slice(1).split('/')) {
        const token = raw.replace(/~1/g, '/').replace(/~0/g, '~');

        if (Array.isArray(current)) {
            if (!/^\d+$/.test(token) || Number(token) >= current.length) {
                return null;
            }

            segments.push(Number(token));
            current = current[Number(token)];
            continue;
        }

        if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, token)) {
            return null;
        }

        segments.push(token);
        current = (current as Record<string, unknown>)[token];
    }

    return segments;
}
