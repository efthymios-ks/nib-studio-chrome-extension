// Compares two Markdown documents block by block: an LCS over the block keys anchors identical blocks,
// a fuzzy pass over the gaps pairs edited ones, and anything left unpaired is added or removed.
import type {
    ChangeRecord,
    CompareOptions,
    DiffOp,
    DiffStatus,
    InlineRun,
    MarkdownDiff,
    MarkdownSegment,
    SegmentType,
    TableCellDiff,
    TableColumnDiff,
    TableDiff,
    TableRowDiff,
} from './types.js';

const ATOMIC_TYPES: readonly SegmentType[] = ['Table', 'Mermaid', 'FrontMatter', 'Html'];
const FENCE_REGEX = /^\s{0,3}(`{3,}|~{3,})\s*(.*)$/;
const HEADING_REGEX = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM_REGEX = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const BLOCK_QUOTE_REGEX = /^\s{0,3}>/;
const SETEXT_REGEX = /^\s{0,3}(=+|-+)\s*$/;
const HTML_BLOCK_REGEX = /^\s{0,3}<[a-zA-Z!/]/;

const MAX_LEVENSHTEIN_LENGTH = 1500;
const MAX_DIFF_CELLS = 2_000_000;

// A sentence ends at . ! ? ; then closing markup, then whitespace, then a capital, a digit or opening markup.
const SENTENCE_BREAK_REGEX = /(?<=[.!?;][)\]"'*_`]*\s+)(?=[\p{Lu}\p{N}"'(\[*_`])/u;

// An unchanged run of this many words or fewer between two edits joins them into one hunk.
const MAX_ISLAND_WORDS = 2;

// Past this share of changed words a sentence reads better as removed + added whole.
const MAX_SENTENCE_CHANGE_RATIO = 0.5;

const DEFAULT_SIMILARITY_THRESHOLD = 0.45;

interface SegmentInput {
    type: SegmentType;
    lines: string[];
    startLine: number;
    endLine: number;
    text?: string;
    path?: string;
    level?: number;
    language?: string;
    ordered?: boolean;
    indent?: number;
}

const createSegment = (input: SegmentInput): MarkdownSegment => {
    const text = input.text ?? '';
    const lines = input.lines;
    const type = input.type;

    const normalisedText = text.replace(/\s+/g, ' ').trim();
    const normalisedRaw = lines.map((line) => line.replace(/\s+$/, '')).join('\n');
    const isAtomic = (ATOMIC_TYPES as readonly SegmentType[]).includes(type);

    // Atomic and code blocks compare by their raw body; prose by normalised text.
    const compareText = (isAtomic || type === 'Code') ? normalisedRaw : normalisedText;

    const level = input.level ?? 0;
    const ordered = input.ordered ?? false;
    const indent = input.indent ?? 0;
    const language = input.language ?? '';

    let key: string;
    if (type === 'Heading') {
        key = `${type}|${level}|${normalisedText}`;
    }
    else if (type === 'ListItem') {
        key = `${type}|${indent}|${ordered}|${normalisedText}`;
    }
    else if (type === 'Code') {
        key = `${type}|${language}|${normalisedRaw}`;
    }
    else if (type === 'Rule') {
        key = type;
    }
    else if (isAtomic) {
        key = `${type}|${normalisedRaw}`;
    }
    else {
        key = `${type}|${normalisedText}`;
    }

    return {
        type,
        level,
        language,
        ordered,
        indent,
        path: input.path ?? '',
        text: normalisedText,
        raw: lines.join('\n'),
        lines,
        startLine: input.startLine,
        endLine: input.endLine,
        atomic: isAtomic,
        key,
        compareText,
    };
};

const isThematicBreak = (line: string): boolean => {
    const stripped = line.replace(/\s/g, '');
    if (stripped.length < 3) {
        return false;
    }

    for (const char of ['*', '-', '_']) {
        if (stripped.split(char).join('').length === 0) {
            return true;
        }
    }

    return false;
};

const isTableSeparator = (line: string): boolean => {
    const trimmed = line.trim();
    if (!/\|/.test(trimmed)) {
        return false;
    }

    return /^\|?[\s:|-]*-[\s:|-]*\|?$/.test(trimmed);
};

const headingPath = (stack: string[], upToLevel: number): string => {
    const parts: string[] = [];
    for (let level = 1; level <= upToLevel; level++) {
        const entry = stack[level];
        if (entry) {
            parts.push(entry);
        }
    }

    return parts.join(' > ');
};

// Split a markdown document into typed segments in document order.
const splitMarkdownSegments = (lines: readonly string[]): MarkdownSegment[] => {
    const segments: MarkdownSegment[] = [];
    const headings: string[] = Array.from({ length: 7 }, () => '');
    const count = lines.length;
    let index = 0;

    while (index < count) {
        const current = lines[index] ?? '';

        if (/^\s*$/.test(current)) {
            index++;
            continue;
        }

        // Front matter only when it opens the document.
        if (index === 0 && current.trim() === '---') {
            const start = index++;
            while (index < count && (lines[index] ?? '').trim() !== '---') {
                index++;
            }

            if (index < count) {
                index++;
            }

            segments.push(createSegment({
                type: 'FrontMatter',
                lines: lines.slice(start, index),
                startLine: start + 1,
                endLine: index,
            }));
            continue;
        }

        // Fenced block — mermaid or code.
        const fenceMatch = current.match(FENCE_REGEX);
        if (fenceMatch) {
            const fence = fenceMatch[1]!.substring(0, 3);
            const info = (fenceMatch[2] ?? '').trim();
            const start = index++;
            const closeRegex = new RegExp(`^\\s{0,3}${escapeRegExp(fence)}+\\s*$`);

            while (index < count && !closeRegex.test(lines[index] ?? '')) {
                index++;
            }

            if (index < count) {
                index++;
            }

            const block = lines.slice(start, index);
            const language = info.split(/\s+/)[0] ?? '';
            const type: SegmentType = /^mermaid$/i.test(language) ? 'Mermaid' : 'Code';
            const body = block.length > 2 ? block.slice(1, block.length - 1).join('\n') : '';

            segments.push(createSegment({
                type,
                lines: block,
                startLine: start + 1,
                endLine: index,
                text: body,
                language,
                path: headingPath(headings, 6),
            }));
            continue;
        }

        // ATX heading.
        const headingMatch = current.match(HEADING_REGEX);
        if (headingMatch) {
            const level = headingMatch[1]!.length;
            const text = headingMatch[2] ?? '';

            for (let deeper = level; deeper <= 6; deeper++) {
                headings[deeper] = '';
            }

            const parentPath = headingPath(headings, level - 1);
            headings[level] = text.replace(/\s+/g, ' ').trim();

            segments.push(createSegment({
                type: 'Heading',
                lines: [current],
                startLine: index + 1,
                endLine: index + 1,
                text,
                level,
                path: parentPath,
            }));
            index++;
            continue;
        }

        // Table — header row followed by separator row.
        if (
            /\|/.test(current)
            && (index + 1) < count
            && isTableSeparator(lines[index + 1] ?? '')
        ) {
            const start = index;
            while (
                index < count
                && /\S/.test(lines[index] ?? '')
                && /\|/.test(lines[index] ?? '')
            ) {
                index++;
            }

            segments.push(createSegment({
                type: 'Table',
                lines: lines.slice(start, index),
                startLine: start + 1,
                endLine: index,
                path: headingPath(headings, 6),
            }));
            continue;
        }

        if (isThematicBreak(current)) {
            segments.push(createSegment({
                type: 'Rule',
                lines: [current],
                startLine: index + 1,
                endLine: index + 1,
                path: headingPath(headings, 6),
            }));
            index++;
            continue;
        }

        // List item — one segment per item so nested items diff on their own.
        const listMatch = current.match(LIST_ITEM_REGEX);
        if (listMatch) {
            const indent = listMatch[1]!.length;
            const marker = listMatch[2]!;
            let text = listMatch[3] ?? '';
            const start = index++;

            while (index < count) {
                const next = lines[index] ?? '';
                if (/^\s*$/.test(next)) {
                    break;
                }

                if (
                    LIST_ITEM_REGEX.test(next)
                    || HEADING_REGEX.test(next)
                    || FENCE_REGEX.test(next)
                    || isThematicBreak(next)
                ) {
                    break;
                }

                text += ' ' + next.trim();
                index++;
            }

            segments.push(createSegment({
                type: 'ListItem',
                lines: lines.slice(start, index),
                startLine: start + 1,
                endLine: index,
                text,
                indent,
                ordered: /^\d/.test(marker),
                path: headingPath(headings, 6),
            }));
            continue;
        }

        if (BLOCK_QUOTE_REGEX.test(current)) {
            const start = index;
            while (
                index < count
                && /\S/.test(lines[index] ?? '')
                && BLOCK_QUOTE_REGEX.test(lines[index] ?? '')
            ) {
                index++;
            }

            const block = lines.slice(start, index);
            const text = block.map((line) => line.replace(/^\s{0,3}>\s?/, '')).join(' ');

            segments.push(createSegment({
                type: 'BlockQuote',
                lines: block,
                startLine: start + 1,
                endLine: index,
                text,
                path: headingPath(headings, 6),
            }));
            continue;
        }

        if (HTML_BLOCK_REGEX.test(current)) {
            const start = index;
            while (index < count && /\S/.test(lines[index] ?? '')) {
                index++;
            }

            segments.push(createSegment({
                type: 'Html',
                lines: lines.slice(start, index),
                startLine: start + 1,
                endLine: index,
                path: headingPath(headings, 6),
            }));
            continue;
        }

        // Paragraph — also detects a setext heading closing it.
        const start = index;
        const paragraph: string[] = [];
        let setextLevel = 0;

        while (index < count) {
            const next = lines[index] ?? '';
            if (/^\s*$/.test(next)) {
                break;
            }

            if (paragraph.length > 0 && SETEXT_REGEX.test(next)) {
                setextLevel = next.trim().startsWith('=') ? 1 : 2;
                index++;
                break;
            }

            if (
                HEADING_REGEX.test(next)
                || FENCE_REGEX.test(next)
                || LIST_ITEM_REGEX.test(next)
                || BLOCK_QUOTE_REGEX.test(next)
            ) {
                break;
            }

            if (
                /\|/.test(next)
                && (index + 1) < count
                && isTableSeparator(lines[index + 1] ?? '')
            ) {
                break;
            }

            if (isThematicBreak(next)) {
                break;
            }

            paragraph.push(next);
            index++;
        }

        if (paragraph.length === 0) {
            index++;
            continue;
        }

        const paragraphText = paragraph.join(' ');

        if (setextLevel > 0) {
            for (let deeper = setextLevel; deeper <= 6; deeper++) {
                headings[deeper] = '';
            }

            const parentPath = headingPath(headings, setextLevel - 1);
            headings[setextLevel] = paragraphText.replace(/\s+/g, ' ').trim();

            segments.push(createSegment({
                type: 'Heading',
                lines: lines.slice(start, index),
                startLine: start + 1,
                endLine: index,
                text: paragraphText,
                level: setextLevel,
                path: parentPath,
            }));
        }
        else {
            segments.push(createSegment({
                type: 'Paragraph',
                lines: paragraph,
                startLine: start + 1,
                endLine: index,
                text: paragraphText,
                path: headingPath(headings, 6),
            }));
        }
    }

    return segments;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface LcsPair {
    referenceIndex: number;
    differenceIndex: number;
}

const lcsPairs = (reference: readonly string[], difference: readonly string[]): LcsPair[] => {
    const referenceCount = reference.length;
    const differenceCount = difference.length;
    const pairs: LcsPair[] = [];
    if (referenceCount === 0 || differenceCount === 0) {
        return pairs;
    }

    // One-dimensional backing array keeps allocation fixed and index math cheap.
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
            pairs.push({ referenceIndex: x, differenceIndex: y });
            x++;
            y++;
        }
        else if (at(x + 1, y) >= at(x, y + 1)) {
            x++;
        }
        else {
            y++;
        }
    }

    return pairs;
};

interface SequenceOp {
    op: DiffOp;
    items: string[];
}

const compareSequence = (reference: readonly string[], difference: readonly string[]): SequenceOp[] => {
    const ops: SequenceOp[] = [];

    // A very large input would blow up the O(n*m) table; report it as one replace.
    if (reference.length * difference.length > MAX_DIFF_CELLS) {
        if (reference.length > 0) {
            ops.push({ op: 'Removed', items: [...reference] });
        }

        if (difference.length > 0) {
            ops.push({ op: 'Added', items: [...difference] });
        }

        return ops;
    }

    const appendOp = (op: DiffOp, items: string[]): void => {
        if (items.length === 0) {
            return;
        }

        const last = ops.length > 0 ? ops[ops.length - 1] : undefined;
        if (last && last.op === op) {
            last.items = last.items.concat(items);

            return;
        }

        ops.push({ op, items: [...items] });
    };

    let x = 0;
    let y = 0;
    for (const pair of lcsPairs(reference, difference)) {
        if (pair.referenceIndex > x) {
            appendOp('Removed', reference.slice(x, pair.referenceIndex));
        }

        if (pair.differenceIndex > y) {
            appendOp('Added', difference.slice(y, pair.differenceIndex));
        }

        appendOp('Equal', [reference[pair.referenceIndex]!]);
        x = pair.referenceIndex + 1;
        y = pair.differenceIndex + 1;
    }

    if (x < reference.length) {
        appendOp('Removed', reference.slice(x));
    }

    if (y < difference.length) {
        appendOp('Added', difference.slice(y));
    }

    return ops;
};

const countWords = (text: string): number => {
    const match = text.match(/[^\s]+/g);

    return match === null ? 0 : match.length;
};

const splitSentences = (text: string): string[] => {
    // Each piece keeps its trailing whitespace, so joining the pieces gives the text back.
    return text.split(SENTENCE_BREAK_REGEX).filter((piece) => piece !== '');
};

const joinInlineRuns = (runs: readonly InlineRun[]): InlineRun[] => {
    const joined: InlineRun[] = [];
    for (const run of runs) {
        if (run.text === '') {
            continue;
        }

        const last = joined.length > 0 ? joined[joined.length - 1] : undefined;
        if (last && last.op === run.op) {
            last.text += run.text;
            continue;
        }

        joined.push({ op: run.op, text: run.text });
    }

    return joined;
};

// Turns word-level operations into readable hunks. Consecutive edits, and
// the unchanged islands of MAX_ISLAND_WORDS or fewer between them, become
// one hunk: all of its removed text, then all of its added text. Word
// alignment latches on to short words like "the", so without this a
// rewritten clause shreds into alternating removed and added fragments.
interface InlineBlock {
    isEqual: boolean;
    text: string;
    removed: string;
    added: string;
}

const mergeInlineHunks = (operations: readonly SequenceOp[]): InlineBlock[] => {
    const blocks: InlineBlock[] = [];
    for (const op of operations) {
        const text = op.items.join('');
        if (op.op === 'Equal') {
            blocks.push({ isEqual: true, text, removed: '', added: '' });
            continue;
        }

        let last = blocks.length > 0 ? blocks[blocks.length - 1] : undefined;
        if (last == null || last.isEqual) {
            last = { isEqual: false, text: '', removed: '', added: '' };
            blocks.push(last);
        }

        if (op.op === 'Removed') {
            last.removed += text;
        }
        else {
            last.added += text;
        }
    }

    const hunks: InlineBlock[] = [];
    let index = 0;
    while (index < blocks.length) {
        const block = blocks[index]!;
        const previous = hunks.length > 0 ? hunks[hunks.length - 1] : undefined;
        const next = (index + 1) < blocks.length ? blocks[index + 1] : undefined;

        const isIsland = (
            block.isEqual
            && previous != null
            && !previous.isEqual
            && next != null
            && !next.isEqual
            && countWords(block.text) <= MAX_ISLAND_WORDS
        );

        if (isIsland && previous != null && next != null) {
            previous.removed += block.text + next.removed;
            previous.added += block.text + next.added;
            index += 2;
            continue;
        }

        hunks.push(block);
        index++;
    }

    return hunks;
};

const hunksToRuns = (hunks: readonly InlineBlock[]): InlineRun[] => {
    const runs: InlineRun[] = [];
    for (const hunk of hunks) {
        if (hunk.isEqual) {
            runs.push({ op: 'Equal', text: hunk.text });
            continue;
        }

        let removed = hunk.removed;
        let added = hunk.added;
        let leading = '';
        let trailing = '';

        // Whitespace both sides share stays outside the change, so the highlight hugs the words.
        if (/\S/.test(removed) && /\S/.test(added)) {
            const removedLead = /^\s*/.exec(removed)?.[0] ?? '';
            const addedLead = /^\s*/.exec(added)?.[0] ?? '';
            if (removedLead !== '' && addedLead !== '') {
                leading = addedLead;
                removed = removed.substring(removedLead.length);
                added = added.substring(addedLead.length);
            }

            const removedTail = /\s*$/.exec(removed)?.[0] ?? '';
            const addedTail = /\s*$/.exec(added)?.[0] ?? '';
            if (removedTail !== '' && addedTail !== '') {
                trailing = addedTail;
                removed = removed.substring(0, removed.length - removedTail.length);
                added = added.substring(0, added.length - addedTail.length);
            }
        }

        runs.push({ op: 'Equal', text: leading });
        runs.push({ op: 'Removed', text: removed });
        runs.push({ op: 'Added', text: added });
        runs.push({ op: 'Equal', text: trailing });
    }

    return joinInlineRuns(runs);
};

// Diffs one changed stretch of sentences into hunks. A stretch whose
// changed words pass MAX_SENTENCE_CHANGE_RATIO of its total comes back as
// one removed + one added run: past that point word highlights only shred
// the sentence.
const sentenceRuns = (original: string, modified: string): InlineRun[] => {
    const rewrite: InlineBlock = { isEqual: false, text: '', removed: original, added: modified };
    if (original === '' || modified === '') {
        return hunksToRuns([rewrite]);
    }

    const reference: string[] = [];
    const difference: string[] = [];
    for (const match of original.matchAll(/\s+|[^\s]+/g)) {
        reference.push(match[0]);
    }

    for (const match of modified.matchAll(/\s+|[^\s]+/g)) {
        difference.push(match[0]);
    }

    const hunks = mergeInlineHunks(compareSequence(reference, difference));

    let changed = 0;
    for (const hunk of hunks) {
        if (!hunk.isEqual) {
            changed += countWords(hunk.removed) + countWords(hunk.added);
        }
    }

    const total = countWords(original) + countWords(modified);

    if (total > 0 && (changed / total) > MAX_SENTENCE_CHANGE_RATIO) {
        return hunksToRuns([rewrite]);
    }

    return hunksToRuns(hunks);
};

// Produce inline runs for two strings. 'Word' aligns sentences first then
// diffs each changed stretch; 'Line' diffs by line.
export const inlineDiff = (original: string, modified: string, mode: 'Word' | 'Line' = 'Word'): InlineRun[] => {
    if (mode === 'Line') {
        const runs: InlineRun[] = [];
        for (const op of compareSequence(original.split('\n'), modified.split('\n'))) {
            runs.push({ op: op.op, text: op.items.join('\n') });
        }

        return runs;
    }

    // Sentences align first, so an edit never bleeds into the unchanged sentences around it.
    const originalSentences = splitSentences(original);
    const modifiedSentences = splitSentences(modified);
    const originalKeys = originalSentences.map((piece) => piece.trim());
    const modifiedKeys = modifiedSentences.map((piece) => piece.trim());

    // The closing sentinel flushes the changed stretch after the last unchanged sentence.
    const anchors: LcsPair[] = lcsPairs(originalKeys, modifiedKeys);
    anchors.push({ referenceIndex: originalSentences.length, differenceIndex: modifiedSentences.length });

    const runs: InlineRun[] = [];
    let x = 0;
    let y = 0;
    for (const anchor of anchors) {
        const removed = anchor.referenceIndex > x ? originalSentences.slice(x, anchor.referenceIndex).join('') : '';
        const added = anchor.differenceIndex > y ? modifiedSentences.slice(y, anchor.differenceIndex).join('') : '';
        if (removed !== '' || added !== '') {
            for (const run of sentenceRuns(removed, added)) {
                runs.push(run);
            }
        }

        if (anchor.referenceIndex < originalSentences.length) {
            // Equal once trimmed: keep the side with the longer trailing whitespace so the next sentence never glues on.
            const before = originalSentences[anchor.referenceIndex] ?? '';
            const after = modifiedSentences[anchor.differenceIndex] ?? '';
            runs.push({ op: 'Equal', text: before.length > after.length ? before : after });
        }

        x = anchor.referenceIndex + 1;
        y = anchor.differenceIndex + 1;
    }

    return joinInlineRuns(runs);
};

// Levenshtein-based similarity on short strings, Jaccard on tokens otherwise.
const textSimilarity = (original: string, modified: string): number => {
    if (original === modified) {
        return 1.0;
    }

    if (original === '' || modified === '') {
        return 0.0;
    }

    if (original.length <= MAX_LEVENSHTEIN_LENGTH && modified.length <= MAX_LEVENSHTEIN_LENGTH) {
        const originalLength = original.length;
        const modifiedLength = modified.length;
        let previous = new Int32Array(modifiedLength + 1);
        let current = new Int32Array(modifiedLength + 1);
        for (let column = 0; column <= modifiedLength; column++) {
            previous[column] = column;
        }

        for (let x = 1; x <= originalLength; x++) {
            current[0] = x;
            for (let y = 1; y <= modifiedLength; y++) {
                const cost = original.charCodeAt(x - 1) === modified.charCodeAt(y - 1) ? 0 : 1;
                current[y] = Math.min(
                    (current[y - 1] ?? 0) + 1,
                    (previous[y] ?? 0) + 1,
                    (previous[y - 1] ?? 0) + cost,
                );
            }

            const swap = previous;
            previous = current;
            current = swap;
        }

        const distance = previous[modifiedLength] ?? 0;
        const score = 1.0 - (distance / Math.max(originalLength, modifiedLength));

        return Math.round(score * 10_000) / 10_000;
    }

    // Long blocks: token overlap. Levenshtein would be quadratic on thousands of chars.
    const originalTokens = new Set(original.split(/\W+/).filter((token) => token !== ''));
    const modifiedTokens = new Set(modified.split(/\W+/).filter((token) => token !== ''));
    if (originalTokens.size === 0 && modifiedTokens.size === 0) {
        return 1.0;
    }

    let intersection = 0;
    for (const token of originalTokens) {
        if (modifiedTokens.has(token)) {
            intersection++;
        }
    }

    const union = new Set([...originalTokens, ...modifiedTokens]);
    if (union.size === 0) {
        return 0.0;
    }

    return Math.round((intersection / union.size) * 10_000) / 10_000;
};

const typeThreshold = (type: SegmentType, fallback: number): number => {
    const overrides: Partial<Record<SegmentType, number>> = {
        Table: 0.20,
        Mermaid: 0.20,
        Html: 0.20,
        FrontMatter: 0.10,
        Code: 0.30,
        Heading: 0.35,
        Rule: 0.00,
    };
    const override = overrides[type];

    return override == null ? fallback : override;
};

interface GapCandidate {
    original: number;
    modified: number;
    score: number;
    forced: boolean;
}

const resolveGapPairs = (
    original: readonly MarkdownSegment[],
    modified: readonly MarkdownSegment[],
    originalIndex: readonly number[],
    modifiedIndex: readonly number[],
    fallbackThreshold: number,
): GapCandidate[] => {
    const originalTypeCount = new Map<SegmentType, number>();
    const modifiedTypeCount = new Map<SegmentType, number>();
    for (const index of originalIndex) {
        const segment = original[index]!;
        originalTypeCount.set(segment.type, (originalTypeCount.get(segment.type) ?? 0) + 1);
    }

    for (const index of modifiedIndex) {
        const segment = modified[index]!;
        modifiedTypeCount.set(segment.type, (modifiedTypeCount.get(segment.type) ?? 0) + 1);
    }

    const candidates: GapCandidate[] = [];
    for (const left of originalIndex) {
        for (const right of modifiedIndex) {
            const from = original[left]!;
            const to = modified[right]!;
            if (from.type !== to.type) {
                continue;
            }

            let score = textSimilarity(from.compareText, to.compareText);
            if (from.path === to.path) {
                score = Math.min(1.0, score + 0.10);
            }

            if (from.type === 'Heading' && from.level !== to.level) {
                score -= 0.10;
            }

            // Sole instance of a block under the same heading → a rewrite, not add + remove.
            // Applies to prose too: a sole paragraph on each side reads as a rewrite even when
            // every word has been swapped.
            const forced = (
                from.path === to.path
                && originalTypeCount.get(from.type) === 1
                && modifiedTypeCount.get(from.type) === 1
            );

            candidates.push({ original: left, modified: right, score, forced });
        }
    }

    const accepted: GapCandidate[] = [];
    const ranked = candidates.slice().sort((first, second) => {
        if (first.forced !== second.forced) {
            return first.forced ? -1 : 1;
        }

        return second.score - first.score;
    });

    for (const candidate of ranked) {
        const from = original[candidate.original]!;
        const to = modified[candidate.modified]!;
        let bar = typeThreshold(from.type, fallbackThreshold);

        // A table or diagram moved to another section is a rewrite only if still mostly the same.
        if (from.atomic && from.path !== to.path) {
            bar = Math.max(bar, 0.65);
        }

        if (!candidate.forced && candidate.score < bar) {
            continue;
        }

        let clash = false;
        for (const taken of accepted) {
            if (taken.original === candidate.original || taken.modified === candidate.modified) {
                clash = true;
                break;
            }
            // Keep matches monotonic: a pair that crosses an accepted one would break the merge walk.
            const originalSign = Math.sign(candidate.original - taken.original);
            const modifiedSign = Math.sign(candidate.modified - taken.modified);
            if (originalSign !== 0 && modifiedSign !== 0 && originalSign !== modifiedSign) {
                clash = true;
                break;
            }
        }

        if (!clash) {
            accepted.push(candidate);
        }
    }

    return accepted;
};

interface ParsedTable {
    header: string[];
    rows: string[][];
}

const parseTable = (segment: MarkdownSegment): ParsedTable => {
    const lines = segment.lines.filter((line) => /\S/.test(line));

    const splitRow = (row: string): string[] => {
        const trimmed = row.trim().replace(/^\|/, '').replace(/\|$/, '');

        return trimmed.split('|').map((cell) => cell.trim());
    };

    const header = lines.length > 0 ? splitRow(lines[0]!) : [];
    const body: string[][] = [];

    // Line 1 is the |---|---| separator.
    for (let index = 2; index < lines.length; index++) {
        body.push(splitRow(lines[index]!));
    }

    return { header, rows: body };
};

interface IndexPair {
    reference: number;
    difference: number;
    score: number;
}

const resolveIndexPairs = (
    referenceText: readonly string[],
    differenceText: readonly string[],
    referenceIndex: readonly number[],
    differenceIndex: readonly number[],
    threshold: number,
): IndexPair[] => {
    const candidates: IndexPair[] = [];
    for (const left of referenceIndex) {
        for (const right of differenceIndex) {
            const score = textSimilarity(referenceText[left] ?? '', differenceText[right] ?? '');
            if (score < threshold) {
                continue;
            }

            candidates.push({ reference: left, difference: right, score });
        }
    }

    const accepted: IndexPair[] = [];
    const ranked = candidates.slice().sort((first, second) => second.score - first.score);
    for (const candidate of ranked) {
        let clash = false;
        for (const taken of accepted) {
            if (taken.reference === candidate.reference || taken.difference === candidate.difference) {
                clash = true;
                break;
            }

            const referenceSign = Math.sign(candidate.reference - taken.reference);
            const differenceSign = Math.sign(candidate.difference - taken.difference);
            if (referenceSign !== 0 && differenceSign !== 0 && referenceSign !== differenceSign) {
                clash = true;
                break;
            }
        }

        if (!clash) {
            accepted.push(candidate);
        }
    }

    return accepted;
};

interface AlignedIndexMap {
    map: Map<number, number>;
    exact: Set<number>;
}

const alignedIndexMap = (
    referenceKey: readonly string[],
    differenceKey: readonly string[],
    threshold: number,
): AlignedIndexMap => {
    const map = new Map<number, number>();
    const exact = new Set<number>();
    for (const pair of lcsPairs(referenceKey, differenceKey)) {
        map.set(pair.referenceIndex, pair.differenceIndex);
        exact.add(pair.referenceIndex);
    }

    // Fuzzy-pair the leftovers between anchors so a renamed header or an edited row still lines up.
    let lastReference = -1;
    let lastDifference = -1;
    for (let index = 0; index <= referenceKey.length; index++) {
        const isAnchor = index === referenceKey.length || map.has(index);
        if (!isAnchor) {
            continue;
        }

        const gapEnd = index === referenceKey.length ? differenceKey.length : map.get(index)!;
        const gapReference: number[] = [];
        for (let x = lastReference + 1; x < index; x++) {
            gapReference.push(x);
        }

        const gapDifference: number[] = [];
        for (let y = lastDifference + 1; y < gapEnd; y++) {
            gapDifference.push(y);
        }

        if (gapReference.length > 0 && gapDifference.length > 0) {
            for (const pair of resolveIndexPairs(referenceKey, differenceKey, gapReference, gapDifference, threshold)) {
                map.set(pair.reference, pair.difference);
            }
        }

        lastReference = index;
        lastDifference = gapEnd;
    }

    return { map, exact };
};

interface MergedOrderEntry {
    status: DiffStatus | 'Equal';
    originalIndex: number;
    modifiedIndex: number;
}

const mergedOrder = (
    referenceCount: number,
    differenceCount: number,
    aligned: AlignedIndexMap,
): MergedOrderEntry[] => {
    const order: MergedOrderEntry[] = [];
    let x = 0;
    let y = 0;

    while (x < referenceCount || y < differenceCount) {
        if (x < referenceCount && aligned.map.has(x)) {
            const target = aligned.map.get(x)!;
            if (y < target) {
                order.push({ status: 'Added', originalIndex: -1, modifiedIndex: y });
                y++;
                continue;
            }

            const status: DiffStatus | 'Equal' = aligned.exact.has(x) ? 'Equal' : 'Modified';
            order.push({ status, originalIndex: x, modifiedIndex: target });
            x++;
            y++;
        }
        else if (x < referenceCount) {
            order.push({ status: 'Removed', originalIndex: x, modifiedIndex: -1 });
            x++;
        }
        else {
            order.push({ status: 'Added', originalIndex: -1, modifiedIndex: y });
            y++;
        }
    }

    return order;
};

const getCell = (row: readonly string[] | null, index: number): string => {
    if (index < 0 || row == null || index >= row.length) {
        return '';
    }

    return row[index] ?? '';
};

const tableDiff = (originalSegment: MarkdownSegment, modifiedSegment: MarkdownSegment): TableDiff => {
    const left = parseTable(originalSegment);
    const right = parseTable(modifiedSegment);

    const columnAlignment = alignedIndexMap(left.header, right.header, 0.30);
    const columnOrder = mergedOrder(left.header.length, right.header.length, columnAlignment);

    let inserted = 0;
    let deleted = 0;

    const columns: TableColumnDiff[] = columnOrder.map((column) => {
        const originalText = getCell(left.header, column.originalIndex);
        const modifiedText = getCell(right.header, column.modifiedIndex);
        const status: DiffStatus = column.status === 'Equal' ? 'Unchanged' : column.status;
        const inline = status === 'Modified' ? inlineDiff(originalText, modifiedText, 'Word') : null;

        if (status === 'Added') {
            inserted++;
        }

        if (status === 'Removed') {
            deleted++;
        }

        return {
            status,
            originalIndex: column.originalIndex,
            modifiedIndex: column.modifiedIndex,
            original: originalText,
            modified: modifiedText,
            inline,
        };
    });

    const leftKeys = left.rows.map((row) => row.join(' | '));
    const rightKeys = right.rows.map((row) => row.join(' | '));
    const rowAlignment = alignedIndexMap(leftKeys, rightKeys, 0.40);
    const rowOrder = mergedOrder(left.rows.length, right.rows.length, rowAlignment);

    const rows: TableRowDiff[] = rowOrder.map((row) => {
        const originalRow = row.originalIndex >= 0 ? (left.rows[row.originalIndex] ?? null) : null;
        const modifiedRow = row.modifiedIndex >= 0 ? (right.rows[row.modifiedIndex] ?? null) : null;

        const cells: TableCellDiff[] = columns.map((column) => {
            const originalCell = getCell(originalRow, column.originalIndex);
            const modifiedCell = getCell(modifiedRow, column.modifiedIndex);

            let status: DiffStatus;
            if (row.status === 'Added' || column.status === 'Added') {
                status = 'Added';
            }
            else if (row.status === 'Removed' || column.status === 'Removed') {
                status = 'Removed';
            }
            else if (originalCell === modifiedCell) {
                status = 'Unchanged';
            }
            else {
                status = 'Modified';
            }

            const cellInline = status === 'Modified' ? inlineDiff(originalCell, modifiedCell, 'Word') : null;

            if (status === 'Added') {
                inserted++;
            }
            else if (status === 'Removed') {
                deleted++;
            }
            else if (status === 'Modified' && cellInline != null) {
                for (const run of cellInline) {
                    const words = countWords(run.text);
                    if (run.op === 'Added') {
                        inserted += words;
                    }
                    else if (run.op === 'Removed') {
                        deleted += words;
                    }
                }
            }

            return {
                status,
                column: column.status,
                original: originalCell,
                modified: modifiedCell,
                inline: cellInline,
            };
        });

        const rowHasChange = cells.some((cell) => cell.status !== 'Unchanged');
        let rowStatus: DiffStatus;
        if (row.status === 'Equal') {
            rowStatus = rowHasChange ? 'Modified' : 'Unchanged';
        }
        else {
            rowStatus = row.status;
        }

        return {
            status: rowStatus,
            originalIndex: row.originalIndex,
            modifiedIndex: row.modifiedIndex,
            cells,
        };
    });

    return { columns, rows, inserted, deleted };
};

const buildChangeRecord = (
    status: DiffStatus,
    original: MarkdownSegment | null,
    modified: MarkdownSegment | null,
    similarity: number,
): ChangeRecord => {
    let inline: InlineRun[] | null = null;
    let inlineKind: 'Word' | 'Line' | null = null;
    let diff: TableDiff | null = null;

    // Tables stay atomic (both instances kept) and also carry a row/column/cell alignment.
    if (status === 'Modified' && original != null && modified != null && original.type === 'Table') {
        diff = tableDiff(original, modified);
    }

    if (status === 'Modified' && original != null && modified != null && !original.atomic) {
        inlineKind = original.type === 'Code' ? 'Line' : 'Word';
        const from = inlineKind === 'Line' ? original.raw : original.text;
        const to = inlineKind === 'Line' ? modified.raw : modified.text;
        inline = inlineDiff(from, to, inlineKind);
    }

    const segment = original ?? modified;
    if (segment == null) {
        throw new Error('A change record needs at least one side.');
    }

    return {
        index: -1,
        status,
        type: segment.type,
        path: segment.path,
        atomic: segment.atomic,
        similarity,
        original,
        modified,
        inlineKind,
        inline,
        tableDiff: diff,
    };
};

const compareSegmentList = (
    original: readonly MarkdownSegment[],
    modified: readonly MarkdownSegment[],
    fallbackThreshold: number,
): ChangeRecord[] => {
    const match: number[] = original.map(() => -1);
    const isExact = new Set<number>();

    const originalKeys = original.map((segment) => segment.key);
    const modifiedKeys = modified.map((segment) => segment.key);
    for (const pair of lcsPairs(originalKeys, modifiedKeys)) {
        match[pair.referenceIndex] = pair.differenceIndex;
        isExact.add(pair.referenceIndex);
    }

    // Fuzzy-match whatever the LCS left unmatched, gap by gap between anchors.
    let lastOriginal = -1;
    let lastModified = -1;
    for (let index = 0; index <= original.length; index++) {
        const isAnchor = index === original.length || (match[index] ?? -1) >= 0;
        if (!isAnchor) {
            continue;
        }

        const gapEnd = index === original.length ? modified.length : (match[index] ?? modified.length);
        const gapOriginal: number[] = [];
        for (let x = lastOriginal + 1; x < index; x++) {
            gapOriginal.push(x);
        }

        const gapModified: number[] = [];
        for (let y = lastModified + 1; y < gapEnd; y++) {
            gapModified.push(y);
        }

        if (gapOriginal.length > 0 && gapModified.length > 0) {
            for (const pair of resolveGapPairs(original, modified, gapOriginal, gapModified, fallbackThreshold)) {
                match[pair.original] = pair.modified;
            }
        }

        lastOriginal = index;
        lastModified = gapEnd;
    }

    const changes: ChangeRecord[] = [];
    let x = 0;
    let y = 0;

    while (x < original.length || y < modified.length) {
        if (x < original.length && (match[x] ?? -1) >= 0) {
            const target = match[x] ?? -1;
            if (y < target) {
                changes.push(buildChangeRecord('Added', null, modified[y]!, 0.0));
                y++;
                continue;
            }

            const status: DiffStatus = isExact.has(x) ? 'Unchanged' : 'Modified';
            const similarity = isExact.has(x)
                ? 1.0
                : textSimilarity(original[x]!.compareText, modified[target]!.compareText);

            changes.push(buildChangeRecord(status, original[x]!, modified[target]!, similarity));
            x++;
            y++;
        }
        else if (x < original.length) {
            changes.push(buildChangeRecord('Removed', original[x]!, null, 0.0));
            x++;
        }
        else {
            changes.push(buildChangeRecord('Added', null, modified[y]!, 0.0));
            y++;
        }
    }

    for (let position = 0; position < changes.length; position++) {
        changes[position]!.index = position;
    }

    return changes;
};

const splitLines = (source: string): string[] => source.split(/\r?\n/);

// Compare two markdown documents and return the structured diff the renderer consumes.
export const compareMarkdown = (
    original: string,
    modified: string,
    options: CompareOptions = {},
): MarkdownDiff => {
    const threshold = options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    const includeUnchanged = options.includeUnchanged ?? false;

    const originalLines = splitLines(original);
    const modifiedLines = splitLines(modified);

    const originalSegments = splitMarkdownSegments(originalLines);
    const modifiedSegments = splitMarkdownSegments(modifiedLines);

    const allChanges = compareSegmentList(originalSegments, modifiedSegments, threshold);
    const kept = includeUnchanged ? allChanges : allChanges.filter((change) => change.status !== 'Unchanged');

    const summary = {
        added: allChanges.filter((change) => change.status === 'Added').length,
        removed: allChanges.filter((change) => change.status === 'Removed').length,
        modified: allChanges.filter((change) => change.status === 'Modified').length,
        unchanged: allChanges.filter((change) => change.status === 'Unchanged').length,
        total: allChanges.length,
    };

    return {
        original: {
            path: options.originalName ?? 'original.md',
            segmentCount: originalSegments.length,
            lineCount: originalLines.length,
        },
        modified: {
            path: options.modifiedName ?? 'modified.md',
            segmentCount: modifiedSegments.length,
            lineCount: modifiedLines.length,
        },
        summary,
        changes: kept,
    };
};
