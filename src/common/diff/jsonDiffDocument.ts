import { JsonComparer, type JsonArrayRule, type JsonDifference } from '../json/jsonComparer.js';
import { isPlainObject } from '../json/jsonTree.js';
import { JsonPathBuilder, type JsonPathSegment } from '../paths/jsonPathBuilder.js';
import {
    DIFF_DOCUMENT_FORMAT,
    DIFF_DOCUMENT_VERSION,
    summarizeChanges,
    type DiffArrayRule,
    type DiffDocumentSide,
    type JsonDiffDocument,
    type YamlDiffDocument,
} from './diffDocument.js';
import { alignTreeRows } from './treeDiffRows.js';

export interface JsonDiffDocumentInput {
    readonly original: DiffDocumentSide;
    readonly modified: DiffDocumentSide;
    // Parsed values; undefined for a side not chosen yet, which lays out the other side alone.
    readonly left: unknown;
    readonly right: unknown;
    readonly arrayRules?: ReadonlyArray<JsonArrayRule>;
    // Keys by name, naturally; file order when false. On unless set.
    readonly sortKeys?: boolean;
}

export interface JsonSides {
    readonly left: unknown;
    readonly right: unknown;
}

export function buildJsonDiffDocument(input: JsonDiffDocumentInput): JsonDiffDocument {
    const rules = input.arrayRules ?? [];
    const sortKeys = input.sortKeys ?? true;
    const compareOptions = { arrayRules: rules, keepKeyOrder: true };
    const left = input.left === undefined ? undefined : JsonComparer.normalize(input.left, compareOptions);
    const right = input.right === undefined ? undefined : JsonComparer.normalize(input.right, compareOptions);
    const differences = input.left === undefined || input.right === undefined
        ? []
        : JsonComparer.compare(input.left, input.right, compareOptions);
    const { rows, changes } = alignTreeRows({
        left,
        right,
        differences,
        ids: jsonChangePaths(differences, { left, right }, rules),
        sortKeys,
        matchByFor: (segments) => matchByOf(rules, segments),
        rulePathFor: (segments) => `${JsonPathBuilder.anyItemsOf(segments)}[*]`,
    });

    return {
        format: DIFF_DOCUMENT_FORMAT,
        version: DIFF_DOCUMENT_VERSION,
        kind: 'json',
        original: input.original,
        modified: input.modified,
        options: { arrayRules: rules.map(copyArrayRule), sortKeys, nullAsMissing: true },
        summary: summarizeChanges(changes),
        changes,
        rows,
    };
}

// Two YAML texts compared as the JSON data they hold: the JSON document under the YAML kind.
export function buildYamlDiffDocument(input: JsonDiffDocumentInput): YamlDiffDocument {
    return { ...buildJsonDiffDocument(input), kind: 'yaml' };
}

// A rule as plain data, with only the fields it sets.
export function copyArrayRule(rule: DiffArrayRule): DiffArrayRule {
    return {
        path: rule.path,
        ...(rule.matchBy == null ? {} : { matchBy: [...rule.matchBy] }),
        ...(rule.sortBy == null ? {} : { sortBy: [...rule.sortBy] }),
    };
}

// Readable path of each difference, such as items[0].price, naming matched array items by their match fields, as in items[id=5].
function jsonChangePaths(
    differences: ReadonlyArray<JsonDifference>,
    sides: JsonSides,
    rules: ReadonlyArray<JsonArrayRule>,
): string[] {
    return differences.map((difference) => joinJsonPath(difference.segments, jsonDifferenceLabels(difference, sides, rules)));
}

// One label per step from the root, such as `items`, `[id=5]`, `price`.
export function jsonDifferenceLabels(
    difference: Pick<JsonDifference, 'kind' | 'segments'>,
    sides: JsonSides,
    rules: ReadonlyArray<JsonArrayRule>,
): string[] {
    const root = difference.kind === 'added' ? sides.right : sides.left;

    return difference.segments.map((segment, depth) => typeof segment === 'string'
        ? segment
        : itemLabel(root, difference.segments.slice(0, depth + 1), rules));
}

function matchByOf(rules: ReadonlyArray<JsonArrayRule>, segments: ReadonlyArray<JsonPathSegment>): ReadonlyArray<string> | null {
    const path = `${JsonPathBuilder.anyItemsOf(segments)}[*]`;

    return rules.find((rule) => rule.path === path)?.matchBy ?? null;
}

function joinJsonPath(segments: ReadonlyArray<JsonPathSegment>, labels: ReadonlyArray<string>): string {
    let path = '';

    labels.forEach((label, depth) => {
        if (typeof segments[depth] === 'number') {
            path += label;
        }
        else if (/^[A-Za-z_$][\w$-]*$/.test(label)) {
            path += path === '' ? label : `.${label}`;
        }
        else {
            path += `[${JSON.stringify(label)}]`;
        }
    });

    return path === '' ? '$' : path;
}

function itemLabel(root: unknown, segments: ReadonlyArray<JsonPathSegment>, rules: ReadonlyArray<JsonArrayRule>): string {
    const index = segments[segments.length - 1];
    const arrayPath = `${JsonPathBuilder.anyItemsOf(segments.slice(0, -1))}[*]`;
    const matchBy = rules.find((rule) => rule.path === arrayPath)?.matchBy ?? [];
    const item = valueAt(root, segments);

    if (matchBy.length === 0 || !isPlainObject(item)) {
        return `[${String(index)}]`;
    }

    const parts = matchBy.map((field) => {
        const value = valueAt(item, field.split('.'));

        return `${field}=${typeof value === 'string' ? value : JSON.stringify(value) ?? '?'}`;
    });

    return `[${parts.join(', ')}]`;
}

function valueAt(root: unknown, segments: ReadonlyArray<JsonPathSegment>): unknown {
    let current = root;

    for (const segment of segments) {
        if (typeof segment === 'number') {
            current = Array.isArray(current) ? current[segment] : undefined;
        }
        else {
            current = isPlainObject(current) ? current[segment] : undefined;
        }
    }

    return current;
}
