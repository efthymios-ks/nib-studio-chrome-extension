import { errorMessage } from '../errorMessage.js';
export type JsonValueKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export interface JsonNode {
    readonly path: string;
    readonly key: string | number | null;
    readonly kind: JsonValueKind;
    readonly raw: unknown;
    readonly children: ReadonlyArray<JsonNode>;
}

export interface ParsedJson {
    readonly ok: true;
    readonly value: unknown;
    readonly root: JsonNode;
}

export interface JsonParseError {
    readonly ok: false;
    readonly message: string;
    readonly line: number;
    readonly column: number;
}

export type JsonParseResult = ParsedJson | JsonParseError;

// A text format whose documents the data views read as JSON values, such as JSON itself or YAML.
export interface DataFormat {
    // As messages name it, such as `Not valid JSON`.
    readonly name: string;
    readonly parse: (text: string) => JsonParseResult;
}

export function parseJson(text: string): JsonParseResult {
    try {
        const value = JSON.parse(text);

        return {
            ok: true,
            value,
            root: buildNode('$', null, value),
        };
    }
    catch (error) {
        return {
            ok: false,
            ...locate(text, error),
        };
    }
}

export const JSON_DATA_FORMAT: DataFormat = Object.freeze({
    name: 'JSON',
    parse: parseJson,
});

// The tree of a value that is already parsed, rooted at `$`.
export function jsonTreeOf(value: unknown): JsonNode {
    return buildNode('$', null, value);
}

function buildNode(path: string, key: string | number | null, value: unknown): JsonNode {
    if (Array.isArray(value)) {
        return {
            path,
            key,
            kind: 'array',
            raw: value,
            children: value.map((item, index) => buildNode(`${path}[${index}]`, index, item)),
        };
    }

    if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>);

        return {
            path,
            key,
            kind: 'object',
            raw: value,
            children: entries.map(([entryKey, entryValue]) => buildNode(`${path}.${entryKey}`, entryKey, entryValue)),
        };
    }

    return {
        path,
        key,
        kind: kindOf(value),
        raw: value,
        children: [],
    };
}

function kindOf(value: unknown): JsonValueKind {
    if (value === null) {
        return 'null';
    }

    if (typeof value === 'string') {
        return 'string';
    }

    if (typeof value === 'number') {
        return 'number';
    }

    if (typeof value === 'boolean') {
        return 'boolean';
    }

    return 'null';
}

// The engine's message doesn't always carry a position, so the scanner finds the offset itself.
function locate(text: string, error: unknown): { message: string; line: number; column: number } {
    const scanned = findJsonError(text);
    const fallback = errorMessage(error, 'Invalid JSON');
    const message = scanned?.message ?? fallback;
    const offset = scanned?.offset ?? 0;
    let line = 1;
    let column = 1;

    for (let index = 0; index < offset && index < text.length; index += 1) {
        if (text[index] === '\n') {
            line += 1;
            column = 1;
        }
        else {
            column += 1;
        }
    }

    return { message, line, column };
}

interface JsonScanError {
    readonly offset: number;
    readonly message: string;
}

class JsonScanFailure extends Error {
    constructor(readonly offset: number, message: string) {
        super(message);
    }
}

const JSON_WHITESPACE = new Set([' ', '\t', '\n', '\r']);
const JSON_LITERALS = ['true', 'false', 'null'];
const JSON_NUMBER_PATTERN = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const JSON_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't']);

// Walks the text with JSON's grammar and returns where the first error is, or null when it is valid.
export function findJsonError(text: string): JsonScanError | null {
    let index = 0;

    const describe = (): string => index >= text.length ? 'end of input' : `'${text[index]}'`;
    const fail = (expected: string): never => {
        throw new JsonScanFailure(index, `Expected ${expected} but found ${describe()}.`);
    };
    const skipWhitespace = (): void => {
        while (index < text.length && JSON_WHITESPACE.has(text[index] ?? '')) {
            index += 1;
        }
    };

    const scanString = (): void => {
        index += 1;

        while (index < text.length) {
            const character = text[index] ?? '';

            if (character === '"') {
                index += 1;

                return;
            }

            if (character === '\\') {
                const escaped = text[index + 1] ?? '';

                if (escaped === 'u') {
                    if (!/^[0-9a-fA-F]{4}$/.test(text.slice(index + 2, index + 6))) {
                        index += 1;
                        fail('a \\u escape with four hex digits');
                    }

                    index += 6;
                    continue;
                }

                if (!JSON_ESCAPES.has(escaped)) {
                    index += 1;
                    fail('a valid escape character');
                }

                index += 2;
                continue;
            }

            if (character < ' ') {
                fail('a closing quote; control characters must be escaped');
            }

            index += 1;
        }

        fail('a closing quote');
    };

    const scanValue = (): void => {
        skipWhitespace();
        const character = text[index] ?? '';

        if (character === '{') {
            scanObject();

            return;
        }

        if (character === '[') {
            scanArray();

            return;
        }

        if (character === '"') {
            scanString();

            return;
        }

        const literal = JSON_LITERALS.find((candidate) => text.startsWith(candidate, index));

        if (literal != null) {
            index += literal.length;

            return;
        }

        JSON_NUMBER_PATTERN.lastIndex = index;
        const number = JSON_NUMBER_PATTERN.exec(text);

        if (number != null && number[0] !== '' && number[0] !== '-') {
            index += number[0].length;

            return;
        }

        fail('a value');
    };

    const scanObject = (): void => {
        index += 1;
        skipWhitespace();

        if (text[index] === '}') {
            index += 1;

            return;
        }

        for (;;) {
            skipWhitespace();

            if (text[index] !== '"') {
                fail('a double-quoted property name');
            }

            scanString();
            skipWhitespace();

            if (text[index] !== ':') {
                fail('\':\' after the property name');
            }

            index += 1;
            scanValue();
            skipWhitespace();

            if (text[index] === ',') {
                index += 1;
                continue;
            }

            if (text[index] === '}') {
                index += 1;

                return;
            }

            fail('\',\' or \'}\' after the property value');
        }
    };

    const scanArray = (): void => {
        index += 1;
        skipWhitespace();

        if (text[index] === ']') {
            index += 1;

            return;
        }

        for (;;) {
            scanValue();
            skipWhitespace();

            if (text[index] === ',') {
                index += 1;
                continue;
            }

            if (text[index] === ']') {
                index += 1;

                return;
            }

            fail('\',\' or \']\' after the array item');
        }
    };

    try {
        scanValue();
        skipWhitespace();

        if (index < text.length) {
            fail('end of input after the value');
        }

        return null;
    }
    catch (error) {
        if (error instanceof JsonScanFailure) {
            return { offset: error.offset, message: error.message };
        }

        throw error;
    }
}
