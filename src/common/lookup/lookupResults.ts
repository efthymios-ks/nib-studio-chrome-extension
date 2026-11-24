import { findMatches, type LookupCandidate, type LookupMatch, type MatchTarget, type TextRange } from './lookupMatcher.js';
import { lineAt } from './lookupText.js';

// What the Lookup list and preview show of each match. A name match highlights the name and has no preview;
// a content match shows the flat text around its first match, with every match in view highlighted.

// Characters shown before the first match, cut back to the start of a word.
export const SNIPPET_LEAD_CHARS = 20;
// Characters of text a preview holds.
export const SNIPPET_LENGTH = 400;
// Characters of the first match kept to hand to a viewer's Find box.
const MATCH_TEXT_LENGTH = 200;

export interface LookupPreview {
    readonly text: string;
    // The matches within `text`.
    readonly ranges: ReadonlyArray<TextRange>;
    // Whether text comes before or after the part shown.
    readonly hasLead: boolean;
    readonly hasTail: boolean;
    // The line the first match is on, counting from 1, for a text file; null for a document.
    readonly line: number | null;
    // The first match as the text has it, such as "Anna Smith" for the query "anna smith".
    readonly matchText: string;
}

export interface LookupResult {
    readonly path: string;
    readonly name: string;
    readonly folder: string;
    // Null when an empty query lists every file.
    readonly target: MatchTarget | null;
    readonly tier: number;
    // The matches in the name, for a name match.
    readonly nameRanges: ReadonlyArray<TextRange>;
    // The text around the matches, for a content match.
    readonly preview: LookupPreview | null;
}

export interface LookupResults {
    readonly query: string;
    readonly results: ReadonlyArray<LookupResult>;
    // How many files matched in all, beyond the ones listed too.
    readonly total: number;
}

export function lookUp(candidates: Iterable<LookupCandidate>, query: string): LookupResults {
    const list = findMatches(candidates, query);

    return { query, results: list.matches.map(toResult), total: list.total };
}

function toResult(match: LookupMatch): LookupResult {
    const { candidate } = match;

    return {
        path: candidate.path,
        name: candidate.name,
        folder: candidate.folder,
        target: match.target,
        tier: match.tier,
        nameRanges: match.target === 'name' ? match.ranges : [],
        preview: match.target === 'content' ? previewOf(match) : null,
    };
}

function previewOf(match: LookupMatch): LookupPreview | null {
    const text = match.candidate.text;
    const first = match.ranges[0];

    if (text == null || first == null) {
        return null;
    }

    let start = Math.max(0, first.start - SNIPPET_LEAD_CHARS);

    if (start > 0) {
        const space = text.indexOf(' ', start);

        if (space >= 0 && space < first.start) {
            start = space + 1;
        }
    }

    const end = Math.min(text.length, start + SNIPPET_LENGTH);
    const ranges = match.ranges
        .filter((range) => range.end > start && range.start < end)
        .map((range) => ({ start: Math.max(range.start, start) - start, end: Math.min(range.end, end) - start }));
    const lineStarts = match.candidate.lineStarts;

    return {
        text: text.slice(start, end),
        ranges,
        hasLead: start > 0,
        hasTail: end < text.length,
        line: lineStarts == null ? null : lineAt(lineStarts, first.start),
        matchText: text.slice(first.start, Math.min(first.end, first.start + MATCH_TEXT_LENGTH)),
    };
}
