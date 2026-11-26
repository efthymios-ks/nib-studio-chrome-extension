import type { MarkdownDiff } from '../markdown/diff/types.js';
import type { WhitespaceRule } from '../text/textCompareRules.js';

// The one shape every comparison produces, whatever it compares: plain JSON with no functions, DOM nodes or Maps,
// so it can be saved, read back and drawn again. The same inputs always give the same document.

export const DIFF_DOCUMENT_FORMAT = 'nib-studio-diff';

export const DIFF_DOCUMENT_VERSION = 1;

export type DiffDocumentKind = 'text' | 'json' | 'yaml' | 'xml' | 'rows' | 'markdown';

export type DiffChangeKind = 'added' | 'removed' | 'changed' | 'typeChanged';

// A cell's own state; 'ignored' marks a line the compare rules left out.
export type DiffCellStatus = 'unchanged' | 'added' | 'removed' | 'changed' | 'typeChanged' | 'ignored';

// Where a side came from; 'none' stands for a side not chosen yet, which no export ever holds.
export type DiffSourceKind = 'file' | 'open-tab' | 'disk' | 'clipboard' | 'pasted' | 'edited' | 'none';

// The sides that show a change: Before leaves out changes only the modified side has, After those only the original has.
export type DiffChangeSides = 'both' | 'original' | 'modified';

export type DiffTokenType =
    | 'text'
    | 'string'
    | 'number'
    | 'boolean'
    | 'null'
    | 'object'
    | 'array'
    | 'count'
    | 'markdown';

export type DiffNodeRole = 'open' | 'close' | 'leaf';

export type DiffValue = null | boolean | number | string | DiffValue[] | { [key: string]: DiffValue };

export interface DiffDocumentSide {
    // Short name, such as the file name or "Pasted text".
    readonly name: string;
    readonly source: DiffSourceKind;
    // Workspace path, or the file name of a file from disk; absent for text with no file.
    readonly path?: string;
    // The sheet compared, for a workbook.
    readonly sheet?: string;
}

export interface DiffSummary {
    // Every change, of any kind.
    readonly total: number;
    readonly added: number;
    readonly removed: number;
    readonly changed: number;
    readonly typeChanged: number;
    // Table rows both files hold unchanged, or Markdown blocks that did not change.
    readonly unchanged?: number;
    // Lines of a text diff: added, removed, and left out by the compare rules.
    readonly lines?: { readonly added: number; readonly removed: number; readonly ignored: number };
}

export interface DiffLineSpan {
    readonly from: number;
    readonly to: number;
}

export interface DiffLocation {
    // Readable path of a JSON node (`items[id=5].price`), an XML node (`library/book[3]/title`) or a Markdown heading path.
    readonly path?: string;
    // JSONPath of the node on the side that shows the change; XML nodes as the JSON the compare runs on.
    readonly pointer?: string;
    // Lines of a text change on each side, 1-based; null for a side the change has no line on.
    readonly lines?: { readonly original: DiffLineSpan | null; readonly modified: DiffLineSpan | null };
    // Key of a table row: its key column values, joined with ", ".
    readonly key?: string;
    // Column of a changed table cell.
    readonly column?: string;
}

export interface DiffChange {
    // Stable for the same inputs; also what the bar's position names.
    readonly id: string;
    readonly kind: DiffChangeKind;
    readonly location: DiffLocation;
    // Index in `rows` of the first row that shows the change.
    readonly row?: number;
    readonly before?: DiffValue;
    readonly after?: DiffValue;
}

export interface DiffToken {
    readonly text: string;
    readonly type: DiffTokenType;
    // Column of a table cell.
    readonly column?: string;
    // A table cell's own state, and the change it belongs to.
    readonly status?: DiffCellStatus;
    readonly change?: string;
}

export interface DiffCell {
    readonly status: DiffCellStatus;
    // Line of a text side, number of a table row among the file's rows, or first line of a Markdown block; 1-based.
    readonly line?: number;
    // Nesting depth of a tree node; the root is 0.
    readonly depth?: number;
    // Key or label: a JSON key or `[2]` / `[id=5]` item, an XML name, a table row's key, a Markdown block type.
    readonly label?: string;
    // JSONPath of a tree node on its side.
    readonly path?: string;
    readonly node?: DiffNodeRole;
    // An object or array shown closed until it is opened: nothing under it changed.
    readonly collapsed?: boolean;
    // The path an array rule for this array's items uses: `$.items[*]` for JSON, `/library/book` for XML.
    readonly rulePath?: string;
    // The value, as typed tokens; a table cell has one per column, null where the file lacks the column.
    readonly tokens: ReadonlyArray<DiffToken | null>;
}

export interface DiffRow {
    // The change this row shows, if any.
    readonly change?: string;
    // Null is a placeholder: the side has nothing on this row.
    readonly left: DiffCell | null;
    readonly right: DiffCell | null;
}

export interface DiffColumn {
    readonly name: string;
    readonly original: boolean;
    readonly modified: boolean;
}

export interface DiffArrayRule {
    readonly path: string;
    readonly matchBy?: ReadonlyArray<string>;
    readonly sortBy?: ReadonlyArray<string>;
}

export interface TextDiffOptions {
    readonly whitespace: WhitespaceRule;
    readonly ignoreCase: boolean;
    readonly ignoreBlankLines: boolean;
    readonly normalizeLineEndings: boolean;
    readonly ignorePatterns: ReadonlyArray<string>;
    readonly sortLines: boolean;
    readonly uniqueLines: boolean;
    readonly trimLines: boolean;
}

export interface JsonDiffOptions {
    readonly arrayRules: ReadonlyArray<DiffArrayRule>;
    readonly sortKeys: boolean;
    // A value in place of null counts as added, and null in place of a value as removed.
    readonly nullAsMissing: true;
}

export interface XmlDiffOptions {
    readonly ignoreWhitespaceOnly: boolean;
    readonly trimText: boolean;
    readonly ignoreNamespacePrefixes: boolean;
    readonly caseSensitiveNames: boolean;
    readonly elementRules: ReadonlyArray<DiffArrayRule>;
    readonly sortNames: boolean;
    // Labels as XML (`<book>`, `@id`, `text()`) or as the JSON names the compare runs on.
    readonly names: 'xml' | 'json';
}

export interface RowsDiffOptions {
    readonly keyColumns: ReadonlyArray<string>;
    readonly sortColumns: ReadonlyArray<string>;
    readonly ignoreColumns: ReadonlyArray<string>;
    readonly sortColumnsByName: boolean;
    readonly caseSensitive: boolean;
}

export interface MarkdownDiffOptions {
    readonly changesOnly: boolean;
}

interface DiffDocumentBase<Kind extends DiffDocumentKind, Options> {
    readonly format: typeof DIFF_DOCUMENT_FORMAT;
    readonly version: typeof DIFF_DOCUMENT_VERSION;
    readonly kind: Kind;
    readonly original: DiffDocumentSide;
    readonly modified: DiffDocumentSide;
    readonly options: Options;
    readonly summary: DiffSummary;
    // In the order the rows show them, top to bottom.
    readonly changes: ReadonlyArray<DiffChange>;
    // Both sides aligned row for row.
    readonly rows: ReadonlyArray<DiffRow>;
}

export type TextDiffDocument = DiffDocumentBase<'text', TextDiffOptions>;

export type JsonDiffDocument = DiffDocumentBase<'json', JsonDiffOptions>;

// YAML compared as the JSON data it holds, with the same rows, options and paths as JSON.
export type YamlDiffDocument = DiffDocumentBase<'yaml', JsonDiffOptions>;

export type DataDiffDocument = JsonDiffDocument | YamlDiffDocument;

export type XmlDiffDocument = DiffDocumentBase<'xml', XmlDiffOptions>;

export interface RowsDiffDocument extends DiffDocumentBase<'rows', RowsDiffOptions> {
    // Every column of either file, in the order the rows hold their tokens.
    readonly columns: ReadonlyArray<DiffColumn>;
}

export interface MarkdownDiffDocument extends DiffDocumentBase<'markdown', MarkdownDiffOptions> {
    // The Markdown compare as it is, which its own renderer draws.
    readonly markdown: MarkdownDiff;
}

export type TreeDiffDocument = DataDiffDocument | XmlDiffDocument;

export type DiffDocument =
    | TextDiffDocument
    | JsonDiffDocument
    | YamlDiffDocument
    | XmlDiffDocument
    | RowsDiffDocument
    | MarkdownDiffDocument;

export type DiffExportExtension = 'json' | 'html';

const FILE_NAME_LIMIT = 60;

const SIDE_FALLBACK_NAMES = Object.freeze({
    original: 'original',
    modified: 'modified',
});

export function summarizeChanges(changes: ReadonlyArray<DiffChange>): DiffSummary {
    const count = (kind: DiffChangeKind): number => changes.filter((change) => change.kind === kind).length;

    return {
        total: changes.length,
        added: count('added'),
        removed: count('removed'),
        changed: count('changed'),
        typeChanged: count('typeChanged'),
    };
}

export function sidesOfChange(kind: DiffChangeKind): DiffChangeSides {
    if (kind === 'added') {
        return 'modified';
    }

    return kind === 'removed' ? 'original' : 'both';
}

// The document as indented JSON, as an export saves it.
export function serializeDiffDocument(document: DiffDocument): string {
    return `${JSON.stringify(document, null, 2)}\n`;
}

// `<original>-vs-<modified>.diff.json` or `.diff.html`, from the side names without their extensions.
export function diffExportFileName(document: DiffDocument, extension: DiffExportExtension): string {
    const original = fileNamePart(document.original.name, SIDE_FALLBACK_NAMES.original);
    const modified = fileNamePart(document.modified.name, SIDE_FALLBACK_NAMES.modified);

    return `${original}-vs-${modified}.diff.${extension}`;
}

function fileNamePart(name: string, fallback: string): string {
    const extensionAt = name.lastIndexOf('.');
    const stem = extensionAt > 0 ? name.slice(0, extensionAt) : name;
    const safe = trimSeparators(stem.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/-{2,}/g, '-'));
    const short = trimSeparators(safe.slice(0, FILE_NAME_LIMIT));

    return short === '' ? fallback : short;
}

function trimSeparators(text: string): string {
    return text.replace(/^[-.]+|[-.]+$/g, '');
}
