// Checks a document against a pasted JSON Schema without generating code,
// because the extension's content security policy blocks `eval` and `new Function`.
import { Validator, type OutputUnit, type Schema } from '@cfworker/json-schema';
import { errorMessage } from '../errorMessage.js';

export interface SchemaMatch {
    readonly ok: true;
    readonly keywordsChecked: number;
}

export interface SchemaError {
    readonly ok: false;
    readonly errors: ReadonlyArray<SchemaErrorEntry>;
}

export interface SchemaInvalid {
    readonly ok: false;
    readonly message: string;
}

export interface SchemaErrorEntry {
    readonly path: string;
    readonly message: string;
    readonly keyword: string;
}

export type SchemaCheckResult = SchemaMatch | SchemaError | SchemaInvalid;

// Errors under these keywords only say that a subschema failed; the subschema's own errors follow them.
const SUBSCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
    '$ref',
    '$recursiveRef',
    'properties',
    'patternProperties',
    'additionalProperties',
    'unevaluatedProperties',
    'prefixItems',
    'items',
    'additionalItems',
    'unevaluatedItems',
    'allOf',
    'if',
    'dependentSchemas',
]);

const TYPE_MESSAGE = /^Instance type "([^"]+)" is invalid\. Expected "(.+)"\.$/;
const REQUIRED_MESSAGE = /^Instance does not have required property "(.+)"\.$/;
const UNRESOLVED_REFERENCE_MESSAGE = /^Unresolved \$ref "([^"]*)"/;

export type SchemaParseResult =
    | { readonly ok: true; readonly schema: Schema | boolean }
    | SchemaInvalid;

export function checkSchema(value: unknown, schemaText: string): SchemaCheckResult {
    const parsed = parseSchemaText(schemaText);

    if (!parsed.ok) {
        return parsed;
    }

    const { schema } = parsed;
    let units: OutputUnit[];

    try {
        const result = new Validator(schema, '2020-12', false).validate(value);

        if (result.valid) {
            return {
                ok: true,
                keywordsChecked: typeof schema === 'boolean' ? 0 : countKeywords(schema),
            };
        }

        units = result.errors;
    }
    catch (error) {
        return { ok: false, message: toFailureMessage(error) };
    }

    return { ok: false, errors: toEntries(units) };
}

// Reads pasted schema text; a schema is a JSON object, `true` or `false`.
export function parseSchemaText(schemaText: string): SchemaParseResult {
    let schema: unknown;

    try {
        schema = JSON.parse(schemaText);
    }
    catch (error) {
        const message = errorMessage(error, 'Invalid JSON schema.');

        return { ok: false, message };
    }

    if (typeof schema !== 'boolean' && !isPlainObject(schema)) {
        return { ok: false, message: 'A schema must be a JSON object, true or false.' };
    }

    return { ok: true, schema: schema as Schema | boolean };
}

// Names the reference rather than the validator's internal base URI, and drops its list of known schemas.
export function toFailureMessage(error: unknown): string {
    const text = errorMessage(error, 'Could not check the schema.');
    const reference = UNRESOLVED_REFERENCE_MESSAGE.exec(text);

    if (reference != null) {
        return unresolvedReferenceMessage(reference[1] ?? '');
    }

    return text.split('\n')[0]!.trim();
}

export function unresolvedReferenceMessage(reference: string): string {
    return `Cannot resolve $ref "${reference}"; only references within this schema work.`;
}

// Keeps the errors that say what is wrong, with readable messages, once each.
function toEntries(units: ReadonlyArray<OutputUnit>): SchemaErrorEntry[] {
    const propertyNameLocations = units
        .filter((unit) => unit.keyword === 'propertyNames')
        .map((unit) => `${unit.keywordLocation}/`);
    const entries: SchemaErrorEntry[] = [];
    const seen = new Set<string>();

    for (const unit of units) {
        if (SUBSCHEMA_KEYWORDS.has(unit.keyword)) {
            continue;
        }

        // A property name check already names the key; its subschema errors would point at the value instead.
        if (propertyNameLocations.some((location) => unit.keywordLocation.startsWith(location))) {
            continue;
        }

        const entry = {
            path: toPath(unit.instanceLocation),
            message: toMessage(unit),
            keyword: unit.keyword,
        };
        const key = `${entry.path}\n${entry.message}`;

        if (!seen.has(key)) {
            seen.add(key);
            entries.push(entry);
        }
    }

    return entries;
}

// Turns `#/orders/0` into `$/orders/0`; keys stay JSON Pointer escaped, without the URI encoding.
function toPath(instanceLocation: string): string {
    const pointer = instanceLocation.startsWith('#') ? instanceLocation.slice(1) : instanceLocation;

    try {
        return `$${decodeURI(pointer)}`;
    }
    catch {
        return `$${pointer}`;
    }
}

function toMessage(unit: OutputUnit): string {
    const message = unit.error.replace(/\s+/g, ' ').trim();
    const type = TYPE_MESSAGE.exec(message);

    if (type != null) {
        return `Expected ${type[2]!.split('", "').join(' or ')}, found ${type[1]}.`;
    }

    const required = REQUIRED_MESSAGE.exec(message);

    if (required != null) {
        return `Missing required property "${required[1]}".`;
    }

    if (unit.keyword === 'false') {
        return 'Not allowed by the schema.';
    }

    return message.replace(/^Instance /, 'Value ');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

function countKeywords(schema: Record<string, unknown>): number {
    let count = 0;

    for (const key of Object.keys(schema)) {
        if (key.startsWith('$')) {
            continue;
        }

        count += 1;

        const value = schema[key];

        if (isPlainObject(value)) {
            count += countKeywords(value);
        }
    }

    return count;
}
