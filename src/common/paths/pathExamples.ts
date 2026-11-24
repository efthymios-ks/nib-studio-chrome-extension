import { JsonPathBuilder, type JsonPathSegment } from './jsonPathBuilder.js';
import type { XmlNode } from './xmlParser.js';

export interface PathExample {
    readonly title: string;
    readonly expression: string;
}

export interface PathSyntaxEntry {
    readonly syntax: string;
    readonly description: string;
}

// JSONPath as jsonpath-plus reads it, with filters run by its safe evaluator.
export const JSON_PATH_SYNTAX: ReadonlyArray<PathSyntaxEntry> = [
    { syntax: '$', description: 'The whole document.' },
    { syntax: ".key, ['key']", description: "A key of an object; brackets take any key, such as ['first name']." },
    { syntax: '[0], [-1:]', description: 'An array item by index, counted from 0; [-1:] is the last item.' },
    { syntax: '[0:3], [0,2]', description: 'A slice, from 0 up to but not including 3, or a list of indexes.' },
    { syntax: '*, [*]', description: 'Every key of an object or item of an array.' },
    { syntax: '..key', description: 'The key at any depth below.' },
    {
        syntax: '[?(@.price > 10)]',
        description: 'The items the filter is true for, where @ is the item. Compare with == != < <= > >=, and combine with && || and !.',
    },
    { syntax: '[?(@.tags)]', description: 'The items that have the key.' },
    { syntax: '~', description: 'The key or index of each match instead of its value, as in $.*~.' },
    { syntax: '^', description: 'The parent of each match.' },
];

// The XPath subset `xPath.ts` evaluates.
export const XPATH_SYNTAX: ReadonlyArray<PathSyntaxEntry> = [
    { syntax: '/name', description: 'A child element; a path that starts with / starts above the root element, as in /orders/order.' },
    { syntax: '//name', description: 'The element at any depth.' },
    { syntax: '*', description: 'Any element.' },
    { syntax: '. and ..', description: 'The element itself and its parent.' },
    { syntax: '@name, @*', description: 'An attribute, or every attribute.' },
    { syntax: 'text()', description: 'The text of an element.' },
    { syntax: '[2], [-1], [last()]', description: 'By position among the matching siblings, counted from 1; a negative position counts from the end.' },
    { syntax: "[@id], [@id='2']", description: 'Elements that have the attribute, or have it with that value.' },
    { syntax: "[name='x']", description: 'Elements with a child of that name whose text is x.' },
    { syntax: "contains(@a, 'x'), starts-with(name, 'x')", description: 'Text tests on an attribute or a child element.' },
    { syntax: 'local-name()', description: "The name without its namespace prefix, as in [starts-with(local-name(), 'item')]." },
    { syntax: 'and, or', description: 'Combine conditions.' },
];

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const MAX_EXAMPLE_VALUE_LENGTH = 40;
const MAX_VISITED = 5000;

// Ready-made expressions built from the document's own keys and values, each with at least one match.
export function buildJsonPathExamples(root: unknown): PathExample[] {
    const examples: PathExample[] = [{ title: 'The whole document', expression: '$' }];

    if (isPlainObject(root)) {
        const keys = Object.keys(root);
        const first = keys[0];

        if (first != null) {
            examples.push({ title: `The ${first} key`, expression: JsonPathBuilder.of([first]) });
        }

        if (keys.length > 1) {
            examples.push({ title: 'Every top-level value', expression: '$.*' });
        }
    }

    const list = findArrayOfObjects(root);
    const field = list == null ? null : firstKey(list.sample, (value) => isPrimitive(value));

    if (list != null) {
        const path = JsonPathBuilder.of(list.segments);
        const name = listName(list.segments);
        examples.push(
            { title: `Every item of ${name}`, expression: `${path}[*]` },
            { title: `The first item of ${name}`, expression: `${path}[0]` },
            { title: `The last item of ${name}`, expression: `${path}[-1:]` },
        );

        if (field != null) {
            examples.push({ title: `The ${field} of every item`, expression: JsonPathBuilder.member(`${path}[*]`, field) });
        }

        const numberField = firstKey(list.sample, (value, key) => IDENTIFIER.test(key) && typeof value === 'number' && Number.isFinite(value));

        if (numberField != null) {
            const value = list.sample[numberField] as number;
            examples.push({ title: `Items whose ${numberField} is at least ${value}`, expression: `${path}[?(@.${numberField} >= ${value})]` });
        }

        const textField = firstKey(list.sample, (value, key) => IDENTIFIER.test(key) && typeof value === 'string' && isPlainText(value));

        if (textField != null) {
            const value = list.sample[textField] as string;
            examples.push({ title: `Items whose ${textField} is ${value}`, expression: `${path}[?(@.${textField} == ${JSON.stringify(value)})]` });
        }
    }

    const deepKey = field != null && IDENTIFIER.test(field) ? field : findNestedKey(root);

    if (deepKey != null) {
        examples.push({ title: `Every ${deepKey}, at any depth`, expression: `$..${deepKey}` });
    }

    return examples;
}

// Ready-made expressions built from the document's own element names, attributes and text, each with at least one match.
export function buildXPathExamples(root: XmlNode): PathExample[] {
    const examples: PathExample[] = [{ title: 'The root element', expression: '/*' }];

    if (root.children.length > 0) {
        examples.push({ title: `Every child of ${root.name}`, expression: `/${root.name}/*` });
    }

    const elements = walkElements(root);
    const repeated = findRepeatedName(elements);

    if (repeated != null) {
        examples.push(
            { title: `Every ${repeated}, at any depth`, expression: `//${repeated}` },
            { title: `The second ${repeated} of each parent`, expression: `//${repeated}[2]` },
            { title: `The last ${repeated} of each parent`, expression: `//${repeated}[last()]` },
        );
    }

    const withAttribute = elements.find((entry) => entry.node.name === repeated && Object.keys(entry.node.attributes).length > 0)
        ?? elements.find((entry) => Object.keys(entry.node.attributes).length > 0);

    if (withAttribute != null) {
        const name = withAttribute.node.name;
        const [attribute, value] = Object.entries(withAttribute.node.attributes)[0] ?? ['', ''];
        const quoted = quoteXPathValue(value);
        examples.push(
            { title: `The ${attribute} of every ${name}`, expression: `//${name}/@${attribute}` },
            { title: `Every element with ${attribute}`, expression: `//*[@${attribute}]` },
        );

        if (quoted != null) {
            examples.push({ title: `The ${name} whose ${attribute} is ${value}`, expression: `//${name}[@${attribute}=${quoted}]` });
        }

        const part = quoteXPathValue(value.slice(0, 3));

        if (value.length > 1 && part != null) {
            examples.push({ title: `Every ${name} whose ${attribute} contains ${value.slice(0, 3)}`, expression: `//${name}[contains(@${attribute}, ${part})]` });
        }
    }

    const leaf = elements.find((entry) => entry.parent?.name === repeated && isTextLeaf(entry.node))
        ?? elements.find((entry) => entry.parent != null && isTextLeaf(entry.node));

    if (leaf != null && leaf.parent != null) {
        const text = leaf.node.text;
        const quoted = quoteXPathValue(text);
        examples.push({ title: `The text of every ${leaf.node.name}`, expression: `//${leaf.node.name}/text()` });

        if (quoted != null && text === text.trim()) {
            examples.push({ title: `The ${leaf.parent.name} whose ${leaf.node.name} is ${text}`, expression: `//${leaf.parent.name}[${leaf.node.name}=${quoted}]` });
        }
    }

    return examples;
}

interface ArrayOfObjects {
    readonly segments: JsonPathSegment[];
    readonly sample: Record<string, unknown>;
}

// The first array, breadth first, whose first item is an object with keys.
function findArrayOfObjects(root: unknown): ArrayOfObjects | null {
    const queue: Array<{ readonly value: unknown; readonly segments: JsonPathSegment[] }> = [{ value: root, segments: [] }];

    for (let visited = 0; visited < queue.length && visited < MAX_VISITED; visited += 1) {
        const { value, segments } = queue[visited] ?? { value: null, segments: [] };

        if (Array.isArray(value)) {
            const first: unknown = value[0];

            if (isPlainObject(first) && Object.keys(first).length > 0) {
                return { segments, sample: first };
            }

            value.slice(0, 1).forEach((item, index) => queue.push({ value: item, segments: [...segments, index] }));
            continue;
        }

        if (isPlainObject(value)) {
            Object.entries(value).forEach(([key, item]) => queue.push({ value: item, segments: [...segments, key] }));
        }
    }

    return null;
}

// A key below the top level, breadth first, that can follow `$..`.
function findNestedKey(root: unknown): string | null {
    const queue: Array<{ readonly value: unknown; readonly depth: number }> = [{ value: root, depth: 0 }];

    for (let visited = 0; visited < queue.length && visited < MAX_VISITED; visited += 1) {
        const { value, depth } = queue[visited] ?? { value: null, depth: 0 };
        const children: Array<[string | null, unknown]> = Array.isArray(value)
            ? value.map((item) => [null, item])
            : isPlainObject(value) ? Object.entries(value) : [];

        for (const [key, item] of children) {
            if (key != null && depth >= 1 && IDENTIFIER.test(key)) {
                return key;
            }

            queue.push({ value: item, depth: depth + 1 });
        }
    }

    return null;
}

function listName(segments: ReadonlyArray<JsonPathSegment>): string {
    const name = [...segments].reverse().find((segment) => typeof segment === 'string');

    return name == null ? 'the array' : name;
}

function firstKey(object: Record<string, unknown>, accept: (value: unknown, key: string) => boolean): string | null {
    return Object.keys(object).find((key) => accept(object[key], key)) ?? null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPrimitive(value: unknown): boolean {
    return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

// A short value that reads the same in double quotes, without escapes.
function isPlainText(value: string): boolean {
    return value !== '' && value.length <= MAX_EXAMPLE_VALUE_LENGTH && !/["\\\r\n]/.test(value);
}

interface ElementEntry {
    readonly node: XmlNode;
    readonly parent: XmlNode | null;
}

// Every element in document order, up to a limit.
function walkElements(root: XmlNode): ElementEntry[] {
    const entries: ElementEntry[] = [];
    const visit = (node: XmlNode, parent: XmlNode | null): void => {
        if (entries.length >= MAX_VISITED) {
            return;
        }

        entries.push({ node, parent });
        node.children.forEach((child) => visit(child, node));
    };
    visit(root, null);

    return entries;
}

// The first name that two siblings share.
function findRepeatedName(elements: ReadonlyArray<ElementEntry>): string | null {
    for (const { node } of elements) {
        const seen = new Set<string>();

        for (const child of node.children) {
            if (seen.has(child.name)) {
                return child.name;
            }

            seen.add(child.name);
        }
    }

    return null;
}

function isTextLeaf(node: XmlNode): boolean {
    return node.children.length === 0 && node.text.trim() !== '';
}

// A short value in quotes the XPath parser reads back, or null when it has both quote marks, a line break or is long.
function quoteXPathValue(value: string): string | null {
    if (value === '' || value.length > MAX_EXAMPLE_VALUE_LENGTH || /[\r\n\\]/.test(value)) {
        return null;
    }

    if (!value.includes("'")) {
        return `'${value}'`;
    }

    return value.includes('"') ? null : `"${value}"`;
}
