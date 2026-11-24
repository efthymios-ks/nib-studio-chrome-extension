import { JsonComparer, type JsonArrayRule, type JsonDifference } from '../json/jsonComparer.js';
import type { JsonPathSegment } from '../paths/jsonPathBuilder.js';
import type { XmlNode } from '../paths/xmlParser.js';
import {
    collectRepeatedElementPaths,
    convertXmlToJson,
    type XmlToJsonOptions,
} from './xmlToJson.js';

// Structural XML compare on top of `JsonComparer`: elements repeated on either side become arrays on both,
// so one child and many children share a shape.
export interface XmlArrayRule {
    readonly path: string;
    readonly matchBy?: ReadonlyArray<string>;
    readonly sortBy?: ReadonlyArray<string>;
}

// Without options, text and attribute values compare exactly as written.
export interface XmlCompareOptions {
    // Drops text made only of whitespace, such as the indentation between elements.
    readonly ignoreWhitespaceOnly?: boolean;
    // Strips leading and trailing whitespace from text that has other characters, and from attribute values.
    readonly trimText?: boolean;
    readonly ignoreNamespacePrefixes?: boolean;
    // True unless set to false; false lowercases element and attribute names.
    readonly caseSensitiveNames?: boolean;
    readonly arrayRules?: ReadonlyArray<XmlArrayRule>;
}

export interface XmlDifference {
    readonly kind: JsonDifference['kind'];
    readonly path: string;
    readonly segments: JsonPathSegment[];
    readonly leftValue?: unknown;
    readonly rightValue?: unknown;
}

export function compareXml(
    left: XmlNode,
    right: XmlNode,
    options?: XmlCompareOptions,
): XmlDifference[] {
    const prepared = prepare(left, right, options);
    const differences = JsonComparer.compare(prepared.left, prepared.right, {
        arrayRules: prepared.arrayRules,
    });

    return differences.map((difference) => ({
        kind: difference.kind,
        path: difference.path,
        segments: difference.segments,
        leftValue: difference.leftValue,
        rightValue: difference.rightValue,
    }));
}

export interface Prepared {
    readonly left: unknown;
    readonly right: unknown;
    readonly arrayRules: JsonArrayRule[];
}

// Both documents as the JSON the compare runs on, with the element rules as array rules and arrays sorted by them.
export function prepareXmlForCompare(left: XmlNode, right: XmlNode, options?: XmlCompareOptions): Prepared {
    const prepared = prepare(left, right, options);
    const normalizeOptions = { arrayRules: prepared.arrayRules, keepKeyOrder: true };

    return {
        left: JsonComparer.normalize(prepared.left, normalizeOptions),
        right: JsonComparer.normalize(prepared.right, normalizeOptions),
        arrayRules: prepared.arrayRules,
    };
}

function prepare(left: XmlNode, right: XmlNode, options: XmlCompareOptions | undefined): Prepared {
    const stripNamespaces = options?.ignoreNamespacePrefixes === true;
    const convertOptions: XmlToJsonOptions = {
        stripNamespaces,
        keepWhitespace: true,
    };

    const leftNode = prepareNode(left, options);
    const rightNode = prepareNode(right, options);

    const leftRepeated = collectRepeatedElementPaths(leftNode, { stripNamespaces });
    const rightRepeated = collectRepeatedElementPaths(rightNode, { stripNamespaces });
    const forceArray = new Set<string>([...leftRepeated, ...rightRepeated]);

    const leftJson = convertXmlToJson(leftNode, { ...convertOptions, forceArray: [...forceArray] });
    const rightJson = convertXmlToJson(rightNode, { ...convertOptions, forceArray: [...forceArray] });

    const arrayRules = (options?.arrayRules ?? []).map((rule) => ({
        path: xpathToJsonPath(rule.path, forceArray),
        matchBy: rule.matchBy?.map(fieldToJsonSegment),
        sortBy: rule.sortBy?.map(fieldToJsonSegment),
    }));

    return { left: leftJson, right: rightJson, arrayRules };
}

function prepareNode(node: XmlNode, options: XmlCompareOptions | undefined): XmlNode {
    const caseSensitive = options?.caseSensitiveNames !== false;
    const stripNamespaces = options?.ignoreNamespacePrefixes === true;
    const text = applyTextOptions(node.text, options);
    let attributes = applyAttributeCase(node.attributes, caseSensitive);
    if (stripNamespaces) {
        attributes = dropNamespaceAttributes(attributes);
    }

    if (options?.trimText === true) {
        attributes = Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, value.trim()]));
    }

    const rawName = caseSensitive ? node.name : node.name.toLowerCase();
    const name = stripNamespaces ? stripPrefix(rawName) : rawName;

    return {
        name,
        attributes,
        text,
        children: node.children.map((child) => prepareNode(child, options)),
    };
}

function dropNamespaceAttributes(attributes: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const key of Object.keys(attributes)) {
        if (key === 'xmlns' || key.startsWith('xmlns:')) {
            continue;
        }

        result[key] = attributes[key] ?? '';
    }

    return result;
}

function stripPrefix(name: string): string {
    const colon = name.indexOf(':');

    return colon === -1 ? name : name.slice(colon + 1);
}

// Each option governs its own kind of text, so either one changes the result while the other is on.
function applyTextOptions(text: string, options: XmlCompareOptions | undefined): string {
    if (text.trim() === '') {
        return options?.ignoreWhitespaceOnly === true ? '' : text;
    }

    return options?.trimText === true ? text.trim() : text;
}

function applyAttributeCase(
    attributes: Record<string, string>,
    caseSensitive: boolean,
): Record<string, string> {
    if (caseSensitive) {
        return { ...attributes };
    }

    const result: Record<string, string> = {};
    for (const key of Object.keys(attributes)) {
        result[key.toLowerCase()] = attributes[key] ?? '';
    }

    return result;
}

function fieldToJsonSegment(field: string): string {
    if (field.startsWith('@')) {
        return `@${field.slice(1)}`;
    }

    return field;
}

function xpathToJsonPath(xpath: string, repeated: ReadonlySet<string>): string {
    // Convert `/root/line` → `$.root.line[*]`. The rule's path targets the
    // repeated element; repeated ancestors also become arrays, so they get `[*]` too.
    const parts = xpath.split('/').filter((part) => part.length > 0);
    let path = '$';
    let elementPath = '';
    for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index] ?? '';
        if (part.startsWith('@')) {
            path += `.${part}`;
            continue;
        }

        elementPath += `/${part}`;
        const isLast = index === parts.length - 1;
        path += isLast || repeated.has(elementPath) ? `.${part}[*]` : `.${part}`;
    }

    return path;
}

// Attribute (`@id`) and child element names found on every element at xpath, on all roots, sorted.
export function collectElementFields(
    roots: ReadonlyArray<XmlNode>,
    xpath: string,
    options?: XmlCompareOptions,
): string[] {
    const fields = new Set<string>();

    for (const root of roots) {
        for (const element of elementsAt(prepareNode(root, options), xpath)) {
            for (const name of Object.keys(element.attributes)) {
                if (name !== 'xmlns' && !name.startsWith('xmlns:')) {
                    fields.add(`@${name}`);
                }
            }

            for (const child of element.children) {
                fields.add(child.name);
            }
        }
    }

    return [...fields].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }) || left.localeCompare(right));
}

function elementsAt(root: XmlNode, xpath: string): XmlNode[] {
    const parts = xpath.split('/').filter((part) => part.length > 0);

    if (parts[0] !== root.name) {
        return [];
    }

    let current: XmlNode[] = [root];

    for (const part of parts.slice(1)) {
        current = current.flatMap((node) => node.children.filter((child) => child.name === part));
    }

    return current;
}
