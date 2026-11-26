// Renders a MarkdownDiff as one self-contained HTML page, with styles and script inline so it works offline.
import { encodeBase64 } from '../../encoding/base64.js';
import { safeRenderMermaidAsync } from './mermaidBridge.js';
import { inlineDiff } from './comparer.js';
import type {
    ChangeRecord,
    DiffOp,
    InlineRun,
    MarkdownDiff,
    MarkdownSegment,
    RenderOptions,
    TableColumnDiff,
    TableDiff,
} from './types.js';

const escapeHtml = (text: string | null | undefined): string => {
    if (text == null) {
        return '';
    }

    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
};

// Minimal inline-markdown pass for display: code span, bold, italic, link.
// Not a full markdown renderer, just enough to read the result as a document.
const renderInlineMarkdown = (text: string): string => {
    let html = escapeHtml(text);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    return html;
};

const fenceBody = (segment: MarkdownSegment): string => {
    const lines = segment.lines;
    if (lines.length <= 2) {
        return '';
    }

    return lines.slice(1, lines.length - 1).join('\n');
};

interface LineOp {
    op: DiffOp;
    text: string;
}

const compareLineSequence = (reference: readonly string[], difference: readonly string[]): LineOp[] => {
    const referenceCount = reference.length;
    const differenceCount = difference.length;
    const ops: LineOp[] = [];

    if (referenceCount === 0 && differenceCount === 0) {
        return ops;
    }

    if (referenceCount === 0) {
        for (const line of difference) {
            ops.push({ op: 'Added', text: line });
        }

        return ops;
    }

    if (differenceCount === 0) {
        for (const line of reference) {
            ops.push({ op: 'Removed', text: line });
        }

        return ops;
    }

    const width = differenceCount + 1;
    const table = new Int32Array((referenceCount + 1) * width);
    const at = (x: number, y: number): number => table[x * width + y] ?? 0;
    const set = (x: number, y: number, value: number): void => {
        table[x * width + y] = value;
    };

    for (let x = referenceCount - 1; x >= 0; x--) {
        for (let y = differenceCount - 1; y >= 0; y--) {
            if (reference[x] === difference[y]) {
                set(x, y, at(x + 1, y + 1) + 1);
            }
            else {
                set(x, y, Math.max(at(x + 1, y), at(x, y + 1)));
            }
        }
    }

    let x = 0;
    let y = 0;
    while (x < referenceCount && y < differenceCount) {
        if (reference[x] === difference[y]) {
            ops.push({ op: 'Equal', text: reference[x]! });
            x++;
            y++;
        }
        else if (at(x + 1, y) >= at(x, y + 1)) {
            ops.push({ op: 'Removed', text: reference[x]! });
            x++;
        }
        else {
            ops.push({ op: 'Added', text: difference[y]! });
            y++;
        }
    }
    while (x < referenceCount) {
        ops.push({ op: 'Removed', text: reference[x]! });
        x++;
    }
    while (y < differenceCount) {
        ops.push({ op: 'Added', text: difference[y]! });
        y++;
    }

    return ops;
};

const LABEL_WIDTH = 72;

const labelWindow = (text: string, position = 0, width = LABEL_WIDTH): string => {
    const flat = text.replace(/\s+/g, ' ').trim();
    if (flat.length <= width) {
        return flat;
    }

    const start = Math.max(0, Math.min(position - 24, flat.length - width));
    const slice = flat.substring(start, start + Math.min(width, flat.length - start));
    const prefix = start > 0 ? '…' : '';
    const suffix = (start + width) < flat.length ? '…' : '';

    return prefix + slice + suffix;
};

const inlineLabel = (runs: readonly InlineRun[]): string => {
    let newText = '';
    let oldText = '';
    let newPosition = -1;
    let oldPosition = -1;
    let hasAddition = false;

    for (const run of runs) {
        if (run.op !== 'Removed') {
            if (run.op === 'Added') {
                hasAddition = true;
                if (newPosition < 0) {
                    newPosition = newText.length;
                }
            }

            newText += run.text;
        }

        if (run.op !== 'Added') {
            if (run.op === 'Removed') {
                if (oldPosition < 0) {
                    oldPosition = oldText.length;
                }

                if (newPosition < 0) {
                    newPosition = newText.length;
                }
            }

            oldText += run.text;
        }
    }

    // A pure deletion reads as the removed text; anything else reads as the new text.
    if (hasAddition) {
        return labelWindow(newText, Math.max(newPosition, 0));
    }

    return labelWindow(oldText, Math.max(oldPosition, 0));
};

const countWordsInText = (text: string): number => {
    const match = text.match(/[^\s]+/g);

    return match === null ? 0 : match.length;
};

const measureWordChange = (runs: readonly InlineRun[]): { inserted: number; deleted: number } => {
    let inserted = 0;
    let deleted = 0;
    for (const run of runs) {
        const words = countWordsInText(run.text);
        if (run.op === 'Added') {
            inserted += words;
        }
        else if (run.op === 'Removed') {
            deleted += words;
        }
    }

    return { inserted, deleted };
};

// True when a modified segment was rewritten end to end. The comparer
// already turns each rewritten sentence into one removed + one added run;
// when no unchanged word survives anywhere in the block, it reads better
// as two full-width bands.
const isRewrittenInline = (runs: readonly InlineRun[], minimumWord = 12): boolean => {
    let total = 0;
    for (const run of runs) {
        if (run.op === 'Equal' && /\S/.test(run.text)) {
            return false;
        }

        total += countWordsInText(run.text);
    }

    return total >= minimumWord;
};

const measureLineChange = (operations: readonly LineOp[]): { inserted: number; deleted: number } => {
    let inserted = 0;
    let deleted = 0;
    for (const op of operations) {
        if (op.op === 'Added') {
            inserted++;
        }
        else if (op.op === 'Removed') {
            deleted++;
        }
    }

    return { inserted, deleted };
};

interface RenderContext {
    tabCss: string[];
    diagramsDrawn: number;
    diagramsFailed: number;
    diagramSeq: number;
    tableSeq: number;
    renderMermaidAsync: ((source: string) => Promise<string | null>) | undefined;
}

const createContext = (options: RenderOptions): RenderContext => {
    return {
        tabCss: [],
        diagramsDrawn: 0,
        diagramsFailed: 0,
        diagramSeq: 0,
        tableSeq: 0,
        renderMermaidAsync: options.renderMermaid,
    };
};

const mermaidPaneHtmlAsync = async (source: string, context: RenderContext): Promise<string> => {
    const svg = await safeRenderMermaidAsync(context.renderMermaidAsync, source);
    if (svg != null && svg !== '') {
        context.diagramsDrawn++;
    }
    else if (context.renderMermaidAsync != null) {
        context.diagramsFailed++;
    }

    // Mermaid sets width="100%" on its svg; cap at the diagram's own max-width.
    const widthMatch = svg != null ? svg.match(/<svg[^>]*max-width:\s*([\d.]+)px/) : null;
    const widthAttribute = widthMatch != null ? ` style="width:${widthMatch[1]}px"` : '';

    const body = svg != null && svg !== ''
        ? `<img src="data:image/svg+xml;base64,${encodeBase64(svg)}"${widthAttribute}>`
        : `<pre class="md-src"><code>${escapeHtml(source)}</code></pre>`;

    const enlarge = svg != null && svg !== '' ? '<button class="md-enlarge" type="button">&#128269; Enlarge</button>' : '';
    const tools = `<div class="md-tools"><button class="md-copy" type="button" data-src="${encodeBase64(source)}">&#128203; Copy Mermaid</button>${enlarge}</div>`;

    return `<div class="md-out">${body}</div>${tools}`;
};

const renderInlineRuns = (runs: readonly InlineRun[]): string => {
    const parts: string[] = [];
    for (const run of runs) {
        const html = renderInlineMarkdown(run.text);
        if (run.op === 'Added') {
            parts.push(`<ins>${html}</ins>`);
        }
        else if (run.op === 'Removed') {
            parts.push(`<del>${html}</del>`);
        }
        else {
            parts.push(html);
        }
    }

    return parts.join('');
};

const renderTableDiffHtml = (diff: TableDiff, segment: MarkdownSegment): string => {
    const bandCell = (text: string, tag: 'ins' | 'del' | ''): string => {
        if (text === '') {
            return '';
        }

        const inner = renderInlineMarkdown(text);
        if (tag !== '') {
            return `<${tag} class="md-block">${inner}</${tag}>`;
        }

        return inner;
    };

    // Added / removed row or column carries a class so Before/After views can drop it whole.
    const columnClassName = (column: TableColumnDiff): string => {
        if (column.status === 'Added') {
            return ' class="md-col-add"';
        }

        if (column.status === 'Removed') {
            return ' class="md-col-del"';
        }

        return '';
    };

    const parts: string[] = [];
    parts.push('<table><thead><tr>');

    const columnClasses = diff.columns.map(columnClassName);
    diff.columns.forEach((column, index) => {
        const th = `<th${columnClasses[index] ?? ''}>`;
        if (column.status === 'Added') {
            parts.push(`${th}${bandCell(column.modified, 'ins')}</th>`);
        }
        else if (column.status === 'Removed') {
            parts.push(`${th}${bandCell(column.original, 'del')}</th>`);
        }
        else if (column.status === 'Modified') {
            parts.push(`${th}${renderInlineRuns(column.inline ?? [])}</th>`);
        }
        else {
            parts.push(`${th}${renderInlineMarkdown(column.modified)}</th>`);
        }
    });
    parts.push('</tr></thead><tbody>');

    for (const row of diff.rows) {
        let rowClass = '';
        if (row.status === 'Added') {
            rowClass = ' class="md-row-add"';
        }
        else if (row.status === 'Removed') {
            rowClass = ' class="md-row-del"';
        }

        parts.push(`<tr${rowClass}>`);

        row.cells.forEach((cell, index) => {
            const td = `<td${columnClasses[index] ?? ''}>`;
            if (cell.status === 'Added') {
                parts.push(`${td}${bandCell(cell.modified, 'ins')}</td>`);
            }
            else if (cell.status === 'Removed') {
                parts.push(`${td}${bandCell(cell.original, 'del')}</td>`);
            }
            else if (cell.status === 'Modified') {
                parts.push(`${td}${renderInlineRuns(cell.inline ?? [])}</td>`);
            }
            else {
                parts.push(`${td}${renderInlineMarkdown(cell.modified)}</td>`);
            }
        });
        parts.push('</tr>');
    }

    parts.push('</tbody></table>');

    const source = segment.lines.join('\n');

    return `<div class="md-out">${parts.join('')}</div>` +
        `<div class="md-tools"><button class="md-copy" type="button" data-src="${encodeBase64(source)}">&#128203; Copy table</button></div>`;
};

const renderCodeHtml = (operations: readonly LineOp[]): string => {
    const parts: string[] = [];
    parts.push('<pre><code>');
    for (const op of operations) {
        let extra = '';
        if (op.op === 'Added') {
            extra = ' md-add';
        }
        else if (op.op === 'Removed') {
            extra = ' md-del';
        }

        parts.push(`<span class="md-l${extra}">${escapeHtml(op.text)}</span>`);
    }

    parts.push('</code></pre>');

    return parts.join('');
};

const renderTableHtml = (segment: MarkdownSegment): string => {
    const rows = segment.lines.filter((line) => /\S/.test(line));
    if (rows.length === 0) {
        return '';
    }

    const splitRow = (row: string): string[] => {
        const trimmed = row.trim().replace(/^\|/, '').replace(/\|$/, '');

        return trimmed.split('|').map((cell) => cell.trim());
    };

    const parts: string[] = [];
    parts.push('<table><thead><tr>');
    for (const cell of splitRow(rows[0]!)) {
        parts.push(`<th>${renderInlineMarkdown(cell)}</th>`);
    }

    parts.push('</tr></thead><tbody>');

    // Row 1 is the |---|---| separator.
    for (let index = 2; index < rows.length; index++) {
        parts.push('<tr>');
        for (const cell of splitRow(rows[index]!)) {
            parts.push(`<td>${renderInlineMarkdown(cell)}</td>`);
        }

        parts.push('</tr>');
    }

    parts.push('</tbody></table>');

    return parts.join('');
};

const renderTablePaneHtml = (segment: MarkdownSegment): string => {
    const source = segment.lines.join('\n');

    return `<div class="md-out">${renderTableHtml(segment)}</div>` +
        `<div class="md-tools"><button class="md-copy" type="button" data-src="${encodeBase64(source)}">&#128203; Copy table</button></div>`;
};

const renderTabsHtml = (
    context: RenderContext,
    id: string,
    beforeHtml: string,
    afterHtml: string,
    note: string,
): string => {
    context.tabCss.push(`#b${id}:checked~.md-panes .md-pane-b{display:block}#b${id}:checked~.md-panes .md-pane-a{display:none}`);
    context.tabCss.push(`#a${id}:checked~.md-panes .md-pane-a{display:block}#a${id}:checked~.md-panes .md-pane-b{display:none}`);
    context.tabCss.push(`#b${id}:checked~.md-tabbar label[for=b${id}],#a${id}:checked~.md-tabbar label[for=a${id}]{background:#0052cc;color:#fff;border-color:#0052cc}`);

    return `<input class="md-tr" type="radio" name="t${id}" id="b${id}" checked>` +
        `<input class="md-tr" type="radio" name="t${id}" id="a${id}">` +
        `<div class="md-tabbar"><label for="b${id}">Before</label><label for="a${id}">After</label></div>` +
        '<div class="md-panes">' +
        `<div class="md-pane md-pane-b">${beforeHtml}</div>` +
        `<div class="md-pane md-pane-a">${afterHtml}</div>` +
        `</div><div class="md-note">&#10007; ${escapeHtml(note)}</div>`;
};

interface BlockHtmlOptions {
    segment: MarkdownSegment;
    idAttribute?: string;
    wrap?: '' | 'ins' | 'del';
    context: RenderContext;
}

const renderBlockHtmlAsync = async (options: BlockHtmlOptions): Promise<string> => {
    const { segment, context } = options;
    const idAttribute = options.idAttribute ?? '';
    const wrap = options.wrap ?? '';

    // Added or removed block carries a class so Before/After views can drop it whole.
    let blockClass = '';
    if (wrap === 'ins') {
        blockClass = 'md-blk-add';
    }
    else if (wrap === 'del') {
        blockClass = 'md-blk-del';
    }

    const classAttribute = blockClass === '' ? '' : ` class="${blockClass}"`;

    const wrapInline = (inner: string): string => {
        if (wrap === '') {
            return inner;
        }

        return `<${wrap} class="md-block">${inner}</${wrap}>`;
    };

    if (segment.type === 'Heading') {
        const tag = 'h' + Math.min(Math.max(segment.level, 1), 4);
        const inner = wrapInline(renderInlineMarkdown(segment.text));

        return `<${tag}${idAttribute}${classAttribute}>${inner}</${tag}>`;
    }

    if (segment.type === 'Paragraph') {
        const inner = wrapInline(renderInlineMarkdown(segment.text));

        return `<p${idAttribute}${classAttribute}>${inner}</p>`;
    }

    if (segment.type === 'BlockQuote') {
        const inner = wrapInline(renderInlineMarkdown(segment.text));

        return `<blockquote${idAttribute}${classAttribute}><p>${inner}</p></blockquote>`;
    }

    if (segment.type === 'Rule') {
        return `<hr${idAttribute}${classAttribute}>`;
    }

    if (segment.type === 'Code') {
        let op: DiffOp = 'Equal';
        if (wrap === 'ins') {
            op = 'Added';
        }
        else if (wrap === 'del') {
            op = 'Removed';
        }

        const body = fenceBody(segment);
        const operations: LineOp[] = body.split('\n').map((line) => ({ op, text: line }));

        return `<div${idAttribute}${classAttribute}>${renderCodeHtml(operations)}</div>`;
    }

    if (segment.type === 'Table') {
        let wrapperClass = '';
        let badge = '';
        if (wrap === 'ins') {
            wrapperClass = ' class="md-diff md-added md-blk-add"';
            badge = '<div class="md-badge md-badge-new">New</div>';
        }
        else if (wrap === 'del') {
            wrapperClass = ' class="md-diff md-removed md-blk-del"';
            badge = '<div class="md-badge md-badge-old">Removed</div>';
        }

        return `<div${idAttribute}${wrapperClass}>${badge}${renderTablePaneHtml(segment)}</div>`;
    }

    if (segment.type === 'Mermaid') {
        context.diagramSeq++;
        let wrapperClass = 'md-mermaid';
        let badge = '';
        if (wrap === 'ins') {
            wrapperClass = 'md-diff md-added md-blk-add';
            badge = '<div class="md-badge md-badge-new">New</div>';
        }
        else if (wrap === 'del') {
            wrapperClass = 'md-diff md-removed md-blk-del';
            badge = '<div class="md-badge md-badge-old">Removed</div>';
        }

        const pane = await mermaidPaneHtmlAsync(fenceBody(segment), context);

        return `<div${idAttribute} class="${wrapperClass} md-diagram">${badge}${pane}</div>`;
    }

    // FrontMatter and Html render as a line-gutter block (structure, not prose).
    let extra = '';
    if (wrap === 'ins') {
        extra = ' md-add';
    }
    else if (wrap === 'del') {
        extra = ' md-del';
    }

    const lines = segment.raw.split('\n').map((line) => `<span class="md-l${extra}">${escapeHtml(line)}</span>`);
    const preClass = ('md-src ' + blockClass).trim();

    return `<pre${idAttribute} class="${preClass}"><code>${lines.join('')}</code></pre>`;
};

interface ChangeHtml {
    html: string;
    label: string | null;
    ins: number;
    del: number;
}

const renderChangeHtmlAsync = async (change: ChangeRecord, id: string, context: RenderContext): Promise<ChangeHtml> => {
    const idAttribute = id === '' ? '' : ` id="${id}"`;
    const segment = change.modified ?? change.original;
    if (segment == null) {
        throw new Error('A change record must have at least one side.');
    }

    if (change.status === 'Unchanged') {
        const html = await renderBlockHtmlAsync({ segment, context });

        return { html, label: null, ins: 0, del: 0 };
    }

    if (change.status === 'Added' || change.status === 'Removed') {
        const isAdd = change.status === 'Added';
        const lineCount = segment.raw.split('\n').filter((line) => /\S/.test(line)).length;
        const suffix = isAdd ? 'added' : 'removed';
        const language = segment.language !== '' ? segment.language.toLowerCase() : 'code';

        let label: string;
        if (segment.type === 'Mermaid') {
            label = `diagram ${suffix}`;
        }
        else if (segment.type === 'Table') {
            label = `table ${suffix}`;
        }
        else if (segment.type === 'Code') {
            label = `${language} block ${suffix}`;
        }
        else if (segment.type === 'FrontMatter') {
            label = `front matter ${suffix}`;
        }
        else {
            label = labelWindow(segment.text);
        }

        const html = await renderBlockHtmlAsync({
            segment,
            idAttribute,
            wrap: isAdd ? 'ins' : 'del',
            context,
        });

        return {
            html,
            label,
            ins: isAdd ? lineCount : 0,
            del: isAdd ? 0 : lineCount,
        };
    }

    // Modified branch — needs both sides.
    if (change.original == null || change.modified == null) {
        throw new Error('A Modified change must carry both sides.');
    }

    if (segment.type === 'Mermaid') {
        context.diagramSeq++;
        const beforeSource = fenceBody(change.original);
        const afterSource = fenceBody(change.modified);

        const before = await mermaidPaneHtmlAsync(beforeSource, context);
        const after = await mermaidPaneHtmlAsync(afterSource, context);
        const counts = measureLineChange(compareLineSequence(beforeSource.split('\n'), afterSource.split('\n')));
        const tabs = renderTabsHtml(context, `d${context.diagramSeq}`, before, after, 'diagram changed');

        return {
            html: `<div class="md-diff md-diagram"${idAttribute}>${tabs}</div>`,
            label: 'diagram changed',
            ins: counts.inserted,
            del: counts.deleted,
        };
    }

    if (segment.type === 'Table') {
        // Cell-level diff when the comparer supplied one, Before/After tabs otherwise.
        if (change.tableDiff != null) {
            const html = renderTableDiffHtml(change.tableDiff, change.modified);

            return {
                html: `<div class="md-diff"${idAttribute}>${html}<div class="md-note">&#10007; table changed</div></div>`,
                label: 'table changed',
                ins: change.tableDiff.inserted,
                del: change.tableDiff.deleted,
            };
        }

        context.tableSeq++;
        const before = renderTablePaneHtml(change.original);
        const after = renderTablePaneHtml(change.modified);
        const counts = measureLineChange(compareLineSequence(change.original.lines, change.modified.lines));
        const tabs = renderTabsHtml(context, `t${context.tableSeq}`, before, after, 'table changed');

        return {
            html: `<div class="md-diff"${idAttribute}>${tabs}</div>`,
            label: 'table changed',
            ins: counts.inserted,
            del: counts.deleted,
        };
    }

    if (segment.type === 'FrontMatter' || segment.type === 'Html') {
        const operations = compareLineSequence(change.original.raw.split('\n'), change.modified.raw.split('\n'));
        const counts = measureLineChange(operations);
        const label = segment.type === 'Html' ? 'html block' : 'front matter';

        return {
            html: `<div${idAttribute}>${renderCodeHtml(operations)}</div>`,
            label,
            ins: counts.inserted,
            del: counts.deleted,
        };
    }

    if (segment.type === 'Code') {
        const operations = compareLineSequence(
            fenceBody(change.original).split('\n'),
            fenceBody(change.modified).split('\n'),
        );
        const counts = measureLineChange(operations);
        const language = segment.language !== '' ? segment.language.toLowerCase() : 'code';

        return {
            html: `<div${idAttribute}>${renderCodeHtml(operations)}</div>`,
            label: `${language} block`,
            ins: counts.inserted,
            del: counts.deleted,
        };
    }

    // Modified prose block (Heading / Paragraph / BlockQuote).
    const runs = change.inline ?? [];
    let inner: string;
    let counts: { inserted: number; deleted: number };

    if (isRewrittenInline(runs)) {
        inner = `<del class="md-block">${renderInlineMarkdown(change.original.text)}</del>` +
            `<ins class="md-block">${renderInlineMarkdown(change.modified.text)}</ins>`;
        counts = { inserted: 1, deleted: 1 };
    }
    else {
        inner = renderInlineRuns(runs);
        counts = measureWordChange(runs);
    }

    let html: string;
    if (segment.type === 'Heading') {
        const tag = 'h' + Math.min(Math.max(segment.level, 1), 4);
        html = `<${tag}${idAttribute}>${inner}</${tag}>`;
    }
    else if (segment.type === 'BlockQuote') {
        html = `<blockquote${idAttribute}><p>${inner}</p></blockquote>`;
    }
    else {
        html = `<p${idAttribute}>${inner}</p>`;
    }

    return {
        html,
        label: inlineLabel(runs),
        ins: counts.inserted,
        del: counts.deleted,
    };
};

const renderListItemHtml = (change: ChangeRecord, id: string): ChangeHtml => {
    // The opening <li> only — the caller closes it so a nested sub-list can go inside.
    const idAttribute = id === '' ? '' : ` id="${id}"`;
    const segment = change.modified ?? change.original;
    if (segment == null) {
        throw new Error('A list item change must have at least one side.');
    }

    if (change.status === 'Unchanged') {
        return {
            html: `<li>${renderInlineMarkdown(segment.text)}`,
            label: null,
            ins: 0,
            del: 0,
        };
    }

    if (change.status === 'Added') {
        return {
            html: `<li${idAttribute} class="md-blk-add"><ins class="md-block">${renderInlineMarkdown(segment.text)}</ins>`,
            label: labelWindow(segment.text),
            ins: 1,
            del: 0,
        };
    }

    if (change.status === 'Removed') {
        return {
            html: `<li${idAttribute} class="md-blk-del"><del class="md-block">${renderInlineMarkdown(segment.text)}</del>`,
            label: labelWindow(segment.text),
            ins: 0,
            del: 1,
        };
    }

    if (change.original == null || change.modified == null) {
        throw new Error('A Modified list item must carry both sides.');
    }

    const runs = change.inline ?? inlineDiff(change.original.text, change.modified.text, 'Word');

    if (isRewrittenInline(runs)) {
        return {
            html: `<li${idAttribute}>` +
                `<del class="md-block">${renderInlineMarkdown(change.original.text)}</del>` +
                `<ins class="md-block">${renderInlineMarkdown(change.modified.text)}</ins>`,
            label: inlineLabel(runs),
            ins: 1,
            del: 1,
        };
    }

    const counts = measureWordChange(runs);

    return {
        html: `<li${idAttribute}>${renderInlineRuns(runs)}`,
        label: inlineLabel(runs),
        ins: counts.inserted,
        del: counts.deleted,
    };
};

const getListItemLevel = (change: ChangeRecord): number => {
    const segment = change.modified ?? change.original;
    if (segment == null) {
        return 0;
    }

    return Math.min(Math.floor(segment.indent / 2), 3);
};

interface NavEntry {
    id: string;
    section: string;
    label: string;
    ins: number;
    del: number;
    order: number;
}

const sectionFor = (segment: MarkdownSegment): string => {
    if (segment.type === 'Heading') {
        const parts = [segment.path, segment.text].filter((piece) => piece !== '');

        return parts.join(' > ');
    }

    if (segment.path !== '') {
        return segment.path;
    }

    return '(document top)';
};

const renderNavHtml = (entries: readonly NavEntry[]): string => {
    const groups = new Map<string, NavEntry[]>();
    const groupMinOrder = new Map<string, number>();
    for (const entry of entries) {
        const existing = groups.get(entry.section);
        if (existing != null) {
            existing.push(entry);
        }
        else {
            groups.set(entry.section, [entry]);
            groupMinOrder.set(entry.section, entry.order);
        }

        if (entry.order < (groupMinOrder.get(entry.section) ?? Number.MAX_SAFE_INTEGER)) {
            groupMinOrder.set(entry.section, entry.order);
        }
    }

    const orderedSections = Array.from(groups.keys()).sort((first, second) => {
        return (groupMinOrder.get(first) ?? 0) - (groupMinOrder.get(second) ?? 0);
    });

    const parts: string[] = [];
    for (const section of orderedSections) {
        parts.push(`<div class="md-sec"><div class="md-sec-h">${escapeHtml(section)}</div><ul>`);
        for (const entry of groups.get(section) ?? []) {
            let counts = '';
            if (entry.ins > 0) {
                counts += `<span class="md-c-ins">+${entry.ins}</span>`;
            }

            if (entry.del > 0) {
                counts += `<span class="md-c-del">&minus;${entry.del}</span>`;
            }

            parts.push(`<li><a href="#${entry.id}">${counts}<span class="md-c-l">${escapeHtml(entry.label)}</span></a></li>`);
        }

        parts.push('</ul></div>');
    }

    return `<div class="md-nav"><div class="md-nav-h">Changes (${entries.length})</div>${parts.join('')}</div>`;
};

const BASE_CSS = `:root{--md-fg:#172b4d;--md-muted:#5e6c84;--md-line:#dfe1e6;--md-bg:#fff;--md-link:#0052cc;--md-code-bg:#f4f5f7;}
*{box-sizing:border-box}
body{margin:0;background:#f4f5f7;color:var(--md-fg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;}
.md-wrap{max-width:1080px;margin:24px auto;background:var(--md-bg);padding:40px 56px;border:1px solid var(--md-line);border-radius:6px;box-shadow:0 1px 3px rgba(9,30,66,.13);}
.md-meta{color:var(--md-muted);font-size:12px;margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em;}
.md-title{font-size:28px;font-weight:600;margin:0 0 24px;padding-bottom:14px;border-bottom:2px solid var(--md-line);}
.md-body h1,.md-body h2,.md-body h3,.md-body h4{font-weight:600;line-height:1.3;margin:1.6em 0 .5em;}
.md-body h1{font-size:24px}.md-body h2{font-size:20px;padding-bottom:6px;border-bottom:1px solid var(--md-line)}
.md-body h3{font-size:17px}.md-body h4{font-size:15px}
.md-body p{margin:.6em 0}
a{color:var(--md-link);text-decoration:none}a:hover{text-decoration:underline}
.md-body ul,.md-body ol{padding-left:1.6em;margin:.5em 0}.md-body li{margin:.25em 0}
.md-body li>ul,.md-body li>ol{margin:.25em 0}
.md-body ul ul{list-style-type:circle}.md-body ul ul ul{list-style-type:square}
img{max-width:100%;height:auto}
code{background:var(--md-code-bg);padding:2px 5px;border-radius:3px;font-size:.88em;font-family:"SFMono-Regular",Consolas,Menlo,monospace;}
pre{background:var(--md-code-bg);padding:12px 0;border-radius:4px;overflow:auto;border:1px solid var(--md-line);}
pre code{background:none;padding:0;display:block;}
blockquote{margin:1em 0;padding:.4em 1em;border-left:3px solid var(--md-line);color:var(--md-muted);}
table{border-collapse:collapse;margin:1em 0;width:100%;}
th,td{border:1px solid var(--md-line);padding:8px 12px;text-align:left;vertical-align:top;}
th{background:#f4f5f7;font-weight:600;}
tbody tr:nth-child(even){background:#fafbfc;}
.md-body table{display:block;overflow-x:auto;}
ins{background:#e6ffed;color:#22863a;text-decoration:none;padding:0 2px;border-radius:2px;}
del{background:#ffeef0;color:#b31d28;text-decoration:line-through;padding:0 2px;border-radius:2px;}
ins.md-block,del.md-block{display:block;padding:2px 6px;margin:2px 0;}
:target{scroll-margin-top:12px;box-shadow:0 0 0 2px #ffc400;border-radius:2px;}
pre code .md-l{display:block;padding:0 16px 0 10px;white-space:pre;}
pre code .md-l::before{content:" ";display:inline-block;width:1.1em;color:#8c95a3;}
pre code .md-l.md-add{background:#e6ffed;color:#22863a;}
pre code .md-l.md-add::before{content:"+";color:#22863a;font-weight:700;}
pre code .md-l.md-del{background:#ffeef0;color:#b31d28;}
pre code .md-l.md-del::before{content:"-";color:#b31d28;font-weight:700;}
.md-nav{margin:0 0 22px;border:1px solid var(--md-line);border-radius:6px;background:#fafbfc;max-height:380px;overflow:auto;}
.md-nav-h{font-weight:600;font-size:13px;padding:8px 12px;border-bottom:1px solid var(--md-line);position:sticky;top:0;background:#fafbfc;z-index:1;}
.md-sec{border-top:1px solid #edeff2;}.md-sec:first-of-type{border-top:none;}
.md-sec-h{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--md-muted);padding:8px 12px 2px;}
.md-nav ul{list-style:none;margin:0;padding:0 0 6px;}
.md-nav a{display:flex;gap:6px;align-items:baseline;padding:3px 12px;font-size:12.5px;color:var(--md-link);text-decoration:none;}
.md-nav a:hover{background:#e9f2ff;}.md-nav a:hover .md-c-l{text-decoration:underline;}
.md-c-l{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.md-c-ins,.md-c-del{flex:none;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;}
.md-c-ins{color:#22863a;}.md-c-del{color:#b31d28;}
.md-mermaid,.md-diff{border:1px solid var(--md-line);border-radius:6px;padding:10px;margin:1.2em 0;background:#fcfcfd;}
.md-diff.md-added{border-color:#abf5d1;background:#f6fffa;}
.md-diff.md-removed{border-color:#ffbdad;background:#fffafa;}
.md-out{overflow:auto;text-align:center;}
.md-out svg,.md-out img{max-width:100%;height:auto;}
.md-out table{text-align:left;}
.md-tools{margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.md-copy,.md-enlarge{padding:3px 10px;font-size:12px;font-weight:600;color:#42526e;background:#f4f5f7;border:1px solid #dfe1e6;border-radius:4px;cursor:pointer;}
.md-copy:hover,.md-enlarge:hover{background:#e9ebee;}
.md-badge{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;margin-bottom:6px;}
.md-badge-new{background:#e3fcef;color:#006644;}
.md-badge-old{background:#ffebe6;color:#bf2600;}
.md-note{color:#b31d28;background:#ffeef0;border-left:3px solid #b31d28;padding:5px 9px;margin-top:8px;font-size:12px;font-weight:600;border-radius:0 3px 3px 0;}
.md-tr{position:absolute;left:-9999px;}
.md-tabbar{display:flex;gap:6px;margin-bottom:8px;}
.md-tabbar label{cursor:pointer;padding:3px 12px;border:1px solid var(--md-line);border-radius:4px;font-size:12px;font-weight:600;background:#f4f5f7;color:#42526e;}
.md-panes .md-pane{overflow:auto;}
.md-panes .md-pane-a{display:none;}
.md-src{margin:0;max-height:420px;}
body{padding-bottom:72px;}
.md-body [id^="chg"]{cursor:pointer;}
.md-body [id^="chg"]:hover{outline:1px dashed #8fb8f6;outline-offset:3px;border-radius:2px;}
@keyframes md-flash{from{box-shadow:0 0 0 3px #ffc400;}to{box-shadow:0 0 0 3px rgba(255,196,0,0);}}
.md-flash{animation:md-flash 1.6s ease-out;}
.md-v-before .md-wrap del{text-decoration:none;}
.md-bar{position:fixed;right:16px;bottom:16px;z-index:20;display:flex;align-items:center;gap:6px;padding:6px;background:#fff;border:1px solid var(--md-line);border-radius:8px;box-shadow:0 4px 14px rgba(9,30,66,.2);}
.md-bar button,.md-modal-h button{font:inherit;font-size:12px;font-weight:600;line-height:1.4;color:#42526e;background:#f4f5f7;border:1px solid #dfe1e6;border-radius:4px;padding:4px 10px;cursor:pointer;}
.md-bar button:hover,.md-modal-h button:hover{background:#e9ebee;}
.md-modal-h button:disabled{opacity:.4;cursor:default;}
.md-seg{display:flex;}
.md-seg button{border-radius:0;margin-left:-1px;}
.md-seg button:first-child{border-radius:4px 0 0 4px;margin-left:0;}
.md-seg button:last-child{border-radius:0 4px 4px 0;}
.md-seg button[aria-pressed="true"]{background:#0052cc;border-color:#0052cc;color:#fff;}
.md-pos,.md-modal-pos{min-width:54px;text-align:center;font-size:12px;color:var(--md-muted);font-variant-numeric:tabular-nums;}
.md-bar-empty .md-step,.md-bar-empty .md-pos,.md-bar-empty .md-review{display:none;}
html.md-locked{overflow:hidden;}
.md-modal{position:fixed;top:0;right:0;bottom:0;left:0;z-index:30;display:flex;align-items:center;justify-content:center;padding:2vh 2vw;background:rgba(9,30,66,.54);}
.md-modal[hidden]{display:none;}
.md-modal-box{display:flex;flex-direction:column;width:100%;max-width:1600px;height:100%;background:#fff;border-radius:8px;box-shadow:0 8px 32px rgba(9,30,66,.3);overflow:hidden;}
.md-modal-h{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--md-line);}
.md-modal-t{flex:1;min-width:0;}
.md-modal-sec{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--md-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.md-modal-l{display:flex;gap:6px;align-items:baseline;min-width:0;font-size:13px;}
.md-modal-cols{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;}
.md-modal-col{display:flex;flex-direction:column;min-width:0;min-height:0;border-left:1px solid var(--md-line);}
.md-modal-col:first-child{border-left:none;}
.md-modal-ch{padding:6px 20px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--md-muted);background:#fafbfc;border-bottom:1px solid var(--md-line);}
.md-side{flex:1;overflow:auto;padding:12px 20px;}
.md-side>:first-child{margin-top:0;}
.md-empty{padding:28px 12px;text-align:center;font-size:13px;color:var(--md-muted);border-radius:4px;background:repeating-linear-gradient(45deg,#f4f5f7,#f4f5f7 8px,#fff 8px,#fff 16px);}
.md-side .md-diagram .md-tools{display:flex!important;}
.md-modal-h .md-loupe[aria-pressed="true"]{background:#0052cc;border-color:#0052cc;color:#fff;}
.md-loupe-on .md-side .md-diagram img{cursor:crosshair;}
.md-lens{position:fixed;z-index:40;width:280px;height:170px;pointer-events:none;background:#fff no-repeat;border:2px solid #0052cc;border-radius:6px;box-shadow:0 6px 20px rgba(9,30,66,.35);}
.md-lens[hidden]{display:none;}
@media (max-width:800px){
.md-modal{padding:0;}
.md-modal-box{border-radius:0;}
.md-modal-cols{grid-template-columns:1fr;grid-template-rows:1fr 1fr;}
.md-modal-col{border-left:none;border-top:1px solid var(--md-line);}
.md-modal-col:first-child{border-top:none;}
}
@media print{
body{padding-bottom:0;}
.md-bar,.md-modal,.md-lens,.md-tools,.md-tabbar{display:none!important;}
.md-nav{max-height:none;overflow:visible;}
.md-v-diff .md-panes .md-pane{display:block!important;}
.md-v-diff .md-pane::before{display:block;margin:8px 0 4px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--md-muted);}
.md-v-diff .md-pane-b::before{content:"Before";}
.md-v-diff .md-pane-a::before{content:"After";}
}`;

const VIEW_BOOTSTRAP_JS = `try { var v = localStorage.getItem('md-diff-view'); if (v === 'before' || v === 'after') document.body.className = 'md-v-' + v; } catch (e) { }`;

const VIEW_JS = `(function () {
  var KEY = 'md-diff-view';
  var VIEWS = ['diff', 'before', 'after'];
  var root = document.documentElement;
  var bar = document.querySelector('.md-bar');
  var position = bar.querySelector('.md-pos');
  var modal = document.querySelector('.md-modal');
  var sideBefore = modal.querySelector('.md-side-before');
  var sideAfter = modal.querySelector('.md-side-after');
  var lens = modal.querySelector('.md-lens');
  var loupe = modal.querySelector('.md-loupe');
  var ZOOM = 2.5;
  var listed = {};
  Array.prototype.forEach.call(document.querySelectorAll('.md-nav a'), function (link) { listed[link.getAttribute('href').slice(1)] = true; });
  var changes = Array.prototype.filter.call(document.querySelectorAll('.md-body [id^="chg"]'), function (element) { return listed[element.id]; });
  var focused = null;
  var movedAt = 0;
  var shown = -1;
  var lensImage = null;
  var pointer = null;

  function isVisible(element) { return element.getClientRects().length > 0; }
  function inViewport(element) { var r = element.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; }
  function visibleChanges() { return changes.filter(isVisible); }

  function currentIndex(list) {
    if (focused && (inViewport(focused) || Date.now() - movedAt < 1000)) {
      var at = list.indexOf(focused);
      if (at >= 0) return at;
    }
    var middle = window.innerHeight / 2, found = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].getBoundingClientRect().top <= middle) found = i; else break;
    }
    return found;
  }

  function updatePosition() {
    var list = visibleChanges(), at = currentIndex(list);
    position.textContent = (at < 0 ? '–' : at + 1) + ' / ' + list.length;
  }

  function flash(element) {
    element.classList.remove('md-flash');
    void element.offsetWidth;
    element.classList.add('md-flash');
    setTimeout(function () { element.classList.remove('md-flash'); }, 1600);
  }

  function moveTo(element, smooth) {
    focused = element;
    movedAt = Date.now();
    element.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    flash(element);
    updatePosition();
  }

  function step(direction) {
    var list = visibleChanges();
    if (!list.length) return;
    var at = currentIndex(list), target = at + direction;
    if (direction < 0 && at >= 0 && !inViewport(list[at])) target = at;
    moveTo(list[Math.max(0, Math.min(list.length - 1, target))], true);
  }

  function setView(view) {
    if (VIEWS.indexOf(view) < 0) view = 'diff';
    var anchor = document.elementFromPoint(window.innerWidth / 2, Math.min(120, window.innerHeight / 3));
    var anchorTop = anchor ? anchor.getBoundingClientRect().top : 0;
    VIEWS.forEach(function (name) { document.body.classList.toggle('md-v-' + name, name === view); });
    if (anchor && isVisible(anchor)) window.scrollBy(0, anchor.getBoundingClientRect().top - anchorTop);

    var buttons = bar.querySelectorAll('[data-view]');
    for (var i = 0; i < buttons.length; i++) buttons[i].setAttribute('aria-pressed', String(buttons[i].getAttribute('data-view') === view));
    try { localStorage.setItem(KEY, view); } catch (e) { }
    updatePosition();
  }

  function itemNumber(item) {
    var number = item.parentNode.start || 1;
    for (var sibling = item.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (sibling.tagName === 'LI') number++;
    }
    return number;
  }

  function fill(side, element, placeholder) {
    side.innerHTML = '';
    if (placeholder) {
      var empty = document.createElement('div');
      empty.className = 'md-empty';
      empty.textContent = placeholder;
      side.appendChild(empty);
      return;
    }

    var clone = element.cloneNode(true);
    clone.removeAttribute('id');
    clone.classList.remove('md-flash');
    var inputs = clone.querySelectorAll('input');
    for (var i = inputs.length - 1; i >= 0; i--) inputs[i].parentNode.removeChild(inputs[i]);
    var ids = clone.querySelectorAll('[id]');
    for (i = 0; i < ids.length; i++) ids[i].removeAttribute('id');

    if (element.tagName === 'LI') {
      for (i = clone.children.length - 1; i >= 0; i--) {
        if (/^(UL|OL)$/.test(clone.children[i].tagName)) clone.removeChild(clone.children[i]);
      }
      var list = document.createElement(element.parentNode.tagName);
      if (list.tagName === 'OL') list.start = itemNumber(element);
      list.appendChild(clone);
      clone = list;
    }
    side.appendChild(clone);
  }

  function hideLens() {
    lens.hidden = true;
    lensImage = null;
  }

  function placeLens(target, x, y) {
    var image = modal.classList.contains('md-loupe-on') && target && target.closest('.md-side .md-diagram img');
    if (!image) { hideLens(); return; }
    if (image !== lensImage) {
      lensImage = image;
      lens.style.backgroundImage = 'url("' + image.src + '")';
      lens.hidden = false;
    }
    var rect = image.getBoundingClientRect();
    lens.style.left = (x - lens.offsetWidth / 2) + 'px';
    lens.style.top = (y - lens.offsetHeight / 2) + 'px';
    lens.style.backgroundSize = (rect.width * ZOOM) + 'px ' + (rect.height * ZOOM) + 'px';
    lens.style.backgroundPosition = (lens.clientWidth / 2 - (x - rect.left) * ZOOM) + 'px ' +
      (lens.clientHeight / 2 - (y - rect.top) * ZOOM) + 'px';
  }

  function toggleLoupe() {
    loupe.setAttribute('aria-pressed', String(modal.classList.toggle('md-loupe-on')));
  }

  function openAt(index) {
    if (index < 0 || index >= changes.length) return;
    shown = index;
    var element = changes[index];
    var isDiagram = element.classList.contains('md-diagram');
    hideLens();
    loupe.hidden = !isDiagram;
    fill(sideBefore, element, element.classList.contains('md-blk-add') ? 'Not in the original' : '');
    fill(sideAfter, element, element.classList.contains('md-blk-del') ? 'Not in the revision' : '');

    var link = document.querySelector('.md-nav a[href="#' + element.id + '"]');
    var section = link ? link.closest('.md-sec').querySelector('.md-sec-h').textContent : '';
    modal.querySelector('.md-modal-sec').textContent = section;
    modal.querySelector('.md-modal-l').innerHTML = link ? link.innerHTML : '';
    modal.querySelector('.md-modal-pos').textContent = (index + 1) + ' / ' + changes.length;
    modal.querySelector('[data-move="-1"]').disabled = index === 0;
    modal.querySelector('[data-move="1"]').disabled = index === changes.length - 1;
    sideBefore.scrollTop = 0;
    sideAfter.scrollTop = 0;

    if (modal.hidden) {
      modal.hidden = false;
      root.classList.add('md-locked');
    }
  }

  function closeModal() {
    hideLens();
    modal.hidden = true;
    root.classList.remove('md-locked');
    var element = changes[shown];
    if (!element || !isVisible(element)) return;
    if (inViewport(element)) { focused = element; flash(element); updatePosition(); }
    else moveTo(element, false);
  }

  document.addEventListener('click', function (e) {
    var target = e.target;

    var copy = target.closest('.md-copy');
    if (copy) {
      var bin = atob(copy.getAttribute('data-src')), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      navigator.clipboard.writeText(new TextDecoder().decode(arr));
      var text = copy.textContent;
      copy.textContent = 'Copied';
      setTimeout(function () { copy.textContent = text; }, 1200);
      return;
    }

    var enlarge = target.closest('.md-enlarge');
    if (enlarge) {
      var img = enlarge.closest('.md-pane, .md-diff, .md-mermaid').querySelector('img');
      if (!img) return;
      fetch(img.src).then(function (r) { return r.blob(); })
        .then(function (blob) { window.open(URL.createObjectURL(blob), '_blank'); });
      return;
    }

    if (!modal.hidden) {
      var move = target.closest('[data-move]');
      if (target.closest('.md-loupe')) toggleLoupe();
      else if (move) openAt(shown + Number(move.getAttribute('data-move')));
      else if (target === modal || target.closest('.md-modal-x')) closeModal();
      return;
    }

    var view = target.closest('[data-view]');
    if (view) { setView(view.getAttribute('data-view')); return; }

    var stepButton = target.closest('[data-step]');
    if (stepButton) { step(Number(stepButton.getAttribute('data-step'))); return; }

    if (target.closest('.md-review')) {
      var list = visibleChanges(), at = currentIndex(list);
      openAt(at >= 0 ? changes.indexOf(list[at]) : 0);
      return;
    }

    var block = target.closest('.md-body [id^="chg"]');
    if (!block || target.closest('a, button, label, input') || String(window.getSelection())) return;
    openAt(changes.indexOf(block));
  });

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!modal.hidden) {
      if (e.key === 'Escape') closeModal();
      else if (e.key === 'ArrowLeft') openAt(shown - 1);
      else if (e.key === 'ArrowRight') openAt(shown + 1);
      else return;
      e.preventDefault();
      return;
    }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'n') step(1);
    else if (e.key === 'p') step(-1);
  });

  modal.addEventListener('mousemove', function (e) {
    pointer = e;
    placeLens(e.target, e.clientX, e.clientY);
  });
  modal.addEventListener('mouseout', function (e) { if (!e.relatedTarget) hideLens(); });
  modal.addEventListener('scroll', function () {
    if (pointer) placeLens(document.elementFromPoint(pointer.clientX, pointer.clientY), pointer.clientX, pointer.clientY);
  }, true);

  var pending = false;
  window.addEventListener('scroll', function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; updatePosition(); });
  }, { passive: true });

  if (!changes.length) bar.classList.add('md-bar-empty');
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { }
  setView(saved || 'diff');
})();`;

const viewCss = (): string => {
    const addedSelectors = ['ins', '.md-blk-add', '.md-row-add', '.md-col-add', '.md-l.md-add', '.md-pane-a'];
    const removedSelectors = ['del', '.md-blk-del', '.md-row-del', '.md-col-del', '.md-l.md-del', '.md-pane-b'];
    const chromeSelectors = ['.md-note', '.md-tabbar'];
    const modalChromeSelectors = ['.md-badge', '.md-tools'];
    const beforeScopes = ['.md-v-before .md-wrap', '.md-side-before'];
    const afterScopes = ['.md-v-after .md-wrap', '.md-side-after'];

    const join = (scopes: readonly string[], selectors: readonly string[]): string => {
        const combined: string[] = [];
        for (const prefix of scopes) {
            for (const selector of selectors) {
                combined.push(`${prefix} ${selector}`);
            }
        }

        return combined.join(',');
    };

    return (
        join(beforeScopes, addedSelectors) + '{display:none!important}' +
        join(afterScopes, removedSelectors) + '{display:none!important}' +
        join(beforeScopes, ['.md-pane-b']) + ',' + join(afterScopes, ['.md-pane-a']) + '{display:block!important}' +
        join(beforeScopes.concat(afterScopes), chromeSelectors) + ',' + join(['.md-side'], modalChromeSelectors) + '{display:none!important}'
    );
};

const renderBarHtml = (count: number): string => {
    return '<div class="md-bar" role="toolbar" aria-label="Diff view"><div class="md-seg">' +
        '<button type="button" data-view="diff" aria-pressed="true" title="Insertions and deletions">Diff</button>' +
        '<button type="button" data-view="before" aria-pressed="false" title="Read the original">Before</button>' +
        '<button type="button" data-view="after" aria-pressed="false" title="Read the revision">After</button></div>' +
        '<button type="button" class="md-step" data-step="-1" title="Previous change (p)">&#8593;</button>' +
        `<span class="md-pos">&ndash; / ${count}</span>` +
        '<button type="button" class="md-step" data-step="1" title="Next change (n)">&#8595;</button>' +
        '<button type="button" class="md-review" title="Compare side by side (or click any change)">&#8644;</button></div>';
};

const MODAL_HTML = '<div class="md-modal" hidden><div class="md-modal-box" role="dialog" aria-modal="true" aria-label="Side-by-side compare">' +
    '<div class="md-modal-h"><div class="md-modal-t"><div class="md-modal-sec"></div><div class="md-modal-l"></div></div>' +
    '<button type="button" class="md-loupe" aria-pressed="false" title="Magnify the diagram under the cursor" hidden>&#128269;</button>' +
    '<button type="button" data-move="-1" title="Previous change (&larr;)">&#8592;</button>' +
    '<span class="md-modal-pos"></span>' +
    '<button type="button" data-move="1" title="Next change (&rarr;)">&#8594;</button>' +
    '<button type="button" class="md-modal-x" title="Close (Esc)">&#10005;</button></div>' +
    '<div class="md-modal-cols">' +
    '<section class="md-modal-col"><div class="md-modal-ch">Before</div><div class="md-side md-side-before md-body"></div></section>' +
    '<section class="md-modal-col"><div class="md-modal-ch">After</div><div class="md-side md-side-after md-body"></div></section>' +
    '</div><div class="md-lens" hidden></div></div></div>';

// Additional stats the renderer collects for the caller to log.
export interface RenderStats {
    changedBlocks: number;
    insertions: number;
    deletions: number;
    diagramsDrawn: number;
    diagramsFailed: number;
}

export interface RenderResult {
    html: string;
    stats: RenderStats;
}

// Render a diff object as a standalone HTML page. Returns the HTML plus the
// change counts, which callers surface in their own UI rather than in the page.
export const renderDiffHtmlAsync = async (
    diff: MarkdownDiff,
    options: RenderOptions = {},
): Promise<RenderResult> => {
    const context = createContext(options);
    const title = options.title ?? diff.modified.path.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
    const changesOnly = options.changesOnly ?? false;

    const changes = changesOnly
        ? diff.changes.filter((change) => change.status !== 'Unchanged')
        : diff.changes;

    const bodyParts: string[] = [];
    const entries: NavEntry[] = [];
    let changeNumber = 0;
    let index = 0;

    const addEntry = (change: ChangeRecord, rendered: ChangeHtml, id: string): void => {
        if (rendered.label == null) {
            return;
        }

        const segment = change.modified ?? change.original;
        if (segment == null) {
            return;
        }

        entries.push({
            id,
            section: sectionFor(segment),
            label: rendered.label,
            ins: rendered.ins,
            del: rendered.del,
            order: entries.length,
        });
    };

    while (index < changes.length) {
        const change = changes[index]!;
        const segment = change.modified ?? change.original;
        if (segment == null) {
            index++;
            continue;
        }

        // Consecutive list items belong to one <ul>/<ol>.
        if (segment.type === 'ListItem') {
            const items: ChangeRecord[] = [];
            while (index < changes.length) {
                const candidate = changes[index]!;
                const candidateSegment = candidate.modified ?? candidate.original;
                if (candidateSegment == null || candidateSegment.type !== 'ListItem') {
                    break;
                }

                items.push(candidate);
                index++;
            }

            if (items.length === 0) {
                continue;
            }

            const firstSegment = items[0]!.modified ?? items[0]!.original;
            const rootTag = (firstSegment != null && firstSegment.ordered) ? 'ol' : 'ul';
            const tagStack: string[] = [rootTag];

            bodyParts.push(`<${rootTag}>`);
            let currentLevel = 0;
            let hasOpenItem = false;

            for (const item of items) {
                const level = getListItemLevel(item);
                const itemSegment = item.modified ?? item.original;
                if (itemSegment == null) {
                    continue;
                }

                if (hasOpenItem) {
                    if (level > currentLevel) {
                        for (let step = currentLevel; step < level; step++) {
                            const childTag = itemSegment.ordered ? 'ol' : 'ul';
                            tagStack.push(childTag);
                            bodyParts.push(`<${childTag}>`);
                        }
                    }
                    else if (level < currentLevel) {
                        for (let step = currentLevel; step > level; step--) {
                            const closingTag = tagStack.pop() ?? 'ul';
                            bodyParts.push(`</li></${closingTag}>`);
                        }

                        bodyParts.push('</li>');
                    }
                    else {
                        bodyParts.push('</li>');
                    }
                }

                currentLevel = level;

                let id = '';
                if (item.status !== 'Unchanged') {
                    changeNumber++;
                    id = `chg${changeNumber}`;
                }

                const rendered = renderListItemHtml(item, id);
                bodyParts.push(rendered.html);
                addEntry(item, rendered, id);
                hasOpenItem = true;
            }

            if (hasOpenItem) {
                for (let step = currentLevel; step > 0; step--) {
                    const closingTag = tagStack.pop() ?? 'ul';
                    bodyParts.push(`</li></${closingTag}>`);
                }

                bodyParts.push('</li>');
            }

            bodyParts.push(`</${rootTag}>`);
            continue;
        }

        let id = '';
        if (change.status !== 'Unchanged') {
            changeNumber++;
            id = `chg${changeNumber}`;
        }

        const rendered = await renderChangeHtmlAsync(change, id, context);
        bodyParts.push(rendered.html);
        addEntry(change, rendered, id);
        index++;
    }

    const navHtml = renderNavHtml(entries);
    const barHtml = renderBarHtml(entries.length);
    const meta = `${escapeHtml(diff.original.path)}  &rarr;  ${escapeHtml(diff.modified.path)}`;

    const css = BASE_CSS + viewCss() + context.tabCss.join('');

    const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        `<title>${escapeHtml(title)} &mdash; diff</title><style>${css}</style></head>` +
        `<body class="md-v-diff"><script>${VIEW_BOOTSTRAP_JS}</script><div class="md-wrap">` +
        `<div class="md-meta">${meta}</div><h1 class="md-title">${escapeHtml(title)}</h1>` +
        `${navHtml}<div class="md-body">${bodyParts.join('')}</div></div>` +
        `${barHtml}${MODAL_HTML}` +
        `<script>${VIEW_JS}</script></body></html>`;

    let insertions = 0;
    let deletions = 0;
    for (const entry of entries) {
        insertions += entry.ins;
        deletions += entry.del;
    }

    return {
        html,
        stats: {
            changedBlocks: entries.length,
            insertions,
            deletions,
            diagramsDrawn: context.diagramsDrawn,
            diagramsFailed: context.diagramsFailed,
        },
    };
};
