import { foldKeepingOffsets } from '../../common/text/findFolding.js';

// Find in a rendered document: every match of a query, ignoring case and accents as PDF Find does,
// within one paragraph or cell at a time, shown with the CSS Custom Highlight API,
// so the document's own nodes are never split or wrapped.

const BLOCK_SELECTOR = 'p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, pre, caption, dd, dt';

export const FIND_HIGHLIGHT = 'nib-document-find';
export const FIND_CURRENT_HIGHLIGHT = 'nib-document-find-current';

interface TextSegment {
    readonly nodes: Text[];
    // Where each node starts in the segment's text.
    readonly starts: number[];
    text: string;
}

// Every text node under `root`, in document order.
export function* textNodesOf(root: Node): Generator<Text> {
    const walker = (root.ownerDocument ?? document).createTreeWalker(root, NodeFilter.SHOW_TEXT);

    for (let node = walker.nextNode(); node != null; node = walker.nextNode()) {
        yield node as Text;
    }
}

// The text of a document, read once, to search as the query changes.
export interface TextIndex {
    // Ranges of every match of `query` in reading order; a match never spans two blocks.
    find(query: string): Range[];
}

export function indexText(root: Node): TextIndex {
    const segments = textSegments(root).map((segment) => ({ segment, folded: foldKeepingOffsets(segment.text) }));

    return {
        find: (query) => {
            const needle = foldKeepingOffsets(query.trim());
            const ranges: Range[] = [];

            if (needle === '') {
                return ranges;
            }

            for (const { segment, folded } of segments) {
                let index = folded.indexOf(needle);

                while (index >= 0) {
                    ranges.push(rangeIn(segment, index, index + needle.length));
                    index = folded.indexOf(needle, index + needle.length);
                }
            }

            return ranges;
        },
    };
}

function textSegments(root: Node): TextSegment[] {
    const segments: TextSegment[] = [];
    let block: Element | null = null;
    let segment: TextSegment | null = null;

    for (const text of textNodesOf(root)) {
        const owningBlock = text.parentElement?.closest(BLOCK_SELECTOR) ?? null;

        if (segment == null || owningBlock !== block) {
            segment = { nodes: [], starts: [], text: '' };
            segments.push(segment);
            block = owningBlock;
        }

        segment.nodes.push(text);
        segment.starts.push(segment.text.length);
        segment.text += text.data;
    }

    return segments;
}

function rangeIn(segment: TextSegment, start: number, end: number): Range {
    const range = (segment.nodes[0]?.ownerDocument ?? document).createRange();
    const startAt = locate(segment, start, false);
    const endAt = locate(segment, end, true);
    range.setStart(startAt.node, startAt.offset);
    range.setEnd(endAt.node, endAt.offset);

    return range;
}

// The node and offset of a position; an end position on a node boundary stays in the earlier node.
function locate(segment: TextSegment, position: number, isEnd: boolean): { readonly node: Text; readonly offset: number } {
    for (let index = segment.nodes.length - 1; index >= 0; index -= 1) {
        const start = segment.starts[index] ?? 0;
        const node = segment.nodes[index];

        if (node != null && (isEnd ? start < position : start <= position)) {
            return { node, offset: position - start };
        }
    }

    const first = segment.nodes[0] as Text;

    return { node: first, offset: 0 };
}

export interface FindHighlighter {
    show(ranges: ReadonlyArray<Range>, current: number): void;
    clear(): void;
}

// The names the highlights are registered under, which the style sheet colours with ::highlight().
export interface FindHighlightNames {
    readonly all: string;
    readonly current: string;
}

const DOCUMENT_HIGHLIGHT_NAMES: FindHighlightNames = Object.freeze({ all: FIND_HIGHLIGHT, current: FIND_CURRENT_HIGHLIGHT });

// Draws matches through CSS.highlights where the browser has it; elsewhere matches are found but not drawn.
// Another viewer, such as the PDF preview, passes names of its own to colour its matches its own way.
export function createFindHighlighter(names: FindHighlightNames = DOCUMENT_HIGHLIGHT_NAMES): FindHighlighter {
    const registry = typeof CSS !== 'undefined' && typeof Highlight === 'function' ? CSS.highlights : undefined;

    if (registry == null) {
        return { show: () => {}, clear: () => {} };
    }

    return {
        show: (ranges, current) => {
            registry.set(names.all, new Highlight(...ranges));
            const active = ranges[current];

            if (active == null) {
                registry.delete(names.current);

                return;
            }

            registry.set(names.current, new Highlight(active));
        },
        clear: () => {
            registry.delete(names.all);
            registry.delete(names.current);
        },
    };
}
