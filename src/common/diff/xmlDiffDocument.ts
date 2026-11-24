import type { JsonArrayRule, JsonDifference } from '../json/jsonComparer.js';
import { JsonPathBuilder, type JsonPathSegment } from '../paths/jsonPathBuilder.js';
import type { XmlNode } from '../paths/xmlParser.js';
import { compareXml, prepareXmlForCompare, type XmlArrayRule, type XmlCompareOptions } from '../xml/xmlCompare.js';
import {
    DIFF_DOCUMENT_FORMAT,
    DIFF_DOCUMENT_VERSION,
    summarizeChanges,
    type DiffDocumentSide,
    type XmlDiffDocument,
} from './diffDocument.js';
import { copyArrayRule, jsonDifferenceLabels, type JsonSides } from './jsonDiffDocument.js';
import { alignTreeRows } from './treeDiffRows.js';

export type XmlNames = 'xml' | 'json';

export interface XmlDiffDocumentInput {
    readonly original: DiffDocumentSide;
    readonly modified: DiffDocumentSide;
    readonly left: XmlNode;
    readonly right: XmlNode;
    readonly options?: Omit<XmlCompareOptions, 'arrayRules'>;
    readonly elementRules?: ReadonlyArray<XmlArrayRule>;
    // Elements and attributes by name; document order unless set.
    readonly sortNames?: boolean;
    // XML labels unless set to the JSON names the compare runs on.
    readonly names?: XmlNames;
}

export function buildXmlDiffDocument(input: XmlDiffDocumentInput): XmlDiffDocument {
    const rules = input.elementRules ?? [];
    const sortNames = input.sortNames ?? false;
    const names = input.names ?? 'xml';
    const compareOptions: XmlCompareOptions = { ...input.options, arrayRules: rules };
    const differences = compareXml(input.left, input.right, compareOptions);
    const prepared = prepareXmlForCompare(input.left, input.right, compareOptions);
    const { rows, changes } = alignTreeRows({
        left: prepared.left,
        right: prepared.right,
        differences,
        ids: xmlChangePaths(differences, prepared),
        sortKeys: sortNames,
        matchByFor: (segments) => {
            const path = `${JsonPathBuilder.anyItemsOf(segments)}[*]`;

            return prepared.arrayRules.find((rule) => rule.path === path)?.matchBy ?? null;
        },
        rulePathFor: elementPathOf,
        labelFor: names === 'xml' ? xmlLabel : undefined,
    });

    return {
        format: DIFF_DOCUMENT_FORMAT,
        version: DIFF_DOCUMENT_VERSION,
        kind: 'xml',
        original: input.original,
        modified: input.modified,
        options: {
            ignoreWhitespaceOnly: input.options?.ignoreWhitespaceOnly === true,
            trimText: input.options?.trimText === true,
            ignoreNamespacePrefixes: input.options?.ignoreNamespacePrefixes === true,
            caseSensitiveNames: input.options?.caseSensitiveNames !== false,
            elementRules: rules.map(copyArrayRule),
            sortNames,
            names,
        },
        summary: summarizeChanges(changes),
        changes,
        rows,
    };
}

// Element path of each difference, such as order/item[@id=5]/@price, naming repeated elements by index or by their rule's match key.
function xmlChangePaths(
    differences: ReadonlyArray<JsonDifference>,
    prepared: JsonSides & { readonly arrayRules: ReadonlyArray<JsonArrayRule> },
): string[] {
    return differences.map((difference) => {
        const steps: string[] = [];

        for (const label of jsonDifferenceLabels(difference, prepared, prepared.arrayRules)) {
            if (label.startsWith('[') && steps.length > 0 && !steps[steps.length - 1]!.startsWith('@')) {
                steps[steps.length - 1] = `${steps[steps.length - 1]}${label}`;
            }
            else {
                steps.push(label === '#text' ? 'text()' : label);
            }
        }

        return steps.length === 0 ? '/' : steps.join('/');
    });
}

// Element names as <name>, attributes as @name and text as text().
export function xmlLabel(label: string): string {
    if (label.startsWith('@') || label.startsWith('[')) {
        return label;
    }

    if (label === '#text') {
        return 'text()';
    }

    return `<${label}>`;
}

// Element path of a converted-JSON array, as an element rule names it: element names only, without indexes, attributes or text.
export function elementPathOf(segments: ReadonlyArray<JsonPathSegment>): string {
    return segments
        .filter((segment): segment is string => typeof segment === 'string' && !segment.startsWith('@') && segment !== '#text')
        .map((segment) => `/${segment}`)
        .join('');
}
