import {
    isAlias,
    isCollection,
    isScalar,
    LineCounter,
    parseAllDocuments,
    visit,
    type Alias,
    type Document,
    type DocumentOptions,
    type ParseOptions,
    type ScalarTag,
    type SchemaOptions,
    type Tags,
    type YAMLError,
} from 'yaml';

// Reads YAML text as a stream of documents with the `yaml` package, and reports what is wrong with it
// as issues with offsets, lines and columns.

export type YamlIssueSeverity = 'error' | 'warning';

export interface YamlIssue {
    readonly severity: YamlIssueSeverity;
    readonly message: string;
    // Offsets into the text: `from` inclusive, `to` exclusive.
    readonly from: number;
    readonly to: number;
    // 1-based.
    readonly line: number;
    readonly column: number;
}

export interface YamlStream {
    readonly documents: ReadonlyArray<Document.Parsed>;
    // Errors and warnings of every document, in text order.
    readonly issues: ReadonlyArray<YamlIssue>;
    readonly lineCounter: LineCounter;
}

export interface YamlFailure {
    readonly ok: false;
    readonly message: string;
    readonly line: number;
    readonly column: number;
}

export type YamlParseOptions = ParseOptions & DocumentOptions & SchemaOptions;

const TIMESTAMP_TAG = 'tag:yaml.org,2002:timestamp';

// The parser's message for a repeated key, which YAML calls an error and Nib Studio reports as a warning:
// the data keeps the last value, as JSON does.
const DUPLICATE_KEY_CODE = 'DUPLICATE_KEY';

// A repeated key longer than this is left out of its message.
const MAX_KEY_IN_MESSAGE = 40;

// Where offsets are counted from, to give an issue its line and column.
interface IssueSource {
    readonly text: string;
    readonly lineCounter: LineCounter;
}

// Options shared by every read: plain messages without the source excerpt, nothing logged to the console,
// and `<<` merge keys applied, as YAML 1.1 tools such as Docker Compose and GitLab CI expect.
export const BASE_PARSE_OPTIONS: YamlParseOptions = Object.freeze({
    prettyErrors: false,
    logLevel: 'error',
    merge: true,
});

// Timestamps stay the text they were written as, whether implicit in YAML 1.1 or tagged `!!timestamp`.
function timestampsAsText(tags: Tags): Tags {
    const timestamp = tags.find((tag): tag is ScalarTag => typeof tag === 'object' && tag.tag === TIMESTAMP_TAG);
    const others = tags.filter((tag) => typeof tag === 'string' || tag.tag !== TIMESTAMP_TAG);
    const asText: ScalarTag = {
        tag: TIMESTAMP_TAG,
        default: timestamp?.default ?? false,
        test: timestamp?.test,
        identify: () => false,
        resolve: (text) => text,
    };

    return [...others, asText];
}

// Parses every document of the text, for its data: timestamps stay text and repeated keys are reported.
export function parseYamlStream(text: string): YamlStream {
    const lineCounter = new LineCounter();
    const documents = parseAllDocuments(text, {
        ...BASE_PARSE_OPTIONS,
        uniqueKeys: true,
        lineCounter,
        customTags: timestampsAsText,
    });
    const source: IssueSource = { text, lineCounter };
    const issues = documents.flatMap((document) => documentIssues(document, source));
    // Errors outside any document, such as a directive with no document after it.
    const streamIssues = 'empty' in documents
        ? documents.errors.map((error) => toIssue(error, 'error', source))
        : [];

    return {
        documents: [...documents],
        issues: sortIssues([...streamIssues, ...issues]),
        lineCounter,
    };
}

function documentIssues(document: Document.Parsed, source: IssueSource): YamlIssue[] {
    const issues: YamlIssue[] = [];

    for (const error of document.errors) {
        if (error.code === DUPLICATE_KEY_CODE) {
            issues.push({ ...toIssue(error, 'warning', source), message: duplicateKeyMessage(source.text, error) });
            continue;
        }

        issues.push(toIssue(error, 'error', source));
    }

    for (const warning of document.warnings) {
        issues.push(toIssue(warning, 'warning', source));
    }

    const unresolved = findUnresolvedAlias(document);

    if (unresolved != null) {
        issues.push(issueAt({
            ...source,
            severity: 'error',
            message: `No anchor &${unresolved.source} comes before this alias`,
            range: unresolved.range,
        }));
    }

    return issues;
}

function duplicateKeyMessage(text: string, error: YAMLError): string {
    const key = text.slice(error.pos[0]).match(/^[^:\n]*/)?.[0]?.trim() ?? '';

    return key === '' || key.length > MAX_KEY_IN_MESSAGE
        ? 'This key is repeated; the last value wins'
        : `The key ${key} is repeated; the last value wins`;
}

function toIssue(error: YAMLError, severity: YamlIssueSeverity, source: IssueSource): YamlIssue {
    return issueAt({ ...source, severity, message: error.message, range: error.pos });
}

interface IssueAtInput extends IssueSource {
    readonly severity: YamlIssueSeverity;
    readonly message: string;
    readonly range: readonly [number, number, ...number[]] | undefined;
}

function issueAt(input: IssueAtInput): YamlIssue {
    const { severity, message, range, lineCounter, text } = input;
    const from = clamp(range?.[0] ?? 0, text.length);
    const to = Math.max(from, clamp(range?.[1] ?? from, text.length));
    const position = lineCounter.linePos(from);

    return { severity, message, from, to, line: position.line, column: position.col };
}

function clamp(offset: number, length: number): number {
    return Math.max(0, Math.min(offset, length));
}

function sortIssues(issues: YamlIssue[]): YamlIssue[] {
    return issues.sort((left, right) => left.from - right.from || left.to - right.to);
}

// The first error, which is what a toast or a view reports.
export function firstYamlError(stream: YamlStream): YamlFailure | null {
    const error = stream.issues.find((issue) => issue.severity === 'error');

    return error == null ? null : failure(error.message, error);
}

export function failure(message: string, position: Pick<YamlIssue, 'line' | 'column'>): YamlFailure {
    return { ok: false, message, line: position.line, column: position.column };
}

// An alias with no anchor of its name before it in its own document, which no reader can resolve.
function findUnresolvedAlias(document: Document.Parsed): Alias.Parsed | null {
    const anchors = new Set<string>();
    let unresolved: Alias.Parsed | null = null;

    visit(document, (_key, node) => {
        if (isAlias(node)) {
            if (!anchors.has(node.source)) {
                unresolved = node as Alias.Parsed;

                return visit.BREAK;
            }

            return undefined;
        }

        if ((isScalar(node) || isCollection(node)) && node.anchor != null) {
            anchors.add(node.anchor);
        }

        return undefined;
    });

    return unresolved;
}

// The first alias of the document, where an expansion that went too far is reported.
export function firstAlias(document: Document.Parsed): Alias.Parsed | null {
    let first: Alias.Parsed | null = null;

    visit(document, {
        Alias: (_key, node) => {
            first = node as Alias.Parsed;

            return visit.BREAK;
        },
    });

    return first;
}
