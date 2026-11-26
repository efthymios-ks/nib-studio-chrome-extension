import { escapeHtml } from '../html/escapeHtml.js';
import { renderDiffHtmlAsync } from '../markdown/diff/htmlRenderer.js';
import type { MermaidRenderer } from '../markdown/diff/types.js';
import {
    sidesOfChange,
    type DiffCell,
    type DiffChange,
    type DiffDocument,
    type DiffDocumentKind,
    type DiffDocumentSide,
    type DiffRow,
    type DiffToken,
    type MarkdownDiffDocument,
    type RowsDiffDocument,
    type TextDiffDocument,
    type TreeDiffDocument,
} from './diffDocument.js';
import { markdownDiffTitle } from './markdownDiffDocument.js';

// Turns a diff document into one standalone HTML page: inline styles and script only, nothing fetched,
// light or dark as the system prefers. A Markdown diff is the Markdown renderer's own page.

export interface DiffHtmlOptions {
    // Draws the Mermaid diagrams of a Markdown diff; without it they show as diffed code.
    readonly renderMermaid?: MermaidRenderer;
}

type StructuredDiffDocument = Exclude<DiffDocument, MarkdownDiffDocument>;

const KIND_LABELS: Readonly<Record<DiffDocumentKind, string>> = Object.freeze({
    text: 'Text',
    json: 'JSON',
    yaml: 'YAML',
    xml: 'XML',
    rows: 'Table',
    markdown: 'Markdown',
});

const SIDE_BADGES = Object.freeze({
    original: 'Original',
    modified: 'Modified',
});

const SOURCE_DETAILS: Readonly<Record<DiffDocumentSide['source'], (side: DiffDocumentSide) => string>> = Object.freeze({
    'file': (side) => side.path ?? side.name,
    'open-tab': (side) => `${side.path ?? side.name} (open tab)`,
    'disk': (side) => `${side.path ?? side.name} (from disk)`,
    'clipboard': () => 'Text read from the clipboard',
    'pasted': () => 'Text pasted into Nib Studio',
    'edited': () => 'Text edited in Nib Studio',
    'none': () => 'Not chosen',
});

const TEXT_MARKERS: Readonly<Partial<Record<DiffCell['status'], string>>> = Object.freeze({
    added: 'add',
    removed: 'del',
    ignored: 'ignored',
});

const DEPTH_INDENT_PIXELS = 16;

const NARROW_DEPTH_INDENT_PIXELS = 10;

export async function renderDiffDocumentHtmlAsync(document: DiffDocument, options: DiffHtmlOptions = {}): Promise<string> {
    if (document.kind === 'markdown') {
        const result = await renderDiffHtmlAsync(document.markdown, {
            title: markdownDiffTitle(document),
            changesOnly: document.options.changesOnly,
            renderMermaid: options.renderMermaid,
        });

        return result.html;
    }

    return renderStructuredPage(document);
}

// What the bar's position names for a change: its path, row and column, or lines.
export function changeLabel(change: DiffChange): string {
    const lines = change.location.lines;

    if (lines == null) {
        return change.id;
    }

    const span = (side: string, range: { readonly from: number; readonly to: number } | null): string | null => {
        if (range == null) {
            return null;
        }

        return range.from === range.to ? `${side} line ${range.from}` : `${side} lines ${range.from}–${range.to}`;
    };
    const parts = [span('original', lines.original), span('modified', lines.modified)].filter((part): part is string => part != null);
    const label = parts.join(', ');

    return label.charAt(0).toUpperCase() + label.slice(1);
}

function renderStructuredPage(document: StructuredDiffDocument): string {
    const title = `${document.original.name} ↔ ${document.modified.name}`;
    const content = renderContent(document, new Map(document.changes.map((change) => [change.id, change])));

    return [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'">',
        `<title>${escapeHtml(title)} · ${KIND_LABELS[document.kind]} diff</title>`,
        `<style>${PAGE_CSS}${content.css}</style>`,
        '</head>',
        `<body data-view="diff" data-kind="${document.kind}">`,
        '<header class="nd-page-header">',
        `<h1 class="nd-title">${escapeHtml(title)}</h1>`,
        `<p class="nd-subtitle">${KIND_LABELS[document.kind]} compare</p>`,
        '</header>',
        '<main class="nd-scroller" tabindex="0" aria-label="Both sides, row for row">',
        content.html,
        '</main>',
        renderBar(document.changes.length),
        `<script>${PAGE_SCRIPT}</script>`,
        '</body>',
        '</html>',
        '',
    ].join('\n');
}

interface RenderedContent {
    readonly html: string;
    readonly css: string;
}

type ChangesById = ReadonlyMap<string, DiffChange>;

function renderContent(document: StructuredDiffDocument, changes: ChangesById): RenderedContent {
    if (document.kind === 'text') {
        return renderTextContent(document, changes);
    }

    if (document.kind === 'rows') {
        return renderTableContent(document, changes);
    }

    return renderTreeContent(document, changes);
}

function renderBar(changeCount: number): string {
    const empty = changeCount === 0;

    return [
        `<div class="nd-bar" role="toolbar" aria-label="Diff view"${empty ? ' data-empty="true"' : ''}>`,
        '<div class="nd-bar-views" role="group" aria-label="Show">',
        '<button type="button" class="nd-bar-button" data-view="diff" aria-pressed="true" title="Insertions and deletions">Diff</button>',
        '<button type="button" class="nd-bar-button" data-view="before" aria-pressed="false" title="Read the original">Before</button>',
        '<button type="button" class="nd-bar-button" data-view="after" aria-pressed="false" title="Read the revision">After</button>',
        '</div>',
        '<button type="button" class="nd-bar-button nd-bar-step" data-step="-1" title="Previous change (p)" aria-label="Previous change">&#8593;</button>',
        `<span class="nd-bar-position" aria-live="polite">${empty ? 'No changes' : `&ndash; / ${changeCount}`}</span>`,
        '<button type="button" class="nd-bar-button nd-bar-step" data-step="1" title="Next change (n)" aria-label="Next change">&#8595;</button>',
        '</div>',
    ].join('');
}

// A workbook's side also names the sheet compared.
function renderSideHeader(which: 'original' | 'modified', side: DiffDocumentSide): string {
    const source = SOURCE_DETAILS[side.source](side);
    const detail = side.sheet == null ? source : `${source} · Sheet: ${side.sheet}`;

    return `<div class="nd-side-header" data-side="${which}">`
        + `<span class="nd-badge">${SIDE_BADGES[which]}</span>`
        + `<span class="nd-name">${escapeHtml(side.name)}</span>`
        + `<span class="nd-detail">${escapeHtml(detail)}</span>`
        + '</div>';
}

function renderHeaders(document: StructuredDiffDocument): string {
    return `<div class="nd-headers">${renderSideHeader('original', document.original)}${renderSideHeader('modified', document.modified)}</div>`;
}

// Data attributes that make an element a stop of the bar.
function changeAttributes(change: DiffChange | undefined): string {
    if (change == null) {
        return '';
    }

    return ` data-change="${escapeHtml(change.id)}" data-sides="${sidesOfChange(change.kind)}" data-label="${escapeHtml(changeLabel(change))}"`;
}

function onlyAttribute(row: DiffRow): string {
    if (row.left != null && row.right != null) {
        return '';
    }

    return ` data-only="${row.left == null ? 'modified' : 'original'}"`;
}

function renderTextContent(document: TextDiffDocument, changes: ChangesById): RenderedContent {
    const parts: string[] = [renderHeaders(document), '<div class="nd-text">'];
    let lastNumber = 0;
    let index = 0;

    while (index < document.rows.length) {
        const row = document.rows[index]!;
        lastNumber = Math.max(lastNumber, row.left?.line ?? 0, row.right?.line ?? 0);

        if (row.change == null) {
            parts.push(renderTextRow(row));
            index += 1;

            continue;
        }

        // The rows of one change share a hunk, which the bar steps to.
        const hunk: string[] = [];

        while (index < document.rows.length && document.rows[index]!.change === row.change) {
            const inner = document.rows[index]!;
            lastNumber = Math.max(lastNumber, inner.left?.line ?? 0, inner.right?.line ?? 0);
            hunk.push(renderTextRow(inner));
            index += 1;
        }

        parts.push(`<div class="nd-hunk"${changeAttributes(changes.get(row.change))}>${hunk.join('')}</div>`);
    }

    parts.push('</div>');

    // Line numbers as wide as the longest one.
    const digits = String(lastNumber).length;

    return {
        html: parts.join('\n'),
        css: `.nd-text{--number-width:calc(${digits}ch + 28px);}@media (max-width:720px){.nd-text{--number-width:calc(${digits}ch + 18px);}}`,
    };
}

function renderTextRow(row: DiffRow): string {
    return `<div class="nd-text-row"${onlyAttribute(row)}>${renderTextCells(row.left, 'original')}${renderTextCells(row.right, 'modified')}</div>`;
}

function renderTextCells(cell: DiffCell | null, side: 'original' | 'modified'): string {
    if (cell == null) {
        return `<span class="nd-number" data-side="${side}" data-placeholder="true"></span>`
            + `<span class="nd-line" data-side="${side}" data-placeholder="true"></span>`;
    }

    const marker = TEXT_MARKERS[cell.status];
    const attributes = `data-side="${side}"${marker == null ? '' : ` data-marker="${marker}"`}`;

    return `<span class="nd-number" ${attributes}>${cell.line ?? ''}</span>`
        + `<span class="nd-line" ${attributes}>${escapeHtml(tokensText(cell.tokens))}</span>`;
}

function tokensText(tokens: ReadonlyArray<DiffToken | null>): string {
    return tokens.map((token) => token?.text ?? '').join(' ');
}

function renderTreeContent(document: TreeDiffDocument, changes: ChangesById): RenderedContent {
    const parts: string[] = [renderHeaders(document), '<div class="nd-tree" role="grid">'];
    const depths = new Set<number>();
    // Rows under a closed object or array start hidden; this is the depth of the closed one.
    let hiddenUnder: number | null = null;

    for (const row of document.rows) {
        const cell = row.left ?? row.right;
        const depth = cell?.depth ?? 0;
        const node = cell?.node ?? 'leaf';
        const collapsed = node === 'open' && cell?.collapsed === true;
        // Inside the closed one, up to and with its closing row.
        const hidden = hiddenUnder != null;

        if (hiddenUnder != null && depth <= hiddenUnder) {
            hiddenUnder = null;
        }

        if (!hidden && collapsed) {
            hiddenUnder = depth;
        }

        depths.add(depth);
        parts.push(renderTreeRow({ row, depth, node, collapsed, hidden, change: row.change == null ? undefined : changes.get(row.change) }));
    }

    parts.push('</div>');

    const indent = (base: number, pixels: number): string => [...depths]
        .sort((first, second) => first - second)
        .map((depth) => `.nd-cell[data-depth="${depth}"]{padding-left:${base + depth * pixels}px;}`)
        .join('');

    return {
        html: parts.join('\n'),
        css: `${indent(8, DEPTH_INDENT_PIXELS)}@media (max-width:720px){${indent(4, NARROW_DEPTH_INDENT_PIXELS)}}`,
    };
}

interface TreeRowOptions {
    readonly row: DiffRow;
    readonly depth: number;
    readonly node: string;
    readonly collapsed: boolean;
    readonly hidden: boolean;
    readonly change: DiffChange | undefined;
}

function renderTreeRow(options: TreeRowOptions): string {
    const { row, depth, node, collapsed, hidden, change } = options;
    const attributes = [
        `data-depth="${depth}"`,
        `data-node="${node}"`,
        node === 'open' ? `data-collapsed="${collapsed}"` : '',
        onlyAttribute(row).trim(),
        changeAttributes(change).trim(),
        hidden ? 'hidden' : '',
    ].filter((attribute) => attribute !== '').join(' ');

    return `<div class="nd-tree-row" role="row" ${attributes}>`
        + renderTreeCell(row.left, 'original', options)
        + renderTreeCell(row.right, 'modified', options)
        + '</div>';
}

function renderTreeCell(cell: DiffCell | null, side: 'original' | 'modified', options: TreeRowOptions): string {
    if (cell == null) {
        return `<div class="nd-cell" role="gridcell" data-side="${side}" data-depth="${options.depth}" data-placeholder="true"></div>`;
    }

    // Cells show their state on the row of a change, as the diff in Nib Studio does.
    const marked = options.change != null && cell.status !== 'unchanged' && options.node !== 'close';
    const value = cell.tokens[0];
    const count = cell.tokens[1];
    const twistLabel = options.collapsed ? 'Expand' : 'Collapse';
    const twistGlyph = options.collapsed ? '&#9656;' : '&#9662;';
    const twist = options.node === 'open'
        ? `<button type="button" class="nd-twist" aria-expanded="${!options.collapsed}" aria-label="${twistLabel}">${twistGlyph}</button>`
        : '<span class="nd-twist" aria-hidden="true"></span>';
    const label = cell.label == null ? '' : `<span class="nd-key">${escapeHtml(cell.label)}</span><span class="nd-punct">:</span>`;

    return `<div class="nd-cell" role="gridcell" data-side="${side}" data-depth="${options.depth}"${marked ? ` data-diff="${cell.status}"` : ''}>`
        + twist
        + label
        + `<span class="nd-value" data-type="${value?.type ?? 'text'}">${escapeHtml(value?.text ?? '')}</span>`
        + (count == null ? '' : `<span class="nd-count">${escapeHtml(count.text)}</span>`)
        + '</div>';
}

function renderTableContent(document: RowsDiffDocument, changes: ChangesById): RenderedContent {
    const span = document.columns.length + 1;
    const header = (side: 'original' | 'modified'): string => [
        `<th class="nd-row-key" data-side="${side}">#</th>`,
        ...document.columns.map((column) => column[side]
            ? `<th data-side="${side}">${escapeHtml(column.name)}</th>`
            : `<th data-side="${side}" data-placeholder="true" title="${escapeHtml(column.name)} is not in this file"></th>`),
    ].join('');
    const parts = [
        '<table class="nd-table">',
        '<thead>',
        `<tr class="nd-table-sides"><th colspan="${span}" data-side="original">${renderSideHeader('original', document.original)}</th>`
            + `<th colspan="${span}" data-side="modified">${renderSideHeader('modified', document.modified)}</th></tr>`,
        `<tr>${header('original')}${header('modified')}</tr>`,
        '</thead>',
        '<tbody>',
    ];

    for (const row of document.rows) {
        parts.push(renderTableRow(row, document, changes));
    }

    parts.push('</tbody>', '</table>');

    return { html: parts.join('\n'), css: '' };
}

function renderTableRow(row: DiffRow, document: RowsDiffDocument, changes: ChangesById): string {
    const rowChange = row.change == null ? undefined : changes.get(row.change);
    const wholeRow = rowChange?.location.column == null ? rowChange : undefined;
    const key = row.left?.label ?? row.right?.label ?? '';
    const marker = tableMarkerOf(row);

    return `<tr data-key="${escapeHtml(key)}"${marker == null ? '' : ` data-marker="${marker}"`}${onlyAttribute(row)}${changeAttributes(wholeRow)}>`
        + renderTableCells(row.left, 'original', document, changes)
        + renderTableCells(row.right, 'modified', document, changes)
        + '</tr>';
}

function tableMarkerOf(row: DiffRow): string | null {
    if (row.left?.status === 'removed') {
        return 'removed';
    }

    if (row.right?.status === 'added') {
        return 'added';
    }

    return row.left?.status === 'changed' || row.right?.status === 'changed' ? 'changed' : null;
}

function renderTableCells(cell: DiffCell | null, side: 'original' | 'modified', document: RowsDiffDocument, changes: ChangesById): string {
    if (cell == null) {
        return `<td class="nd-row-key" data-side="${side}" data-placeholder="true"></td>`
            + document.columns.map(() => `<td data-side="${side}" data-placeholder="true"></td>`).join('');
    }

    const values = cell.tokens.map((token) => {
        if (token == null) {
            return `<td data-side="${side}" data-placeholder="true"></td>`;
        }

        const change = token.change == null ? undefined : changes.get(token.change);
        const title = change == null ? '' : ` title="${escapeHtml(`Original: ${shownValue(change.before)}\nModified: ${shownValue(change.after)}`)}"`;
        const changed = token.status === 'changed' ? ` data-changed="true"${title}` : '';
        const column = escapeHtml(token.column ?? '');

        return `<td data-side="${side}" data-column="${column}"${changed}${changeAttributes(change)}>${escapeHtml(token.text)}</td>`;
    });

    return `<td class="nd-row-key" data-side="${side}">${escapeHtml(cell.label ?? '')}</td>${values.join('')}`;
}

function shownValue(value: unknown): string {
    return value == null || value === '' ? '∅' : String(value);
}

const PAGE_CSS = `
:root {
    color-scheme: light dark;
    --bg: #f8f8f8;
    --surface: #ffffff;
    --surface-sunken: #f3f3f3;
    --text: #3b3b3b;
    --muted: #616161;
    --faint: #767676;
    --border: #e5e5e5;
    --border-strong: #cecece;
    --divider: #f0f0f0;
    --accent: #005fb8;
    --accent-text: #ffffff;
    --ok: #2e7d32;
    --ok-soft: #e6f4e7;
    --warn: #8a6100;
    --warn-soft: #fff4ce;
    --fail: #c72e0f;
    --fail-soft: #fde7e4;
    --diff-add-bg: #e6f4e7;
    --diff-add-text: #1b5e20;
    --diff-del-bg: #fde7e4;
    --diff-del-text: #a1260d;
    --flash: #ffc400;
    --key: #0451a5;
    --string: #a31515;
    --number: #098658;
    --boolean: #0000ff;
    --shadow-strong: rgb(0 0 0 / 16%);
}
@media (prefers-color-scheme: dark) {
    :root {
        --bg: #181818;
        --surface: #1f1f1f;
        --surface-sunken: #181818;
        --text: #d4d4d4;
        --muted: #9d9d9d;
        --faint: #8a8a8a;
        --border: #2b2b2b;
        --border-strong: #454545;
        --divider: #262626;
        --accent: #4ec9b0;
        --accent-text: #1f1f1f;
        --ok: #73c991;
        --ok-soft: #1e3a26;
        --warn: #cca700;
        --warn-soft: #3b3206;
        --fail: #f14c4c;
        --fail-soft: #4b1818;
        --diff-add-bg: #1e3a26;
        --diff-add-text: #89d185;
        --diff-del-bg: #4b1818;
        --diff-del-text: #f48771;
        --flash: #cca700;
        --key: #9cdcfe;
        --string: #ce9178;
        --number: #b5cea8;
        --boolean: #569cd6;
        --shadow-strong: rgb(0 0 0 / 60%);
    }
}
* {
    box-sizing: border-box;
}
[hidden] {
    display: none !important;
}
html,
body {
    height: 100%;
    margin: 0;
}
body {
    display: flex;
    flex-direction: column;
    font: 13px/1.5 "Segoe UI", system-ui, -apple-system, sans-serif;
    color: var(--text);
    background: var(--bg);
}
.nd-page-header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 12px;
    padding: 8px 16px;
    background: var(--surface);
    border-bottom: 1px solid var(--border-strong);
}
.nd-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    overflow-wrap: anywhere;
}
.nd-subtitle {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
}
.nd-scroller {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding-bottom: 64px;
    background: var(--surface);
}
.nd-scroller:focus {
    outline: none;
}
.nd-scroller:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
}
.nd-headers {
    position: sticky;
    top: 0;
    z-index: 2;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    border-bottom: 1px solid var(--border);
}
.nd-side-header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 8px;
    min-width: 0;
    padding: 6px 12px;
    font-weight: 400;
    text-align: left;
    background: var(--surface);
    border-left: 3px solid var(--fail);
    border-bottom: 1px solid var(--border);
}
.nd-side-header[data-side="modified"] {
    border-left-color: var(--ok);
}
.nd-badge {
    padding: 1px 6px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--text);
    background: var(--fail-soft);
    border-radius: 4px;
}
[data-side="modified"] > .nd-badge {
    background: var(--ok-soft);
}
.nd-name {
    overflow: hidden;
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    text-overflow: ellipsis;
}
.nd-detail {
    flex-basis: 100%;
    overflow: hidden;
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    text-overflow: ellipsis;
}
.nd-text {
    padding: 4px 0;
    font-family: "Cascadia Mono", Consolas, monospace;
    font-size: 13px;
    line-height: 1.6;
}
.nd-text-row {
    display: grid;
    grid-template-columns: var(--number-width) minmax(0, 1fr) var(--number-width) minmax(0, 1fr);
}
.nd-hunk,
.nd-tree-row {
    position: relative;
}
.nd-number {
    padding: 0 8px 0 4px;
    color: var(--faint);
    text-align: right;
    white-space: nowrap;
    user-select: none;
    border-right: 1px solid var(--border);
}
.nd-number[data-side="modified"] {
    border-left: 2px solid var(--border-strong);
}
.nd-number[data-marker="del"],
.nd-line[data-marker="del"] {
    background: var(--diff-del-bg);
}
.nd-number[data-marker="add"],
.nd-line[data-marker="add"] {
    background: var(--diff-add-bg);
}
.nd-number[data-marker="del"]::before {
    content: "\\2212";
    margin-right: 4px;
    color: var(--fail);
}
.nd-number[data-marker="add"]::before {
    content: "+";
    margin-right: 4px;
    color: var(--ok);
}
.nd-line {
    min-width: 0;
    padding: 0 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
.nd-line[data-marker="del"] {
    color: var(--diff-del-text);
}
.nd-line[data-marker="add"] {
    color: var(--diff-add-text);
}
.nd-line[data-marker="ignored"] {
    font-style: italic;
    color: var(--faint);
}
.nd-tree {
    display: flex;
    flex-direction: column;
    font-family: "Cascadia Mono", Consolas, monospace;
    font-size: 12px;
}
.nd-tree-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.nd-cell {
    display: flex;
    align-items: baseline;
    gap: 4px;
    min-height: 22px;
    padding: 1px 8px;
    color: var(--text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    border-left: 3px solid transparent;
}
.nd-cell[data-side="modified"] {
    border-left-color: var(--border);
}
.nd-cell[data-diff="changed"],
.nd-cell[data-diff="typeChanged"] {
    background: var(--warn-soft);
    border-left-color: var(--warn);
}
.nd-cell[data-diff="added"] {
    background: var(--ok-soft);
    border-left-color: var(--ok);
}
.nd-cell[data-diff="removed"] {
    background: var(--fail-soft);
    border-left-color: var(--fail);
}
.nd-twist {
    flex: 0 0 14px;
    padding: 0;
    font: inherit;
    color: var(--muted);
    background: none;
    border: 0;
    cursor: pointer;
}
.nd-key {
    flex: 0 0 auto;
    color: var(--key);
    white-space: nowrap;
}
.nd-punct,
.nd-count {
    color: var(--muted);
}
.nd-value {
    min-width: 0;
}
.nd-value[data-type="string"] {
    color: var(--string);
}
.nd-value[data-type="number"] {
    color: var(--number);
}
.nd-value[data-type="boolean"],
.nd-value[data-type="null"] {
    color: var(--boolean);
}
[data-placeholder="true"] {
    background-color: var(--surface-sunken);
    background-image: repeating-linear-gradient(135deg, transparent 0 7px, var(--border) 7px 8px);
}
.nd-table {
    width: 100%;
    font-size: 12px;
    color: var(--text);
    border-collapse: separate;
    border-spacing: 0;
}
.nd-table th,
.nd-table td {
    padding: 4px 10px;
    text-align: left;
    white-space: nowrap;
    border-bottom: 1px solid var(--divider);
}
.nd-table td {
    position: relative;
}
.nd-table thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    font-weight: 600;
    color: var(--muted);
    background: var(--surface-sunken);
}
.nd-table .nd-table-sides th {
    height: 52px;
    padding: 0;
    background: var(--surface);
}
.nd-table .nd-table-sides .nd-side-header {
    height: 100%;
}
.nd-table thead tr:nth-child(2) th {
    top: 52px;
    border-bottom: 1px solid var(--border-strong);
}
.nd-table .nd-row-key {
    font-family: "Cascadia Mono", Consolas, monospace;
    color: var(--muted);
}
.nd-table [data-side="modified"].nd-row-key,
.nd-table .nd-table-sides th[data-side="modified"] {
    border-left: 2px solid var(--border-strong);
}
.nd-table td[data-changed="true"] {
    font-weight: 600;
    color: var(--text);
    background: var(--warn-soft);
    box-shadow: inset 3px 0 0 var(--warn);
}
.nd-table tr[data-marker="added"] td[data-side="modified"]:not([data-placeholder]) {
    background: var(--ok-soft);
}
.nd-table tr[data-marker="removed"] td[data-side="original"]:not([data-placeholder]) {
    background: var(--fail-soft);
}
[data-change] {
    cursor: pointer;
}
@keyframes nd-flash {
    from {
        opacity: 1;
    }
    to {
        opacity: 0;
    }
}
.nd-hunk[data-flash="true"]::after,
.nd-tree-row[data-flash="true"]::after,
.nd-table td[data-flash="true"]::after,
.nd-table tr[data-flash="true"] > td::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    border-radius: 2px;
    box-shadow: inset 0 0 0 3px var(--flash);
    animation: nd-flash 1.6s ease-out forwards;
}
.nd-table tr[data-flash="true"] > td::after {
    border-radius: 0;
    box-shadow: inset 0 3px 0 var(--flash), inset 0 -3px 0 var(--flash);
}
.nd-bar {
    position: fixed;
    right: 24px;
    bottom: 24px;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px;
    font-size: 12px;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    box-shadow: 0 4px 14px var(--shadow-strong);
}
.nd-bar[data-empty="true"] .nd-bar-step {
    display: none;
}
.nd-bar-views {
    display: flex;
}
.nd-bar-button {
    padding: 4px 10px;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.4;
    color: var(--muted);
    background: var(--surface-sunken);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.nd-bar-button:hover {
    color: var(--text);
    background: var(--border);
}
.nd-bar-button:focus-visible {
    position: relative;
    z-index: 1;
    outline: 2px solid var(--accent);
    outline-offset: 1px;
}
.nd-bar-views > .nd-bar-button {
    margin-left: -1px;
    border-radius: 0;
}
.nd-bar-views > .nd-bar-button:first-child {
    margin-left: 0;
    border-radius: 4px 0 0 4px;
}
.nd-bar-views > .nd-bar-button:last-child {
    border-radius: 0 4px 4px 0;
}
.nd-bar-views > .nd-bar-button[aria-pressed="true"] {
    color: var(--accent-text);
    background: var(--accent);
    border-color: var(--accent);
}
.nd-bar-position {
    min-width: 54px;
    color: var(--muted);
    text-align: center;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
}
.nd-bar[data-empty="true"] .nd-bar-position {
    padding: 0 4px;
}
body[data-view="before"] .nd-headers,
body[data-view="after"] .nd-headers,
body[data-view="before"] .nd-tree-row,
body[data-view="after"] .nd-tree-row {
    grid-template-columns: minmax(0, 1fr);
}
body[data-view="before"] .nd-text-row,
body[data-view="after"] .nd-text-row {
    grid-template-columns: var(--number-width) minmax(0, 1fr);
}
body[data-view="before"] .nd-scroller [data-side="modified"],
body[data-view="before"] .nd-scroller [data-only="modified"],
body[data-view="after"] .nd-scroller [data-side="original"],
body[data-view="after"] .nd-scroller [data-only="original"] {
    display: none;
}
body[data-view="after"] .nd-number[data-side="modified"],
body[data-view="after"] .nd-table [data-side="modified"].nd-row-key,
body[data-view="after"] .nd-table .nd-table-sides th[data-side="modified"] {
    border-left: 0;
}
@media (max-width: 720px) {
    .nd-text {
        font-size: 11px;
    }
    .nd-line {
        padding: 0 6px;
    }
    .nd-tree {
        font-size: 11px;
    }
    .nd-cell {
        padding-right: 4px;
    }
    .nd-bar {
        right: 8px;
        bottom: 8px;
        gap: 4px;
        padding: 4px;
    }
    .nd-bar-button {
        min-height: 32px;
        padding: 4px 8px;
    }
    .nd-bar-step {
        min-width: 32px;
    }
    .nd-bar-position {
        min-width: 44px;
    }
}
@media print {
    html,
    body {
        height: auto;
    }
    body {
        display: block;
    }
    .nd-scroller {
        overflow: visible;
    }
    .nd-headers,
    .nd-table thead th {
        position: static;
    }
    .nd-bar {
        display: none;
    }
}
`;

// The bar of the page on its own: Diff / Before / After, Previous / Next with p, n, ↑ and ↓, the position,
// opening and closing objects and arrays, and clicking a change to make it the current one. ES5, so it runs anywhere.
const PAGE_SCRIPT = `
(function () {
    'use strict';
    var HOLD_MILLISECONDS = 1000;
    var FLASH_MILLISECONDS = 1600;
    var scroller = document.querySelector('.nd-scroller');
    var bar = document.querySelector('.nd-bar');
    var position = bar.querySelector('.nd-bar-position');
    var viewButtons = bar.querySelectorAll('[data-view]');
    var changes = [];
    var byId = {};
    var view = 'diff';
    var current = null;
    var movedAt = 0;
    var pending = false;
    var marked = scroller.querySelectorAll('[data-change]');
    var index;

    for (index = 0; index < marked.length; index += 1) {
        var element = marked[index];
        var key = '#' + element.getAttribute('data-change');
        var entry = byId[key];

        if (!entry) {
            entry = { sides: element.getAttribute('data-sides') || 'both', label: element.getAttribute('data-label'), elements: [] };
            byId[key] = entry;
            changes.push(entry);
        }

        entry.elements.push(element);
    }

    function isShown(change) {
        if (view === 'before') {
            return change.sides !== 'modified';
        }

        return view === 'after' ? change.sides !== 'original' : true;
    }

    function visibleChanges() {
        return changes.filter(isShown);
    }

    function isRendered(element) {
        return element.getClientRects().length > 0;
    }

    function hasLayout() {
        return scroller.clientHeight > 0;
    }

    function firstRendered(change) {
        for (var at = 0; at < change.elements.length; at += 1) {
            if (isRendered(change.elements[at])) {
                return change.elements[at];
            }
        }

        return null;
    }

    function isInView(change) {
        var box = scroller.getBoundingClientRect();

        for (var at = 0; at < change.elements.length; at += 1) {
            var element = change.elements[at];

            if (isRendered(element)) {
                var rect = element.getBoundingClientRect();

                if (rect.bottom > box.top && rect.top < box.bottom) {
                    return true;
                }
            }
        }

        return false;
    }

    function spiedIndex(list) {
        var box = scroller.getBoundingClientRect();
        var middle = box.top + scroller.clientHeight / 2;
        var found = -1;
        var foundTop = -Infinity;

        for (var at = 0; at < list.length; at += 1) {
            var element = firstRendered(list[at]);

            if (element) {
                var top = element.getBoundingClientRect().top;

                if (top <= middle && top > foundTop) {
                    found = at;
                    foundTop = top;
                }
            }
        }

        return found;
    }

    function currentIndex(list) {
        var at = list.indexOf(current);

        if (at >= 0 && (!hasLayout() || Date.now() - movedAt < HOLD_MILLISECONDS || isInView(current))) {
            return at;
        }

        return hasLayout() ? spiedIndex(list) : -1;
    }

    function updatePosition() {
        if (!changes.length) {
            position.textContent = 'No changes';

            return;
        }

        var list = visibleChanges();
        var at = currentIndex(list);
        var change = list[at];
        position.textContent = (at < 0 ? '\\u2013' : at + 1) + ' / ' + list.length;

        if (change && change.label) {
            position.setAttribute('title', change.label);
        }
        else {
            position.removeAttribute('title');
        }
    }

    function setCollapsed(row, collapsed) {
        var depth = Number(row.getAttribute('data-depth'));
        var twist = row.querySelectorAll('.nd-twist[aria-expanded]');
        var hiddenUnder = -1;

        row.setAttribute('data-collapsed', String(collapsed));

        for (var at = 0; at < twist.length; at += 1) {
            twist[at].setAttribute('aria-expanded', String(!collapsed));
            twist[at].setAttribute('aria-label', collapsed ? 'Expand' : 'Collapse');
            twist[at].textContent = collapsed ? '\\u25b8' : '\\u25be';
        }

        for (var next = row.nextElementSibling; next; next = next.nextElementSibling) {
            var nextDepth = Number(next.getAttribute('data-depth'));
            var isClose = next.getAttribute('data-node') === 'close';

            if (nextDepth <= depth) {
                next.hidden = collapsed;

                break;
            }

            if (collapsed) {
                next.hidden = true;
            }
            else if (hiddenUnder >= 0) {
                next.hidden = true;

                if (isClose && nextDepth === hiddenUnder) {
                    hiddenUnder = -1;
                }
            }
            else {
                next.hidden = false;

                if (next.getAttribute('data-node') === 'open' && next.getAttribute('data-collapsed') === 'true') {
                    hiddenUnder = nextDepth;
                }
            }
        }
    }

    function openAncestors(element) {
        var row = element.closest ? element.closest('.nd-tree-row') : null;

        if (!row || !row.hidden) {
            return;
        }

        var depth = Number(row.getAttribute('data-depth'));
        var ancestors = [];

        for (var previous = row.previousElementSibling; previous && depth > 0; previous = previous.previousElementSibling) {
            var previousDepth = Number(previous.getAttribute('data-depth'));

            if (previousDepth < depth && previous.getAttribute('data-node') === 'open') {
                ancestors.unshift(previous);
                depth = previousDepth;
            }
        }

        for (var at = 0; at < ancestors.length; at += 1) {
            if (ancestors[at].getAttribute('data-collapsed') === 'true') {
                setCollapsed(ancestors[at], false);
            }
        }
    }

    function flash(change) {
        change.elements.forEach(function (element) {
            element.removeAttribute('data-flash');
            void element.offsetWidth;
            element.setAttribute('data-flash', 'true');
            window.clearTimeout(element.flashTimer);
            element.flashTimer = window.setTimeout(function () {
                element.removeAttribute('data-flash');
            }, FLASH_MILLISECONDS);
        });
    }

    function moveTo(change) {
        current = change;
        movedAt = Date.now();
        change.elements.forEach(openAncestors);
        var target = firstRendered(change);

        if (target && target.scrollIntoView) {
            target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }

        flash(change);
        updatePosition();
    }

    function step(direction) {
        var list = visibleChanges();

        if (!list.length) {
            return;
        }

        var at = currentIndex(list);
        var target = at + direction;

        if (direction < 0 && at >= 0 && hasLayout() && !isInView(list[at])) {
            target = at;
        }

        moveTo(list[Math.max(0, Math.min(list.length - 1, target))]);
    }

    function anchorRow() {
        if (typeof document.elementFromPoint !== 'function') {
            return null;
        }

        var box = scroller.getBoundingClientRect();
        var hit = document.elementFromPoint(box.left + 24, box.top + Math.min(120, scroller.clientHeight / 3));

        return hit && scroller.contains(hit) ? hit.closest('.nd-text-row, .nd-tree-row, tbody tr') : null;
    }

    function setView(next) {
        var anchor = anchorRow();
        var anchorTop = anchor ? anchor.getBoundingClientRect().top : 0;
        view = next;
        document.body.setAttribute('data-view', next);

        for (var at = 0; at < viewButtons.length; at += 1) {
            viewButtons[at].setAttribute('aria-pressed', String(viewButtons[at].getAttribute('data-view') === next));
        }

        if (anchor && isRendered(anchor)) {
            scroller.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
        }

        updatePosition();
    }

    document.addEventListener('click', function (event) {
        var target = event.target;

        if (!target || !target.closest) {
            return;
        }

        var viewButton = target.closest('[data-view]');

        if (viewButton && bar.contains(viewButton)) {
            setView(viewButton.getAttribute('data-view'));

            return;
        }

        var stepButton = target.closest('[data-step]');

        if (stepButton && bar.contains(stepButton)) {
            step(Number(stepButton.getAttribute('data-step')));

            return;
        }

        var twist = target.closest('.nd-twist[aria-expanded]');

        if (twist) {
            var row = twist.closest('.nd-tree-row');
            setCollapsed(row, row.getAttribute('data-collapsed') !== 'true');
            updatePosition();

            return;
        }

        if (!scroller.contains(target) || String(window.getSelection ? window.getSelection() : '') !== '') {
            return;
        }

        var owner = target.closest('[data-change]');
        var change = owner ? byId['#' + owner.getAttribute('data-change')] : null;

        if (change && isShown(change)) {
            current = change;
            movedAt = Date.now();
            updatePosition();
        }
    });

    document.addEventListener('keydown', function (event) {
        var target = event.target;
        var direction = event.key === 'n' || event.key === 'ArrowDown' ? 1 : event.key === 'p' || event.key === 'ArrowUp' ? -1 : 0;

        if (!direction || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }

        if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
            return;
        }

        if (!visibleChanges().length) {
            return;
        }

        event.preventDefault();
        step(direction);
    });

    scroller.addEventListener('scroll', function () {
        if (pending) {
            return;
        }

        pending = true;
        window.requestAnimationFrame(function () {
            pending = false;
            updatePosition();
        });
    });

    updatePosition();
})();
`;
