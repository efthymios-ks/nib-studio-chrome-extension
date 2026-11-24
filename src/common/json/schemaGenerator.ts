// Infers a JSON Schema (Draft 2020-12) that the sample document passes.
// Every value is looked at once, so the work grows with the size of the document; no array is sampled.
import { format } from '@cfworker/json-schema';

export type GeneratedSchema = Record<string, unknown>;

// An identifier for the dialect; nothing is fetched from it.
export const SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

// Values nested deeper than this get the empty schema, which accepts anything,
// so a deep document can't exhaust the stack here, in the formatter or in the validator.
export const MAX_SCHEMA_DEPTH = 100;

type Kind = 'null' | 'boolean' | 'integer' | 'number' | 'string' | 'object' | 'array';

type StringFormat = 'date-time' | 'date' | 'email' | 'uri' | 'uuid';

// Checked in this order, so a value that fits two formats gets the first.
const STRING_FORMATS: ReadonlyArray<StringFormat> = ['date-time', 'date', 'email', 'uri', 'uuid'];

// Each format needs the plain shape people mean by it and must pass the validator's own check,
// so a generated schema always accepts the values it was generated from.
const FORMAT_TESTS: Readonly<Record<StringFormat, (value: string) => boolean>> = Object.freeze({
    'date-time': (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i.test(value) && passes('date-time', value),
    'date': (value: string) => passes('date', value),
    'email': (value: string) => passes('email', value),
    'uri': (value: string) => /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(value) && passes('uri', value),
    'uuid': (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) && passes('uuid', value),
});

function passes(name: StringFormat, value: string): boolean {
    return format[name]?.(value) === true;
}

interface Shape {
    // The kinds of the samples, in the order they were first seen.
    readonly kinds: Kind[];
    // A sample sat deeper than `MAX_SCHEMA_DEPTH`, so the shape accepts anything.
    isOpen: boolean;
    // The formats every string sample so far fits, or null before the first string.
    formats: StringFormat[] | null;
    object: ObjectShape | null;
    array: ArrayShape | null;
}

interface ObjectShape {
    count: number;
    // Each key with the shape of its values and the number of objects that have it, in the order first seen.
    readonly properties: Map<string, { readonly shape: Shape; count: number }>;
}

interface ArrayShape {
    // Every element of every array sample, merged; null while no array had elements.
    items: Shape | null;
}

export function generateSchema(document: unknown): GeneratedSchema {
    const shape = emptyShape();
    addSample(shape, document, 0);

    return { $schema: SCHEMA_DIALECT, ...toSchema(shape) };
}

function emptyShape(): Shape {
    return { kinds: [], isOpen: false, formats: null, object: null, array: null };
}

function addSample(shape: Shape, value: unknown, depth: number): void {
    if (value === null || value === undefined) {
        note(shape, 'null');

        return;
    }

    if (typeof value === 'object' && depth >= MAX_SCHEMA_DEPTH) {
        shape.isOpen = true;

        return;
    }

    if (Array.isArray(value)) {
        note(shape, 'array');
        const array = shape.array ?? (shape.array = { items: null });

        for (const item of value) {
            const items = array.items ?? (array.items = emptyShape());
            addSample(items, item, depth + 1);
        }

        return;
    }

    if (typeof value === 'object') {
        note(shape, 'object');
        addObjectSample(shape.object ?? (shape.object = { count: 0, properties: new Map() }), value as Record<string, unknown>, depth);

        return;
    }

    if (typeof value === 'string') {
        note(shape, 'string');
        const formats = shape.formats ?? STRING_FORMATS;
        shape.formats = formats.length === 0 ? formats as StringFormat[] : formats.filter((candidate) => FORMAT_TESTS[candidate](value));

        return;
    }

    if (typeof value === 'number') {
        note(shape, Number.isInteger(value) ? 'integer' : 'number');

        return;
    }

    note(shape, typeof value === 'boolean' ? 'boolean' : 'null');
}

function addObjectSample(object: ObjectShape, value: Record<string, unknown>, depth: number): void {
    object.count += 1;

    for (const key of Object.keys(value)) {
        let property = object.properties.get(key);

        if (property == null) {
            property = { shape: emptyShape(), count: 0 };
            object.properties.set(key, property);
        }

        property.count += 1;
        addSample(property.shape, value[key], depth + 1);
    }
}

function note(shape: Shape, kind: Kind): void {
    if (!shape.kinds.includes(kind)) {
        shape.kinds.push(kind);
    }
}

function toSchema(shape: Shape): GeneratedSchema {
    if (shape.isOpen) {
        return {};
    }

    const kinds = typeNames(shape);
    const containers = kinds.filter((kind) => kind === 'object' || kind === 'array');
    const plain = kinds.filter((kind) => kind !== 'object' && kind !== 'array');

    if (containers.length === 0) {
        return plainSchema(shape, plain);
    }

    const [container] = containers;

    if (containers.length === 1 && container != null && plain.every((kind) => kind === 'null')) {
        return containerSchema(shape, container, plain.length > 0);
    }

    // Objects, arrays and plain values in one place each get their own branch, in the order first seen.
    const branches: GeneratedSchema[] = [];

    for (const kind of kinds) {
        if (kind === 'object' || kind === 'array') {
            branches.push(containerSchema(shape, kind, false));
        }
        else if (kind === plain[0]) {
            branches.push(plainSchema(shape, plain));
        }
    }

    return { anyOf: branches };
}

// The kinds as schema type names: `integer` gives way to `number` when any sample has a fraction, and `null` goes last.
function typeNames(shape: Shape): Kind[] {
    const hasFraction = shape.kinds.includes('number');
    const names = shape.kinds
        .map((kind) => (kind === 'integer' && hasFraction ? 'number' : kind))
        .filter((kind, index, all) => all.indexOf(kind) === index);

    return [...names.filter((kind) => kind !== 'null'), ...names.filter((kind) => kind === 'null')];
}

function plainSchema(shape: Shape, kinds: ReadonlyArray<Kind>): GeneratedSchema {
    const stringFormat = kinds.includes('string') ? shape.formats?.[0] : undefined;

    return {
        type: kinds.length === 1 ? kinds[0] : [...kinds],
        ...(stringFormat == null ? {} : { format: stringFormat }),
    };
}

function containerSchema(shape: Shape, kind: 'object' | 'array', isNullable: boolean): GeneratedSchema {
    const type = isNullable ? [kind, 'null'] : kind;

    if (kind === 'array') {
        const items = shape.array?.items;

        return items == null ? { type } : { type, items: toSchema(items) };
    }

    const object = shape.object;

    if (object == null || object.properties.size === 0) {
        return { type };
    }

    const properties: GeneratedSchema = {};
    const required: string[] = [];

    for (const [key, property] of object.properties) {
        properties[key] = toSchema(property.shape);

        if (property.count === object.count) {
            required.push(key);
        }
    }

    return required.length === 0 ? { type, properties } : { type, properties, required };
}
