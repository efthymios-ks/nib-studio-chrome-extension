import type { XmlNode } from '../paths/xmlParser.js';

// Converts an `XmlNode` tree into a JSON value. Comments are dropped, siblings group by name,
// and mixed content folds all of its text into the `textKey` field.
export interface XmlToJsonOptions {
    // Prefix for attribute keys, `@` by default.
    readonly attributePrefix?: string;
    // Key that holds text content, `#text` by default.
    readonly textKey?: string;
    // Paths such as `/root/item` that always become arrays, even with a single element.
    readonly forceArray?: ReadonlyArray<string>;
    // Turns text such as `42`, `3.14`, `true` and `false` into JSON numbers and booleans.
    readonly coerceTypes?: boolean;
    // Drops the prefix before `:` from element and attribute names.
    readonly stripNamespaces?: boolean;
    // Keeps element text as written, whitespace-only text included, instead of trimming it.
    readonly keepWhitespace?: boolean;
}

export type XmlJsonValue =
    | string
    | number
    | boolean
    | null
    | XmlJsonValue[]
    | { [key: string]: XmlJsonValue };

interface Normalized {
    readonly attributePrefix: string;
    readonly textKey: string;
    readonly forceArray: Set<string>;
    readonly coerceTypes: boolean;
    readonly stripNamespaces: boolean;
    readonly keepWhitespace: boolean;
}

export function convertXmlToJson(root: XmlNode, options?: XmlToJsonOptions): XmlJsonValue {
    const config: Normalized = {
        attributePrefix: options?.attributePrefix ?? '@',
        textKey: options?.textKey ?? '#text',
        forceArray: new Set(options?.forceArray ?? []),
        coerceTypes: options?.coerceTypes ?? false,
        stripNamespaces: options?.stripNamespaces ?? false,
        keepWhitespace: options?.keepWhitespace ?? false,
    };

    const name = displayName(root.name, config);
    const basePath = `/${name}`;

    return { [name]: convertNode(root, basePath, config) };
}

function convertNode(node: XmlNode, path: string, config: Normalized): XmlJsonValue {
    const attributes = Object.keys(node.attributes);
    const hasAttributes = attributes.length > 0;
    const hasChildren = node.children.length > 0;
    const text = config.keepWhitespace ? node.text : node.text.trim();
    const hasText = text.length > 0;

    if (!hasAttributes && !hasChildren) {
        if (!hasText) {
            return null;
        }

        return coerceValue(text, config);
    }

    const result: Record<string, XmlJsonValue> = {};

    for (const key of attributes) {
        const attrKey = `${config.attributePrefix}${displayName(key, config)}`;
        const value = node.attributes[key] ?? '';
        result[attrKey] = coerceValue(value, config);
    }

    if (hasText) {
        result[config.textKey] = coerceValue(text, config);
    }

    const grouped = new Map<string, XmlNode[]>();
    for (const child of node.children) {
        const key = displayName(child.name, config);
        const existing = grouped.get(key);
        if (existing != null) {
            existing.push(child);
        }
        else {
            grouped.set(key, [child]);
        }
    }

    for (const [key, group] of grouped) {
        const childPath = `${path}/${key}`;
        const converted = group.map((child) => convertNode(child, childPath, config));
        if (group.length > 1 || config.forceArray.has(childPath)) {
            result[key] = converted;
        }
        else {
            result[key] = converted[0] ?? null;
        }
    }

    return result;
}

function displayName(name: string, config: Normalized): string {
    if (!config.stripNamespaces) {
        return name;
    }

    const colon = name.indexOf(':');

    return colon === -1 ? name : name.slice(colon + 1);
}

function coerceValue(value: string, config: Normalized): XmlJsonValue {
    if (!config.coerceTypes) {
        return value;
    }

    if (value === 'true') {
        return true;
    }

    if (value === 'false') {
        return false;
    }

    if (value === '') {
        return value;
    }

    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && value.trim() !== '' && String(asNumber) === value) {
        return asNumber;
    }

    return value;
}

// Return every element path (as `/a/b/c`) that has two or more
// siblings of the same name, i.e. is intrinsically an array.
// Used by XML compare to force both sides to the same shape.
export function collectRepeatedElementPaths(
    root: XmlNode,
    options?: Pick<XmlToJsonOptions, 'stripNamespaces'>,
): string[] {
    const normalized: Normalized = {
        attributePrefix: '@',
        textKey: '#text',
        forceArray: new Set(),
        coerceTypes: false,
        stripNamespaces: options?.stripNamespaces ?? false,
        keepWhitespace: false,
    };
    const paths = new Set<string>();
    walk(root, `/${displayName(root.name, normalized)}`, normalized, paths);

    return [...paths];
}

function walk(node: XmlNode, path: string, config: Normalized, out: Set<string>): void {
    const groups = new Map<string, XmlNode[]>();
    for (const child of node.children) {
        const key = displayName(child.name, config);
        const bucket = groups.get(key);
        if (bucket != null) {
            bucket.push(child);
        }
        else {
            groups.set(key, [child]);
        }
    }

    for (const [key, group] of groups) {
        const childPath = `${path}/${key}`;
        if (group.length > 1) {
            out.add(childPath);
        }

        for (const child of group) {
            walk(child, childPath, config, out);
        }
    }
}
