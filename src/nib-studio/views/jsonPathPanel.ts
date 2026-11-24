import { notValidMessage } from '../../common/errorMessage.js';
import { runJsonPath, type JsonPathMatch } from '../../common/json/jsonPath.js';
import { JSON_DATA_FORMAT, type DataFormat, type JsonParseResult } from '../../common/json/jsonTree.js';
import { JsonPathBuilder } from '../../common/paths/jsonPathBuilder.js';
import { buildJsonPathExamples, JSON_PATH_SYNTAX } from '../../common/paths/pathExamples.js';
import {
    countJsonLines,
    describeJsonValue,
    formatJsonValue,
    jsonValueKind,
    jsonValueText,
} from '../../common/paths/valueFormat.js';
import {
    createPathResultsState,
    renderPathResults,
    type PathQueryLanguage,
    type PathQueryOutcome,
    type PathResultMatch,
    type PathResultsState,
} from './pathResults.js';

export interface JsonPathPanelOptions {
    readonly text: string;
    // How the text is read as data; JSON unless set, such as YAML.
    readonly format?: DataFormat;
    readonly expression: string;
    // The layout and help state, kept by the caller across renders.
    readonly state?: PathResultsState;
    // Called with every expression that runs, so the caller can keep it.
    readonly onRun: (expression: string) => void;
    // Called with the JSONPath the JSON tree gives the match, such as `$.orders[1].id`.
    readonly onReveal: (path: string) => void;
}

// The JSONPath view: runs an expression with jsonpath-plus and lists each match with its formatted value.
export function renderJsonPathPanel(pane: HTMLElement, options: JsonPathPanelOptions): void {
    const format = options.format ?? JSON_DATA_FORMAT;

    renderPathResults(pane, {
        language: jsonPathLanguage(format.parse(options.text), format),
        expression: options.expression,
        state: options.state ?? createPathResultsState(),
        onRun: options.onRun,
        onReveal: options.onReveal,
    });
}

function jsonPathLanguage(parsed: JsonParseResult, format: DataFormat): PathQueryLanguage {
    return {
        name: 'JSONPath',
        placeholder: '$.orders[*].id',
        firstIndex: 0,
        copyAllTitle: 'Copy all values as a JSON array',
        evaluate: (expression) => evaluate(parsed, format, expression),
        examples: () => (parsed.ok ? buildJsonPathExamples(parsed.value) : []),
        syntax: JSON_PATH_SYNTAX,
    };
}

function evaluate(parsed: JsonParseResult, format: DataFormat, expression: string): PathQueryOutcome {
    if (!parsed.ok) {
        return {
            ok: false,
            message: notValidMessage(format.name, parsed, 'Document is'),
            span: null,
            isDocumentError: true,
        };
    }

    const result = runJsonPath(parsed.value, expression);

    if (!result.ok) {
        const position = result.span == null ? '' : ` at character ${result.span.start + 1}`;

        return { ok: false, message: `Invalid JSONPath: ${result.message}${position}.`, span: result.span };
    }

    const values = result.matches.map((match) => match.value);

    return {
        ok: true,
        matches: result.matches.map(toResultMatch),
        copyAll: (layout) => jsonValueText(values, layout),
    };
}

function toResultMatch(match: JsonPathMatch): PathResultMatch {
    return {
        path: match.path,
        type: describeJsonValue(match.value),
        kind: jsonValueKind(match.value),
        format: (layout, limits) => formatJsonValue(match.value, layout, limits),
        lineCount: (layout) => countJsonLines(match.value, layout),
        copyText: (layout) => jsonValueText(match.value, layout),
        reveal: match.segments == null ? null : JsonPathBuilder.of(match.segments),
    };
}
