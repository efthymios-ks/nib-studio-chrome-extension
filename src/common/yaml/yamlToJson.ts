import { isScalar, Scalar, visit, type Document } from 'yaml';
import { encodeBase64Bytes } from '../encoding/base64.js';
import { errorMessage } from '../errorMessage.js';
import { jsonTreeOf, type DataFormat, type JsonParseResult } from '../json/jsonTree.js';
import {
    failure,
    firstAlias,
    firstYamlError,
    parseYamlStream,
    type YamlFailure,
    type YamlStream,
} from './yamlParser.js';

// YAML as JSON data: one document is its value, several are an array of their values, and none is null.
// Anchors and aliases are resolved, timestamps stay text, keys become strings and binary becomes Base64.

// How far aliases may expand an anchor: the copies of each anchor, multiplied through nested aliases.
// A billion-laughs document passes it within a few levels and stops; ordinary reuse of an anchor stays well under it.
const YAML_MAX_ALIAS_COUNT = 1000;

export type YamlJsonValue = null | boolean | number | string | YamlJsonValue[] | { [key: string]: YamlJsonValue };

export interface YamlToJsonSuccess {
    readonly ok: true;
    readonly value: YamlJsonValue;
    // How many documents the text holds; more than one makes the value an array of them.
    readonly documentCount: number;
}

export type YamlToJsonResult = YamlToJsonSuccess | YamlFailure;

const TOO_MANY_ALIASES = 'Too many aliases: they expand an anchor to more than '
    + `${YAML_MAX_ALIAS_COUNT.toLocaleString('en-US')} copies`;

const UNREADABLE = 'Could not read this YAML';

const NON_FINITE_NUMBERS: ReadonlyArray<readonly [(value: number) => boolean, string]> = [
    [(value) => Number.isNaN(value), 'NaN'],
    [(value) => value === Infinity, 'Infinity'],
    [(value) => value === -Infinity, '-Infinity'],
];

export function convertYamlToJson(text: string): YamlToJsonResult {
    return convertYamlStream(parseYamlStream(text));
}

// The stream's data, or why it has none: its first error, or an alias that can't be expanded.
export function convertYamlStream(stream: YamlStream): YamlToJsonResult {
    const error = firstYamlError(stream);

    if (error != null) {
        return error;
    }

    const values: YamlJsonValue[] = [];

    for (const document of stream.documents) {
        const converted = convertDocument(document, stream);

        if (!converted.ok) {
            return converted;
        }

        values.push(converted.value);
    }

    if (values.length === 1) {
        return { ok: true, value: values[0] ?? null, documentCount: 1 };
    }

    return { ok: true, value: values.length === 0 ? null : values, documentCount: values.length };
}

type DocumentResult = { readonly ok: true; readonly value: YamlJsonValue } | YamlFailure;

function convertDocument(document: Document.Parsed, stream: YamlStream): DocumentResult {
    stringifyScalarKeys(document);
    let native: unknown;

    try {
        native = document.toJS({ maxAliasCount: YAML_MAX_ALIAS_COUNT });
    }
    catch (error) {
        // The parser reports unresolved aliases already, so a reference error here is the expansion limit.
        const message = error instanceof ReferenceError ? TOO_MANY_ALIASES : errorMessage(error, UNREADABLE);

        return failureAtFirstAlias(document, stream, message);
    }

    try {
        return { ok: true, value: toJsonValue(native, new Set()) };
    }
    catch (error) {
        return failureAtFirstAlias(document, stream, errorMessage(error, UNREADABLE));
    }
}

// What goes wrong in expanding aliases is reported at the document's first alias.
function failureAtFirstAlias(document: Document.Parsed, stream: YamlStream, message: string): YamlFailure {
    const alias = firstAlias(document);
    const position = stream.lineCounter.linePos(alias?.range[0] ?? document.range[0]);

    return failure(message, { line: position.line, column: position.col });
}

// Keys that are numbers, booleans or null become strings as they were written, such as `0x1F` or `true`;
// a null key, `~` or empty, becomes `null`.
function stringifyScalarKeys(document: Document.Parsed): void {
    visit(document, {
        Pair: (_key, pair) => {
            const key = pair.key;

            // A merge key `<<` holds a symbol and stays as it is.
            if (!isScalar(key) || typeof key.value === 'string' || typeof key.value === 'symbol') {
                return;
            }

            const written = key.value === null ? 'null' : (key as Scalar.Parsed).source ?? String(key.value);
            pair.key = new Scalar(written);
        },
    });
}

// Turns what `toJS` gives into plain JSON values, following each object once along a path,
// since an alias inside its own anchor makes a cycle JSON can't hold.
function toJsonValue(value: unknown, ancestors: Set<object>): YamlJsonValue {
    if (value == null || typeof value === 'boolean' || typeof value === 'string') {
        return value ?? null;
    }

    if (typeof value === 'number') {
        const named = NON_FINITE_NUMBERS.find(([matches]) => matches(value));

        return named == null ? value : named[1];
    }

    if (typeof value === 'bigint') {
        return Number(value);
    }

    if (value instanceof Uint8Array) {
        return encodeBase64Bytes(value);
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof value !== 'object') {
        return String(value);
    }

    if (ancestors.has(value)) {
        throw new Error('An alias refers to the node it sits in, which JSON can\'t hold');
    }

    ancestors.add(value);

    try {
        return convertContainer(value, ancestors);
    }
    finally {
        ancestors.delete(value);
    }
}

function convertContainer(value: object, ancestors: Set<object>): YamlJsonValue {
    if (Array.isArray(value) || value instanceof Set) {
        return [...value].map((item) => toJsonValue(item, ancestors));
    }

    const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
    const result: { [key: string]: YamlJsonValue } = {};

    for (const [key, item] of entries) {
        // Defined rather than assigned, so a key such as `__proto__` stays an ordinary key.
        Object.defineProperty(result, String(key), {
            value: toJsonValue(item, ancestors),
            writable: true,
            enumerable: true,
            configurable: true,
        });
    }

    return result;
}

// YAML read as JSON data, for the views that show or query data: the tree, JSONPath, Schema and the diff.
export function parseYamlAsJson(text: string): JsonParseResult {
    const converted = convertYamlToJson(text);

    if (!converted.ok) {
        return converted;
    }

    return { ok: true, value: converted.value, root: jsonTreeOf(converted.value) };
}

export const YAML_DATA_FORMAT: DataFormat = Object.freeze({
    name: 'YAML',
    parse: parseYamlAsJson,
});
