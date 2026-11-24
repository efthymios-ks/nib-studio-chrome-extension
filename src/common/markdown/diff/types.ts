// Shared type definitions for the markdown diff comparer and renderer.

// All structural markdown block types the segmenter recognises.
export type SegmentType =
    | 'Heading'
    | 'Paragraph'
    | 'ListItem'
    | 'Table'
    | 'Mermaid'
    | 'Code'
    | 'BlockQuote'
    | 'Rule'
    | 'FrontMatter'
    | 'Html';

// The four states every segment pair resolves to after alignment.
export type DiffStatus = 'Added' | 'Removed' | 'Modified' | 'Unchanged';

// Operation on a single run of text or a single line.
export type DiffOp = 'Added' | 'Removed' | 'Equal';

// The inline diff mode: word-level for prose, line-level for code.
export type InlineKind = 'Word' | 'Line';

// One typed block of markdown: everything the comparer needs to pair it with
// its counterpart and the renderer needs to re-render it.
export interface MarkdownSegment {
    // The block type. Only blocks of the same type pair.
    type: SegmentType;

    // Heading depth (1..6). Zero on everything except Heading.
    level: number;

    // The language identifier on a fenced code block. '' otherwise.
    language: string;

    // True for an ordered list item.
    ordered: boolean;

    // Column-of-first-non-whitespace for a list item.
    indent: number;

    // The ' > ' joined heading path the block sits under. '' at the top.
    path: string;

    // Normalised text for comparison / display. Whitespace collapsed.
    text: string;

    // The block's raw source lines joined with newlines.
    raw: string;

    // The block's raw source as an array of lines.
    lines: string[];

    // 1-based line number where the block begins in the source.
    startLine: number;

    // 1-based line number where the block ends (inclusive).
    endLine: number;

    // True for table / mermaid / frontmatter / html — paired loosely, kept whole.
    atomic: boolean;

    // The stable key the LCS pass compares. Identical keys ⇒ Unchanged.
    key: string;

    // The text the similarity score is computed against.
    compareText: string;
}

// One inline run inside a modified prose segment or a table cell.
// Equal + Added + Removed runs read in order give the hunked diff.
export interface InlineRun {
    // The operation this run carries.
    op: DiffOp;

    // The run's visible text, whitespace preserved.
    text: string;
}

// One column of an aligned table diff.
export interface TableColumnDiff {
    // This column's state in the merged table.
    status: DiffStatus;

    // Index into the original table's header row, or -1 when added.
    originalIndex: number;

    // Index into the modified table's header row, or -1 when removed.
    modifiedIndex: number;

    // The header text on the original side.
    original: string;

    // The header text on the modified side.
    modified: string;

    // Word-level inline runs when the header changed, null otherwise.
    inline: InlineRun[] | null;
}

// One cell inside an aligned table diff.
export interface TableCellDiff {
    // The cell's state. 'Added' / 'Removed' comes from its row or column.
    status: DiffStatus;

    // The column's own state, so added/removed columns propagate to every cell.
    column: DiffStatus;

    // The original cell text.
    original: string;

    // The modified cell text.
    modified: string;

    // Word-level inline runs when the cell changed, null otherwise.
    inline: InlineRun[] | null;
}

// One row of an aligned table diff. Added and removed rows render as a band;
// a row that only moved keeps its cells' individual states.
export interface TableRowDiff {
    // The row's state.
    status: DiffStatus;

    // Index into the original table's body rows, or -1 when added.
    originalIndex: number;

    // Index into the modified table's body rows, or -1 when removed.
    modifiedIndex: number;

    // One entry per column, in column order.
    cells: TableCellDiff[];
}

// A table paired with its counterpart: columns, rows and cells all aligned.
// Insertions and deletions counted per word / column / row.
export interface TableDiff {
    // The aligned columns in merged order.
    columns: TableColumnDiff[];

    // The aligned body rows in merged order.
    rows: TableRowDiff[];

    // Word-level insertions across the whole table.
    inserted: number;

    // Word-level deletions across the whole table.
    deleted: number;
}

// One block's entry in the diff result. Pairs the two sides and carries the
// hunks (prose) or the table-level diff (tables); atomic blocks keep both
// copies verbatim for re-render.
export interface ChangeRecord {
    // 0-based position in the diff's Changes array.
    index: number;

    // The block's state in the merged document.
    status: DiffStatus;

    // The underlying block type.
    type: SegmentType;

    // The heading path the block sits under.
    path: string;

    // True when the block is atomic (table / mermaid / frontmatter / html).
    atomic: boolean;

    // 0..1 similarity between the paired sides. 1.0 when Unchanged.
    similarity: number;

    // The original side, null on a pure addition.
    original: MarkdownSegment | null;

    // The modified side, null on a pure removal.
    modified: MarkdownSegment | null;

    // 'Word' for prose, 'Line' for code, null otherwise.
    inlineKind: InlineKind | null;

    // Inline hunks for Modified non-atomic blocks.
    inline: InlineRun[] | null;

    // Row / column / cell alignment for a Modified Table.
    tableDiff: TableDiff | null;
}

// Counts of each status after alignment. Totals go to the caller.
export interface DiffSummary {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
    total: number;
}

// Metadata on one side's source.
export interface DiffSide {
    // Display name for the side.
    path: string;

    // Number of segments the splitter produced.
    segmentCount: number;

    // Number of lines the input had.
    lineCount: number;
}

// The structured object the comparer returns. Renderer consumers only need Original.Path / Modified.Path and the
// Changes array; the summary is convenience.
export interface MarkdownDiff {
    original: DiffSide;
    modified: DiffSide;
    summary: DiffSummary;
    changes: ChangeRecord[];
}

// Options accepted by the comparer.
export interface CompareOptions {
    // Minimum similarity (0..1) for two unmatched segments of the same type
    // to come back as Modified instead of Removed + Added. Per-type floors
    // override it (headings tight, atomic blocks loose).
    similarityThreshold?: number;

    // Keep Unchanged segments in the Changes array. Required when the
    // renderer is going to lay out the whole merged document.
    includeUnchanged?: boolean;

    // Override the display name for the original side.
    originalName?: string;

    // Override the display name for the modified side.
    modifiedName?: string;
}

// Turns Mermaid source into SVG, passed in so the diff module doesn't depend on the mermaid package;
// null or a throw shows the diagram's source as diffed code.
export type MermaidRenderer = (source: string) => Promise<string | null>;

// Options accepted by the renderer.
export interface RenderOptions {
    // Page heading. Defaults to the modified side's path.
    title?: string;

    // Omit Unchanged blocks from the body; still render the Changes index.
    changesOnly?: boolean;

    // Callback that renders a mermaid source string to an SVG string. When
    // absent, diagrams are rendered as diffed code blocks.
    renderMermaid?: MermaidRenderer;
}
