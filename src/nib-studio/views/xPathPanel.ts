import { notValidMessage } from '../../common/errorMessage.js';
import { buildXPathExamples, XPATH_SYNTAX } from '../../common/paths/pathExamples.js';
import {
    countXmlLines,
    countXmlTextLines,
    formatXmlAttribute,
    formatXmlNode,
    formatXmlText,
    valueLinesToText,
    type ValueLayout,
} from '../../common/paths/valueFormat.js';
import { XPath, type XPathMatch } from '../../common/paths/xPath.js';
import { XPathBuilder } from '../../common/paths/xPathBuilder.js';
import { parseXml, type XmlParseResult } from '../../common/paths/xmlParser.js';
import {
    createPathResultsState,
    renderPathResults,
    type PathQueryLanguage,
    type PathQueryOutcome,
    type PathResultMatch,
    type PathResultsState,
} from './pathResults.js';

export interface XPathPanelOptions {
    readonly text: string;
    readonly expression: string;
    // The layout and help state, kept by the caller across renders.
    readonly state?: PathResultsState;
    // Called with every expression that runs, so the caller can keep it.
    readonly onRun: (expression: string) => void;
    // Called with the exact XPath of a match for Show in tree.
    readonly onReveal: (path: string) => void;
}

// The XPath view: runs an expression over the document and lists each match with its XPath and formatted value.
export function renderXPathPanel(pane: HTMLElement, options: XPathPanelOptions): void {
    renderPathResults(pane, {
        language: xPathLanguage(parseXml(options.text)),
        expression: options.expression,
        state: options.state ?? createPathResultsState(),
        onRun: options.onRun,
        onReveal: options.onReveal,
    });
}

function xPathLanguage(parsed: XmlParseResult): PathQueryLanguage {
    return {
        name: 'XPath',
        placeholder: '//item/@id',
        firstIndex: 1,
        copyAllTitle: 'Copy all matches: elements as XML, attributes and text as their values',
        evaluate: (expression) => evaluate(parsed, expression),
        examples: () => (parsed.ok ? buildXPathExamples(parsed.root) : []),
        syntax: XPATH_SYNTAX,
    };
}

function evaluate(parsed: XmlParseResult, expression: string): PathQueryOutcome {
    if (!parsed.ok) {
        return {
            ok: false,
            message: notValidMessage('XML', parsed, 'Document is'),
            span: null,
            isDocumentError: true,
        };
    }

    const evaluation = XPath.evaluate(parsed.root, expression);

    if (!evaluation.ok) {
        return {
            ok: false,
            message: `Invalid XPath: ${evaluation.message} at character ${evaluation.position + 1}.`,
            span: { start: evaluation.position, end: evaluation.position + 1 },
        };
    }

    const matches = evaluation.matches.map(toResultMatch);

    return {
        ok: true,
        matches,
        // Elements as XML, attributes and text as their plain values, one per block.
        copyAll: (layout) => evaluation.matches
            .map((match, index) => match.kind === 'element' ? matches[index]?.copyText(layout) ?? '' : plainValue(match, layout))
            .join(layout === 'formatted' ? '\n\n' : '\n'),
    };
}

function toResultMatch(match: XPathMatch): PathResultMatch {
    const path = match.segments.length === 0 ? '/' : XPathBuilder.of(match.segments);
    // The document has no row of its own in the tree, so `/` shows the root element.
    const reveal = match.segments.length === 0 ? `/${match.node.children[0]?.name ?? ''}` : path;
    const shared = { path, kind: match.kind, reveal };

    if (match.kind === 'attribute') {
        const name = attributeName(match);

        return {
            ...shared,
            type: 'attribute',
            format: (_layout, limits) => formatXmlAttribute(name, match.value, limits),
            lineCount: () => 1,
            copyText: () => valueLinesToText(formatXmlAttribute(name, match.value).lines),
        };
    }

    if (match.kind === 'text') {
        return {
            ...shared,
            type: match.value.trim() === '' ? 'text · whitespace only' : 'text',
            format: (layout, limits) => formatXmlText(match.value, layout, limits),
            lineCount: (layout) => countXmlTextLines(match.value, layout),
            copyText: (layout) => valueLinesToText(formatXmlText(match.value, layout).lines),
        };
    }

    return {
        ...shared,
        type: describeElement(match),
        format: (layout, limits) => formatXmlNode(match.node, layout, limits),
        lineCount: (layout) => countXmlLines(match.node, layout),
        copyText: (layout) => valueLinesToText(formatXmlNode(match.node, layout).lines),
    };
}

function attributeName(match: XPathMatch): string {
    const last = match.segments[match.segments.length - 1];

    return last?.kind === 'attribute' ? last.name : '';
}

function plainValue(match: XPathMatch, layout: ValueLayout): string {
    return match.kind === 'attribute' ? match.value : valueLinesToText(formatXmlText(match.value, layout).lines);
}

// `element`, with the number of child elements when it has any.
function describeElement(match: XPathMatch): string {
    if (match.node.name === '#document') {
        return 'document';
    }

    const count = match.node.children.length;

    if (count === 0) {
        return 'element';
    }

    return `element · ${count.toLocaleString('en-US')} ${count === 1 ? 'child' : 'children'}`;
}
