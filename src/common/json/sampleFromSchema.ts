// Builds a sample document that a JSON Schema (Draft 2020-12) accepts, from the schema alone.
// The sample is checked against the schema afterwards, and every keyword it still fails is reported, never hidden.
import { deepCompareStrict, dereference, format, validate, type Schema } from '@cfworker/json-schema';
import { JsonPathBuilder } from '../paths/jsonPathBuilder.js';
import { jsonPointerSegments } from './jsonPath.js';
import {
    checkSchema,
    parseSchemaText,
    toFailureMessage,
    unresolvedReferenceMessage,
    type SchemaErrorEntry,
} from './jsonSchema.js';

export interface SampleOptions {
    // Objects get only their required properties.
    readonly isRequiredOnly?: boolean;
}

// A keyword the sample doesn't satisfy, such as a `pattern` too complex to build a match for.
export interface SampleNote {
    // The JSONPath of the value, such as `$.code`.
    readonly path: string;
    readonly keyword: string;
    // Such as "`pattern` at `$.code` not satisfied; edit the value".
    readonly message: string;
}

export type SampleResult =
    | { readonly ok: true; readonly value: unknown; readonly notes: ReadonlyArray<SampleNote> }
    | { readonly ok: false; readonly message: string };

// From this depth on, objects keep only their required properties and arrays their minimum length,
// so a recursive schema ends.
export const SAMPLE_DEPTH = 8;

// At this depth objects and arrays stay empty even where the schema asks for more; the check then reports it.
const MAX_SAMPLE_DEPTH = SAMPLE_DEPTH * 2;

// How many different values are tried to keep the items of a `uniqueItems` array apart.
const MAX_VARIANTS = 24;

// Strings tried, in order, when no `format` or `pattern` gives a better one.
const WORDS: ReadonlyArray<string> = [
    'string',
    ...Array.from({ length: MAX_VARIANTS }, (_, index) => `string${index + 2}`),
    'a',
    'abc',
    'A',
    'ABC',
    '0',
    '1',
    '123',
    'abc123',
    'example',
    'x',
    '-',
    '_',
];

// A fixed, valid value for each format, and further distinct ones for `uniqueItems`.
const FORMAT_SAMPLES: Readonly<Record<string, (variant: number) => string>> = Object.freeze({
    'date-time': (variant: number) => `2024-01-01T12:00:${twoDigits(variant % 60)}Z`,
    'date': (variant: number) => `2024-01-${twoDigits(1 + (variant % 28))}`,
    'time': (variant: number) => `12:00:${twoDigits(variant % 60)}Z`,
    'email': (variant: number) => (variant === 0 ? 'user@example.com' : `user${variant + 1}@example.com`),
    'idn-email': (variant: number) => (variant === 0 ? 'user@example.com' : `user${variant + 1}@example.com`),
    'uri': exampleUrl,
    'url': exampleUrl,
    'iri': exampleUrl,
    'uri-reference': exampleUrl,
    'iri-reference': exampleUrl,
    'uri-template': (variant: number) => (variant === 0 ? 'https://example.com/{id}' : `https://example.com/${variant + 1}/{id}`),
    'uuid': (variant: number) => `123e4567-e89b-42d3-a456-${String(426614174000 + variant).padStart(12, '0')}`,
    'hostname': exampleHost,
    'idn-hostname': exampleHost,
    'ipv4': (variant: number) => `192.0.2.${1 + (variant % 254)}`,
    'ipv6': (variant: number) => `2001:db8::${(1 + variant).toString(16)}`,
    'duration': (variant: number) => `P${1 + variant}D`,
    'json-pointer': (variant: number) => (variant === 0 ? '/example' : `/example/${variant}`),
    'relative-json-pointer': (variant: number) => String(variant),
    'regex': (variant: number) => (variant === 0 ? '^[a-z]+$' : `^[a-z]{${variant}}$`),
});

// Keywords that describe a schema without constraining its values.
const ANNOTATIONS: ReadonlySet<string> = new Set(['$id', '$anchor', '$comment', 'title', 'description', 'deprecated', 'readOnly', 'writeOnly']);

type JsonType = 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean' | 'null';

type SchemaObject = Record<string, unknown>;

const JSON_TYPES: ReadonlyArray<JsonType> = ['object', 'array', 'string', 'integer', 'number', 'boolean', 'null'];

// Keywords that imply a type when a schema has no `type`, looked for in this order; with none of them, a value is an object.
const IMPLIED_TYPES: ReadonlyArray<readonly [JsonType, ReadonlyArray<string>]> = [
    ['object', ['properties', 'required', 'additionalProperties', 'patternProperties', 'minProperties', 'maxProperties', 'propertyNames']],
    ['array', ['items', 'prefixItems', 'contains', 'minItems', 'maxItems', 'uniqueItems']],
    ['string', ['pattern', 'format', 'minLength', 'maxLength']],
    ['number', ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf']],
];

interface Sample {
    readonly value: unknown;
}

// Where a value goes: how deep it sits, and which of its possible values to take, counted from 0.
interface Place {
    readonly depth: number;
    readonly variant: number;
}

// An `anyOf` or `oneOf` still to choose a branch of.
interface Choice {
    readonly key: string;
    readonly branches: ReadonlyArray<unknown>;
}

// An `if` / `then` / `else`, or a `dependentSchemas` entry, still to apply.
interface Condition {
    readonly key: string;
    readonly applies: (value: unknown) => boolean;
    readonly then: unknown;
    readonly else: unknown;
}

export function sampleFromSchema(schemaText: string, options: SampleOptions = {}): SampleResult {
    const parsed = parseSchemaText(schemaText);

    if (!parsed.ok) {
        return parsed;
    }

    if (parsed.schema === false) {
        return { ok: false, message: 'The schema is false, so no value can match it.' };
    }

    let sample: Sample | null;

    try {
        sample = new SampleBuilder(parsed.schema, options).build();
    }
    catch (error) {
        return { ok: false, message: toFailureMessage(error) };
    }

    if (sample == null) {
        return { ok: false, message: 'No value can match this schema.' };
    }

    const check = checkSchema(sample.value, schemaText);

    if (check.ok) {
        return { ok: true, value: sample.value, notes: [] };
    }

    if ('message' in check) {
        return { ok: false, message: check.message };
    }

    return { ok: true, value: sample.value, notes: toNotes(check.errors, sample.value) };
}

class SampleBuilder {
    private readonly lookup: Record<string, Schema | boolean>;
    // Numbers schema objects, so a chosen branch or an applied condition is recorded once per object.
    private readonly ids = new WeakMap<object, number>();
    private lastId = 0;

    constructor(private readonly root: Schema | boolean, private readonly options: SampleOptions) {
        this.lookup = dereference(root);
    }

    build(): Sample | null {
        return this.sampleOf([this.root], { depth: 0, variant: 0 });
    }

    // A value every one of these schemas accepts, or null when none can.
    private sampleOf(schemas: ReadonlyArray<unknown>, place: Place): Sample | null {
        const objects = this.flatten(schemas);

        return objects == null ? null : this.solve(objects, schemas, new Set(), place);
    }

    // The schema objects that apply to one value: each schema with its `$ref` target and its `allOf` entries, once each.
    // Null when a `false` schema applies, so no value can match.
    private flatten(schemas: ReadonlyArray<unknown>): SchemaObject[] | null {
        const objects: SchemaObject[] = [];
        let isFalse = false;

        const visit = (schema: unknown): void => {
            if (schema === false) {
                isFalse = true;

                return;
            }

            if (!isPlainObject(schema) || objects.includes(schema)) {
                return;
            }

            objects.push(schema);
            const target = this.referenceOf(schema);

            if (target !== undefined) {
                visit(target);
            }

            if (Array.isArray(schema['allOf'])) {
                schema['allOf'].forEach(visit);
            }
        };

        schemas.forEach(visit);

        return isFalse ? null : objects;
    }

    // Follows `$ref` the way the validator does, so both agree on what a reference points at.
    private referenceOf(schema: SchemaObject): unknown {
        const reference = schema['$ref'];

        if (typeof reference !== 'string') {
            return undefined;
        }

        const target = this.lookup[(schema as Schema).__absolute_ref__ ?? reference];

        if (target === undefined) {
            throw new Error(unresolvedReferenceMessage(reference));
        }

        return target;
    }

    // Chooses `anyOf` / `oneOf` branches and applies conditions one at a time, then builds from what applies.
    private solve(objects: SchemaObject[], schemas: ReadonlyArray<unknown>, handled: ReadonlySet<string>, place: Place): Sample | null {
        const choice = this.pendingChoice(objects, handled);

        if (choice != null) {
            return this.solveChoice(choice, objects, schemas, handled, place);
        }

        const conditions = this.pendingConditions(objects, handled);

        if (conditions.length > 0) {
            return this.solveConditions(conditions, objects, schemas, handled, place);
        }

        return this.fromKeywords(objects, schemas, place);
    }

    // The first branch whose sample the whole schema accepts; `oneOf` thereby gets a value only one branch accepts.
    private solveChoice(
        choice: Choice,
        objects: SchemaObject[],
        schemas: ReadonlyArray<unknown>,
        handled: ReadonlySet<string>,
        place: Place,
    ): Sample | null {
        const done = new Set(handled).add(choice.key);
        let fallback: Sample | null = null;

        for (const branch of choice.branches) {
            const branchObjects = this.flatten([branch]);

            if (branchObjects == null) {
                continue;
            }

            const sample = this.solve(merge(objects, branchObjects), schemas, done, place);

            if (sample == null) {
                continue;
            }

            if (this.accepts(schemas, sample.value)) {
                return sample;
            }

            fallback ??= sample;
        }

        return fallback;
    }

    // Builds a sample without the conditions, then again with the `then` of each whose `if` it satisfies, or its `else`.
    private solveConditions(
        conditions: ReadonlyArray<Condition>,
        objects: SchemaObject[],
        schemas: ReadonlyArray<unknown>,
        handled: ReadonlySet<string>,
        place: Place,
    ): Sample | null {
        const done = new Set(handled);
        conditions.forEach((condition) => done.add(condition.key));
        const base = this.solve(objects, schemas, done, place);

        if (base == null) {
            return null;
        }

        let applied = objects;

        for (const condition of conditions) {
            const branch = condition.applies(base.value) ? condition.then : condition.else;
            const branchObjects = branch === undefined ? null : this.flatten([branch]);

            if (branchObjects != null) {
                applied = merge(applied, branchObjects);
            }
        }

        return applied === objects ? base : this.solve(applied, schemas, done, place) ?? base;
    }

    private pendingChoice(objects: ReadonlyArray<SchemaObject>, handled: ReadonlySet<string>): Choice | null {
        for (const object of objects) {
            for (const keyword of ['anyOf', 'oneOf']) {
                const branches = object[keyword];
                const key = `${this.idOf(object)}:${keyword}`;

                if (Array.isArray(branches) && branches.length > 0 && !handled.has(key)) {
                    return { key, branches };
                }
            }
        }

        return null;
    }

    private pendingConditions(objects: ReadonlyArray<SchemaObject>, handled: ReadonlySet<string>): Condition[] {
        const conditions: Condition[] = [];

        for (const object of objects) {
            const id = this.idOf(object);

            if (object['if'] !== undefined && (object['then'] !== undefined || object['else'] !== undefined)) {
                const test = object['if'];
                conditions.push({ key: `${id}:if`, applies: (value) => this.accepts([test], value), then: object['then'], else: object['else'] });
            }

            for (const keyword of ['dependentSchemas', 'dependencies']) {
                for (const [name, schema] of Object.entries(asObject(object[keyword]))) {
                    if (!Array.isArray(schema)) {
                        conditions.push({ key: `${id}:${keyword}:${name}`, applies: (value) => hasOwn(value, name), then: schema, else: undefined });
                    }
                }
            }
        }

        return conditions.filter((condition) => !handled.has(condition.key));
    }

    // `const`, `examples`, `default` and `enum` values come first when the schema accepts them; otherwise a value of its type.
    private fromKeywords(objects: ReadonlyArray<SchemaObject>, schemas: ReadonlyArray<unknown>, place: Place): Sample | null {
        const consts = objects.filter((object) => hasOwn(object, 'const')).map((object) => object['const']);
        const enums = objects.flatMap((object) => (Array.isArray(object['enum']) ? object['enum'] as unknown[] : []));
        const listed = [
            ...consts,
            ...objects.flatMap((object) => (Array.isArray(object['examples']) ? object['examples'] as unknown[] : [])),
            ...objects.filter((object) => hasOwn(object, 'default')).map((object) => object['default']),
            ...enums,
        ];
        const accepted: unknown[] = [];

        for (const value of listed) {
            if (accepted.length > place.variant) {
                break;
            }

            if (!accepted.some((known) => deepCompareStrict(known, value)) && this.accepts(schemas, value)) {
                accepted.push(value);
            }
        }

        if (place.variant < accepted.length) {
            return { value: copyJson(accepted[place.variant]) };
        }

        const isRestricted = consts.length > 0 || objects.some((object) => Array.isArray(object['enum']));

        if (isRestricted) {
            // Only the listed values can match, so one is taken even when other keywords reject it; the check reports that.
            const pool = accepted.length > 0 ? accepted : [...consts, ...enums];

            return pool.length === 0 ? null : { value: copyJson(pool[place.variant % pool.length]) };
        }

        return this.fromType(objects, schemas, { ...place, variant: place.variant - accepted.length });
    }

    // A type array takes its first type that isn't `null`, and `null` only when nothing else is allowed or works.
    private fromType(objects: ReadonlyArray<SchemaObject>, schemas: ReadonlyArray<unknown>, place: Place): Sample | null {
        const types = allowedTypes(objects);

        if (types != null && types.length === 0) {
            return null;
        }

        const order = types == null
            ? [impliedType(objects)]
            : [...types.filter((type) => type !== 'null'), ...types.filter((type) => type === 'null')];
        let fallback: Sample | null = null;

        for (const type of order) {
            const sample = this.ofType(type, objects, place);

            if (order.length === 1 || this.accepts(schemas, sample.value)) {
                return sample;
            }

            fallback ??= sample;
        }

        return fallback;
    }

    private ofType(type: JsonType, objects: ReadonlyArray<SchemaObject>, place: Place): Sample {
        if (type === 'null') {
            return { value: null };
        }

        if (type === 'boolean') {
            return { value: place.variant % 2 === 0 };
        }

        if (type === 'integer' || type === 'number') {
            return { value: numberSample(objects, type === 'integer', place.variant) };
        }

        if (type === 'string') {
            return { value: stringSample(objects, place.variant) };
        }

        return type === 'array' ? this.arraySample(objects, place) : this.objectSample(objects, place);
    }

    private objectSample(objects: ReadonlyArray<SchemaObject>, place: Place): Sample {
        const value: Record<string, unknown> = {};

        if (place.depth >= MAX_SAMPLE_DEPTH) {
            return { value };
        }

        const isMinimal = this.options.isRequiredOnly === true || place.depth >= SAMPLE_DEPTH;
        const declared = unique(objects.flatMap((object) => Object.keys(asObject(object['properties']))));
        const required = unique(objects.flatMap((object) => stringList(object['required'])));
        const keys = [
            ...declared.filter((key) => !isMinimal || required.includes(key)),
            ...required.filter((key) => !declared.includes(key)),
        ];

        // A present key brings the keys `dependentRequired` lists for it; the loop also visits keys added along the way.
        for (const key of keys) {
            for (const dependent of dependentKeys(objects, key)) {
                if (!keys.includes(dependent)) {
                    keys.push(dependent);
                }
            }
        }

        keys.forEach((key, index) => {
            this.addProperty(value, key, objects, { depth: place.depth + 1, variant: index === 0 ? place.variant : 0 });
        });
        this.fillMinProperties(value, objects, declared, place);
        trimToMaxProperties(value, objects, required);

        return { value };
    }

    private addProperty(target: Record<string, unknown>, key: string, objects: ReadonlyArray<SchemaObject>, place: Place): void {
        const schemas = schemasForKey(objects, key);
        const applied = this.flatten(schemas);

        if (applied == null) {
            return;
        }

        // A required key that neither `properties`, `patternProperties` nor `additionalProperties` describes gets a string.
        const isDeclared = objects.some((object) => hasOwn(object['properties'], key)
            || Object.keys(asObject(object['patternProperties'])).some((pattern) => matchesPattern(pattern, key)));
        const isUndescribed = !isDeclared && applied.every((object) => Object.keys(object).every((keyword) => ANNOTATIONS.has(keyword)));
        const sample = isUndescribed ? { value: 'string' } : this.solve(applied, schemas, new Set(), place);

        if (sample != null) {
            setProperty(target, key, sample.value);
        }
    }

    // Adds optional properties, then keys for `patternProperties`, then extra keys where `additionalProperties` allows them.
    private fillMinProperties(
        value: Record<string, unknown>,
        objects: ReadonlyArray<SchemaObject>,
        declared: ReadonlyArray<string>,
        place: Place,
    ): void {
        const minimum = largest(objects, 'minProperties') ?? 0;
        const child = { depth: place.depth + 1, variant: 0 };
        const isShort = (): boolean => Object.keys(value).length < minimum;

        for (const key of declared) {
            if (isShort() && !hasOwn(value, key)) {
                this.addProperty(value, key, objects, child);
            }
        }

        const patterns = unique(objects.flatMap((object) => Object.keys(asObject(object['patternProperties']))));

        for (const pattern of patterns) {
            for (let variant = 0; variant < MAX_VARIANTS && isShort(); variant += 1) {
                const key = stringSample([{ pattern }], variant);

                if (!hasOwn(value, key) && matchesPattern(pattern, key)) {
                    this.addProperty(value, key, objects, child);
                }
            }
        }

        // Extra keys are `property1`, `property2` and so on, or else names built from `propertyNames`.
        const names = objects.flatMap((object) => (object['propertyNames'] === undefined ? [] : [object['propertyNames']]));

        for (let number = 1; number <= MAX_VARIANTS && isShort(); number += 1) {
            const named = this.accepts(names, `property${number}`) ? null : this.sampleOf([{ type: 'string' }, ...names], { ...child, variant: number - 1 });
            const key = named == null ? `property${number}` : named.value;

            if (typeof key === 'string' && !hasOwn(value, key) && this.accepts(names, key)) {
                this.addProperty(value, key, objects, child);
            }
        }
    }

    // `prefixItems` then `items`, `max(minItems, 1)` long, or as long as the prefix, and never past `maxItems`.
    // An array that says nothing about its items gets only the `minItems` it needs.
    private arraySample(objects: ReadonlyArray<SchemaObject>, place: Place): Sample {
        const items: unknown[] = [];

        if (place.depth >= MAX_SAMPLE_DEPTH) {
            return { value: items };
        }

        const minItems = largest(objects, 'minItems') ?? 0;
        const maxItems = smallest(objects, 'maxItems') ?? Number.POSITIVE_INFINITY;
        const prefixLength = Math.max(0, ...objects.map((object) => prefixOf(object).length));
        const hasItemSchemas = objects.some((object) => object['items'] !== undefined || object['prefixItems'] !== undefined);
        const isMinimal = place.depth >= SAMPLE_DEPTH || !hasItemSchemas;
        const wanted = isMinimal ? minItems : Math.max(minItems, prefixLength, 1);
        const isUnique = objects.some((object) => object['uniqueItems'] === true);

        for (let index = 0; index < Math.min(wanted, maxItems); index += 1) {
            const sample = this.itemSample({ objects, items, index, isUnique, place, extra: [] });

            if (sample == null) {
                break;
            }

            items.push(sample.value);
        }

        this.satisfyContains(objects, items, { prefixLength, maxItems, isUnique, place });

        return { value: items };
    }

    // An item for this index, different from the others when the items must be unique.
    private itemSample(request: {
        readonly objects: ReadonlyArray<SchemaObject>;
        readonly items: ReadonlyArray<unknown>;
        readonly index: number;
        readonly isUnique: boolean;
        readonly place: Place;
        readonly extra: ReadonlyArray<unknown>;
    }): Sample | null {
        const { items, index, place } = request;
        const schemas = [...schemasForIndex(request.objects, index), ...request.extra];
        const first = index === 0 ? place.variant : 0;
        let duplicate: Sample | null = null;

        for (let variant = first; variant < first + MAX_VARIANTS; variant += 1) {
            const sample = this.sampleOf(schemas, { depth: place.depth + 1, variant });

            if (sample == null) {
                return duplicate;
            }

            const isDuplicate = items.some((item, position) => position !== index && deepCompareStrict(item, sample.value));

            if (!request.isUnique || !isDuplicate) {
                return sample;
            }

            duplicate ??= sample;
        }

        return duplicate;
    }

    // Replaces or adds items until `minContains` of them (1 by default) match `contains`, keeping the prefix items last to change.
    private satisfyContains(
        objects: ReadonlyArray<SchemaObject>,
        items: unknown[],
        limits: { readonly prefixLength: number; readonly maxItems: number; readonly isUnique: boolean; readonly place: Place },
    ): void {
        const contains = objects.flatMap((object) => (object['contains'] === undefined ? [] : [object['contains']]));

        if (contains.length === 0) {
            return;
        }

        const needed = largest(objects, 'minContains') ?? 1;
        const matches = (item: unknown): boolean => this.accepts(contains, item);
        let count = items.filter(matches).length;

        for (let attempt = 0; count < needed && attempt <= needed + items.length; attempt += 1) {
            const misses = [...items.keys()].filter((index) => !matches(items[index])).reverse();
            const positions = [
                ...misses.filter((index) => index >= limits.prefixLength),
                ...(items.length < limits.maxItems ? [items.length] : []),
                ...misses.filter((index) => index < limits.prefixLength),
            ];
            const position = positions.find((index) => {
                const sample = this.itemSample({ objects, items, index, isUnique: limits.isUnique, place: limits.place, extra: contains });

                if (sample == null || !matches(sample.value)) {
                    return false;
                }

                items[index] = sample.value;

                return true;
            });

            if (position == null) {
                return;
            }

            count = items.filter(matches).length;
        }
    }

    // True when every schema accepts the value; a reference the validator can't follow counts as a rejection.
    private accepts(schemas: ReadonlyArray<unknown>, value: unknown): boolean {
        return schemas.every((schema) => {
            if (typeof schema !== 'boolean' && !isPlainObject(schema)) {
                return true;
            }

            try {
                return validate(value, schema as Schema | boolean, '2020-12', this.lookup, true).valid;
            }
            catch {
                return false;
            }
        });
    }

    private idOf(object: object): number {
        let id = this.ids.get(object);

        if (id == null) {
            this.lastId += 1;
            id = this.lastId;
            this.ids.set(object, id);
        }

        return id;
    }
}

// The values every object's `type` allows, `integer` counting as a `number`; null when no object has a `type`.
function allowedTypes(objects: ReadonlyArray<SchemaObject>): JsonType[] | null {
    let allowed: JsonType[] | null = null;

    for (const object of objects) {
        const declared = typeList(object['type']);

        if (declared != null) {
            allowed = allowed == null ? declared : intersectTypes(allowed, declared);
        }
    }

    return allowed;
}

function typeList(type: unknown): JsonType[] | null {
    if (typeof type === 'string') {
        return JSON_TYPES.filter((known) => known === type);
    }

    if (Array.isArray(type)) {
        return unique(type.filter((name): name is JsonType => JSON_TYPES.includes(name as JsonType)));
    }

    return null;
}

function intersectTypes(left: ReadonlyArray<JsonType>, right: ReadonlyArray<JsonType>): JsonType[] {
    const both = left.flatMap((type): JsonType[] => {
        if (right.includes(type)) {
            return [type];
        }

        const isNumeric = (type === 'number' && right.includes('integer')) || (type === 'integer' && right.includes('number'));

        return isNumeric ? ['integer'] : [];
    });

    return unique(both);
}

function impliedType(objects: ReadonlyArray<SchemaObject>): JsonType {
    const match = IMPLIED_TYPES.find(([, keywords]) => objects.some((object) => keywords.some((keyword) => object[keyword] !== undefined)));

    return match?.[0] ?? 'object';
}

// The schemas a property follows: its `properties` entries and matching `patternProperties`,
// or else `additionalProperties`, object by object as the validator applies them.
function schemasForKey(objects: ReadonlyArray<SchemaObject>, key: string): unknown[] {
    const schemas: unknown[] = [];

    for (const object of objects) {
        const properties = asObject(object['properties']);
        let isMatched = hasOwn(properties, key);

        if (isMatched) {
            schemas.push(properties[key]);
        }

        for (const [pattern, schema] of Object.entries(asObject(object['patternProperties']))) {
            if (matchesPattern(pattern, key)) {
                schemas.push(schema);
                isMatched = true;
            }
        }

        if (!isMatched && object['additionalProperties'] !== undefined) {
            schemas.push(object['additionalProperties']);
        }
    }

    return schemas;
}

function dependentKeys(objects: ReadonlyArray<SchemaObject>, key: string): string[] {
    return objects.flatMap((object) => [
        ...stringList(asObject(object['dependentRequired'])[key]),
        ...stringList(asObject(object['dependencies'])[key]),
    ]);
}

// Drops optional properties from the end until `maxProperties` holds.
function trimToMaxProperties(value: Record<string, unknown>, objects: ReadonlyArray<SchemaObject>, required: ReadonlyArray<string>): void {
    const maximum = smallest(objects, 'maxProperties');

    if (maximum == null) {
        return;
    }

    for (const key of Object.keys(value).reverse()) {
        if (Object.keys(value).length <= maximum) {
            return;
        }

        if (!required.includes(key)) {
            delete value[key];
        }
    }
}

// An array-form `items` is the older spelling of `prefixItems`.
function prefixOf(object: SchemaObject): ReadonlyArray<unknown> {
    if (Array.isArray(object['prefixItems'])) {
        return object['prefixItems'];
    }

    return Array.isArray(object['items']) ? object['items'] : [];
}

function schemasForIndex(objects: ReadonlyArray<SchemaObject>, index: number): unknown[] {
    return objects.flatMap((object) => {
        const prefix = prefixOf(object);

        if (index < prefix.length) {
            return [prefix[index]];
        }

        const rest = Array.isArray(object['items']) ? object['additionalItems'] : object['items'];

        return rest === undefined ? [] : [rest];
    });
}

// Prefers 0, else the valid number nearest to it; `variant` takes the next nearest ones.
function numberSample(objects: ReadonlyArray<SchemaObject>, isInteger: boolean, variant: number): number {
    const lower = tightestBound(objects, 'minimum', 'exclusiveMinimum', (left, right) => left > right);
    const upper = tightestBound(objects, 'maximum', 'exclusiveMaximum', (left, right) => left < right);
    const multiples = objects.flatMap((object) => finiteNumbers(object['multipleOf'])).filter((multiple) => multiple > 0);
    const fits = (candidate: number): boolean => Number.isFinite(candidate)
        && (!isInteger || Number.isInteger(candidate))
        && (lower == null || candidate > lower.value || (candidate === lower.value && !lower.isExclusive))
        && (upper == null || candidate < upper.value || (candidate === upper.value && !upper.isExclusive))
        && multiples.every((multiple) => isMultipleOf(candidate, multiple));
    let target = 0;

    if (lower != null && target < lower.value) {
        target = lower.value;
    }

    if (upper != null && target > upper.value) {
        target = upper.value;
    }

    const steps = multiples.length > 0 ? [multiples[0]!] : isInteger ? [1] : [1, 0.5, 0.25, 0.1, 0.01, 0.001];

    for (const step of steps) {
        const found = nearestMultiples({ target, step, lower: lower?.value, upper: upper?.value, fits, count: variant + 1 });

        if (found.length > 0) {
            return found[Math.min(variant, found.length - 1)]!;
        }
    }

    return isInteger ? Math.round(target) : target;
}

// The multiples of `step` that fit, nearest to the target first, the larger of two equally near ones first.
function nearestMultiples(search: {
    readonly target: number;
    readonly step: number;
    readonly lower: number | undefined;
    readonly upper: number | undefined;
    readonly fits: (candidate: number) => boolean;
    readonly count: number;
}): number[] {
    const { step } = search;
    const center = Math.round(search.target / step);
    const lowest = search.lower == null ? Number.NEGATIVE_INFINITY : Math.floor(search.lower / step) - 1;
    const highest = search.upper == null ? Number.POSITIVE_INFINITY : Math.ceil(search.upper / step) + 1;
    const values: number[] = [];

    for (let offset = 0; offset <= 10_000 && values.length < search.count; offset += 1) {
        for (const multiple of offset === 0 ? [center] : [center + offset, center - offset]) {
            const candidate = tidy(multiple * step, step);

            if (multiple >= lowest && multiple <= highest && search.fits(candidate)) {
                values.push(candidate);
            }
        }

        if (center + offset > highest && center - offset < lowest) {
            break;
        }
    }

    return values;
}

// The validator's own tolerance for `multipleOf`.
function isMultipleOf(value: number, multiple: number): boolean {
    const remainder = value % multiple;

    return Math.abs(remainder) < 1.1920929e-7 || Math.abs(multiple - remainder) < 1.1920929e-7;
}

// Rounds away float noise such as 0.30000000000000004 when the step is a fraction.
function tidy(value: number, step: number): number {
    return Number.isInteger(step) ? value : Number(value.toPrecision(12));
}

interface Bound {
    readonly value: number;
    readonly isExclusive: boolean;
}

function tightestBound(
    objects: ReadonlyArray<SchemaObject>,
    inclusive: string,
    exclusive: string,
    isTighter: (left: number, right: number) => boolean,
): Bound | null {
    let bound: Bound | null = null;

    for (const object of objects) {
        const candidates: Bound[] = [
            ...finiteNumbers(object[inclusive]).map((value) => ({ value, isExclusive: false })),
            ...finiteNumbers(object[exclusive]).map((value) => ({ value, isExclusive: true })),
        ];

        for (const candidate of candidates) {
            const isBetter = bound == null
                || isTighter(candidate.value, bound.value)
                || (candidate.value === bound.value && candidate.isExclusive);

            if (isBetter) {
                bound = candidate;
            }
        }
    }

    return bound;
}

// The first string that fits every length, `pattern` and `format` rule; `variant` takes the next ones.
// When none fits, "string" cut or padded to length, which the check then reports.
function stringSample(objects: ReadonlyArray<SchemaObject>, variant: number): string {
    const minLength = largest(objects, 'minLength') ?? 0;
    const maxLength = smallest(objects, 'maxLength') ?? Number.POSITIVE_INFINITY;
    const patterns = objects.flatMap((object) => (typeof object['pattern'] === 'string' ? [object['pattern']] : []));
    const formats = objects.flatMap((object) => (typeof object['format'] === 'string' ? [object['format']] : []));
    const fits = (text: string): boolean => {
        const length = [...text].length;

        return length >= minLength
            && length <= maxLength
            && patterns.every((pattern) => matchesPattern(pattern, text))
            && formats.every((name) => format[name]?.(text) !== false);
    };
    const seen = new Set<string>();
    let found = 0;

    for (const candidate of stringCandidates(formats, patterns, minLength, maxLength)) {
        if (seen.has(candidate) || seen.size > 5_000) {
            continue;
        }

        seen.add(candidate);

        if (fits(candidate)) {
            if (found === variant) {
                return candidate;
            }

            found += 1;
        }
    }

    return fitLength('string', minLength, maxLength);
}

function* stringCandidates(
    formats: ReadonlyArray<string>,
    patterns: ReadonlyArray<string>,
    minLength: number,
    maxLength: number,
): Generator<string> {
    for (const name of formats) {
        const sample = FORMAT_SAMPLES[name];

        for (let variant = 0; sample != null && variant < MAX_VARIANTS; variant += 1) {
            yield sample(variant);
        }
    }

    yield WORDS[0]!;

    for (const pattern of patterns) {
        yield* patternCandidates(pattern, minLength, maxLength);
    }

    for (const word of WORDS) {
        yield word;
        yield fitLength(word, minLength, maxLength);
    }
}

// Strings a simple pattern describes, shortest first, until they outgrow `maxLength`.
function* patternCandidates(pattern: string, minLength: number, maxLength: number): Generator<string> {
    let previousLength = -1;

    for (let extra = 0; extra <= Math.max(8, minLength) && extra <= 512; extra += 1) {
        const choices = patternChoices(pattern, extra);

        if (choices == null || choices.length > maxLength || choices.length === previousLength) {
            return;
        }

        previousLength = choices.length;

        if (choices.length < minLength) {
            continue;
        }

        for (let variant = 0; variant < MAX_VARIANTS; variant += 1) {
            const text = choicesText(choices, variant);

            if (text == null) {
                break;
            }

            yield text;
        }
    }
}

function fitLength(word: string, minLength: number, maxLength: number): string {
    const characters = [...word];
    const padded = characters.length < minLength
        ? Array.from({ length: minLength }, (_, index) => characters[index % characters.length])
        : characters;

    return padded.slice(0, Math.max(0, Math.min(padded.length, maxLength))).join('');
}

// One character of a string a pattern describes, as the characters it may be, the preferred one first.
type CharacterChoice = ReadonlyArray<string>;

interface Cursor {
    readonly text: string;
    index: number;
}

const LOWER = characterRange('a', 'z');
const UPPER = characterRange('A', 'Z');
const DIGITS = characterRange('0', '9');
const LETTERS_AND_DIGITS = [...LOWER, ...UPPER, ...DIGITS];
// What `.` and a negated class choose from.
const ANY_CHARACTER = [...LETTERS_AND_DIGITS, '-', '_', ' ', '.'];
const MAX_PATTERN_LENGTH = 4_096;

const CLASS_ESCAPES: Readonly<Record<string, CharacterChoice>> = Object.freeze({
    d: DIGITS,
    D: [...LOWER, ...UPPER],
    w: [...LETTERS_AND_DIGITS, '_'],
    W: ['-', ' ', '.'],
    s: [' '],
    S: LETTERS_AND_DIGITS,
    t: ['\t'],
    n: ['\n'],
    r: ['\r'],
    f: ['\f'],
    v: ['\v'],
    0: ['\0'],
});

// Reads the simple parts of a regular expression: literals, classes, `.`, escapes, groups, alternation (its first branch)
// and quantifiers, each taking its least count plus `extra`. Lookarounds, back-references and the like give null.
function patternChoices(pattern: string, extra: number): CharacterChoice[] | null {
    const cursor: Cursor = { text: pattern, index: 0 };
    const choices = readAlternatives(cursor, extra);

    return cursor.index === pattern.length ? choices : null;
}

function readAlternatives(cursor: Cursor, extra: number): CharacterChoice[] | null {
    const first = readSequence(cursor, extra);

    while (first != null && cursor.text[cursor.index] === '|') {
        cursor.index += 1;

        if (readSequence(cursor, extra) == null) {
            return null;
        }
    }

    return first;
}

function readSequence(cursor: Cursor, extra: number): CharacterChoice[] | null {
    const choices: CharacterChoice[] = [];

    while (cursor.index < cursor.text.length && cursor.text[cursor.index] !== '|' && cursor.text[cursor.index] !== ')') {
        const atom = readAtom(cursor, extra);
        const count = atom == null ? null : readQuantifier(cursor, extra);

        if (atom == null || count == null || choices.length + atom.length * count > MAX_PATTERN_LENGTH) {
            return null;
        }

        for (let repeat = 0; repeat < count; repeat += 1) {
            choices.push(...atom);
        }
    }

    return choices;
}

function readAtom(cursor: Cursor, extra: number): CharacterChoice[] | null {
    const character = String.fromCodePoint(cursor.text.codePointAt(cursor.index) ?? 0);

    if (character === '^' || character === '$') {
        cursor.index += 1;

        return [];
    }

    if (character === '(') {
        return readGroup(cursor, extra);
    }

    if (character === '[') {
        const choice = readClass(cursor);

        return choice == null ? null : [choice];
    }

    if (character === '\\') {
        return readEscape(cursor);
    }

    if ('*+?{}]'.includes(character)) {
        return null;
    }

    cursor.index += character.length;

    return [character === '.' ? ANY_CHARACTER : [character]];
}

function readGroup(cursor: Cursor, extra: number): CharacterChoice[] | null {
    const { text } = cursor;
    cursor.index += 1;

    if (text.startsWith('?:', cursor.index)) {
        cursor.index += 2;
    }
    else if (text.startsWith('?<', cursor.index) && !text.startsWith('?<=', cursor.index) && !text.startsWith('?<!', cursor.index)) {
        const end = text.indexOf('>', cursor.index);

        if (end < 0) {
            return null;
        }

        cursor.index = end + 1;
    }
    else if (text[cursor.index] === '?') {
        return null;
    }

    const inner = readAlternatives(cursor, extra);

    if (inner == null || text[cursor.index] !== ')') {
        return null;
    }

    cursor.index += 1;

    return inner;
}

function readClass(cursor: Cursor): CharacterChoice | null {
    const { text } = cursor;
    cursor.index += 1;
    const isNegated = text[cursor.index] === '^';
    const members: string[] = [];

    if (isNegated) {
        cursor.index += 1;
    }

    while (cursor.index < text.length && text[cursor.index] !== ']') {
        const start = readClassMember(cursor);

        if (start == null) {
            return null;
        }

        const isRange = start.length === 1 && text[cursor.index] === '-' && text[cursor.index + 1] !== ']' && cursor.index + 1 < text.length;

        if (!isRange) {
            members.push(...start);
            continue;
        }

        cursor.index += 1;
        const end = readClassMember(cursor);
        const range = end?.length === 1 ? characterRange(start[0]!, end[0]!) : [];

        if (range.length === 0) {
            return null;
        }

        members.push(...range);
    }

    if (text[cursor.index] !== ']') {
        return null;
    }

    cursor.index += 1;
    const choice = isNegated ? ANY_CHARACTER.filter((character) => !members.includes(character)) : unique(members);

    return choice.length === 0 ? null : preferReadable(choice);
}

function readClassMember(cursor: Cursor): CharacterChoice | null {
    const character = String.fromCodePoint(cursor.text.codePointAt(cursor.index) ?? 0);

    if (character !== '\\') {
        cursor.index += character.length;

        return [character];
    }

    const escaped = cursor.text[cursor.index + 1];

    if (escaped === 'b') {
        cursor.index += 2;

        return ['\b'];
    }

    const choices = readEscape(cursor);

    return choices?.length === 1 ? choices[0]! : null;
}

function readEscape(cursor: Cursor): CharacterChoice[] | null {
    const { text } = cursor;
    const escaped = text[cursor.index + 1];

    if (escaped === 'p') {
        return readUnicodeProperty(cursor);
    }

    // Back-references, named back-references, control characters and negated properties aren't built.
    if (escaped == null || /[1-9kcP]/.test(escaped)) {
        return null;
    }

    cursor.index += 2;

    if (escaped === 'b' || escaped === 'B') {
        return [];
    }

    const known = CLASS_ESCAPES[escaped];

    if (known != null) {
        return [known];
    }

    if (escaped === 'u' || escaped === 'x') {
        const code = /^u\{([0-9a-f]+)\}|^u([0-9a-f]{4})|^x([0-9a-f]{2})/i.exec(text.slice(cursor.index - 1));

        if (code == null) {
            return null;
        }

        cursor.index += code[0].length - 1;
        const point = Number.parseInt(code[1] ?? code[2] ?? code[3] ?? '', 16);

        return point > 0x10ffff ? null : [[String.fromCodePoint(point)]];
    }

    return [[escaped]];
}

// `\p{L}` and `\p{N}` and their longer names, such as `\p{Letter}`; other properties give null.
function readUnicodeProperty(cursor: Cursor): CharacterChoice[] | null {
    const property = /^\\p\{([^}]+)\}/.exec(cursor.text.slice(cursor.index));
    const name = property?.[1] ?? '';

    if (property == null || !/^(L|N)/.test(name)) {
        return null;
    }

    cursor.index += property[0].length;

    return [name.startsWith('L') ? [...LOWER, ...UPPER] : DIGITS];
}

// How many times the atom repeats: its least count plus `extra`, never past its most.
function readQuantifier(cursor: Cursor, extra: number): number | null {
    const { text } = cursor;
    const symbol = text[cursor.index];
    let least = 1;
    let most = 1;

    if (symbol === '*' || symbol === '+' || symbol === '?') {
        least = symbol === '+' ? 1 : 0;
        most = symbol === '?' ? 1 : Number.POSITIVE_INFINITY;
        cursor.index += 1;
    }
    else if (symbol === '{') {
        const range = /^\{(\d+)(,(\d*))?\}/.exec(text.slice(cursor.index));

        if (range == null) {
            return null;
        }

        least = Number(range[1]);
        most = range[2] == null ? least : range[3] === '' ? Number.POSITIVE_INFINITY : Number(range[3]);
        cursor.index += range[0].length;

        if (most < least) {
            return null;
        }
    }
    else {
        return 1;
    }

    if (text[cursor.index] === '?') {
        cursor.index += 1;
    }

    return Math.min(most, least + extra);
}

// Counts through the characters each position may take, the last position fastest, so each variant is a different string.
function choicesText(choices: ReadonlyArray<CharacterChoice>, variant: number): string | null {
    const characters = choices.map((choice) => choice[0] ?? '');
    let rest = variant;

    for (let index = choices.length - 1; index >= 0 && rest > 0; index -= 1) {
        const choice = choices[index]!;

        if (choice.length > 1) {
            characters[index] = choice[rest % choice.length]!;
            rest = Math.floor(rest / choice.length);
        }
    }

    return rest > 0 ? null : characters.join('');
}

function characterRange(first: string, last: string): string[] {
    const start = first.codePointAt(0) ?? 0;
    const end = last.codePointAt(0) ?? 0;

    if (end < start) {
        return [];
    }

    return Array.from({ length: Math.min(end - start + 1, 256) }, (_, offset) => String.fromCodePoint(start + offset));
}

// Lower-case letters first, then upper-case letters, then digits, then anything else, so samples read like words.
function preferReadable(choice: ReadonlyArray<string>): string[] {
    const rank = (character: string): number => [LOWER, UPPER, DIGITS].findIndex((group) => group.includes(character));

    return [...choice].sort((left, right) => {
        const leftRank = rank(left) < 0 ? 3 : rank(left);
        const rightRank = rank(right) < 0 ? 3 : rank(right);

        return leftRank - rightRank;
    });
}

// Patterns are tested as the validator tests them: unanchored, with the `u` flag.
function matchesPattern(pattern: string, text: string): boolean {
    try {
        return new RegExp(pattern, 'u').test(text);
    }
    catch {
        return false;
    }
}

function toNotes(errors: ReadonlyArray<SchemaErrorEntry>, value: unknown): SampleNote[] {
    const notes: SampleNote[] = [];

    for (const error of errors) {
        const segments = jsonPointerSegments(value, error.path.slice(1));
        const path = segments == null ? error.path : JsonPathBuilder.of(segments);

        if (notes.some((note) => note.path === path && note.keyword === error.keyword)) {
            continue;
        }

        notes.push({ path, keyword: error.keyword, message: `\`${error.keyword}\` at \`${path}\` not satisfied; edit the value` });
    }

    return notes;
}

function merge(objects: ReadonlyArray<SchemaObject>, more: ReadonlyArray<SchemaObject>): SchemaObject[] {
    return [...objects, ...more.filter((object) => !objects.includes(object))];
}

function largest(objects: ReadonlyArray<SchemaObject>, keyword: string): number | undefined {
    const values = objects.flatMap((object) => finiteNumbers(object[keyword]));

    return values.length === 0 ? undefined : Math.max(...values);
}

function smallest(objects: ReadonlyArray<SchemaObject>, keyword: string): number | undefined {
    const values = objects.flatMap((object) => finiteNumbers(object[keyword]));

    return values.length === 0 ? undefined : Math.min(...values);
}

function finiteNumbers(value: unknown): number[] {
    return typeof value === 'number' && Number.isFinite(value) ? [value] : [];
}

function stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function unique<T>(values: ReadonlyArray<T>): T[] {
    return values.filter((value, index) => values.indexOf(value) === index);
}

function isPlainObject(value: unknown): value is SchemaObject {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

function asObject(value: unknown): SchemaObject {
    return isPlainObject(value) ? value : {};
}

function hasOwn(value: unknown, key: string): boolean {
    return isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}

// Sets a key as data, so a key such as `__proto__` stays an ordinary property.
function setProperty(target: Record<string, unknown>, key: string, value: unknown): void {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function copyJson(value: unknown): unknown {
    return value === undefined ? null : JSON.parse(JSON.stringify(value)) as unknown;
}

function exampleUrl(variant: number): string {
    return variant === 0 ? 'https://example.com' : `https://example.com/${variant + 1}`;
}

function exampleHost(variant: number): string {
    return variant === 0 ? 'example.com' : `host${variant + 1}.example.com`;
}

function twoDigits(value: number): string {
    return String(value).padStart(2, '0');
}
