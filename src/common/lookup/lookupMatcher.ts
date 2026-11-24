import { createLookupQuery, type LookupQuery } from './lookupQuery.js';

// Matches a query against file names and contents. The rules are tried in order and the first that matches a file
// wins; a higher tier ranks higher, then an earlier match, then a shorter name.

export const MAX_RESULTS = 500;
export const MAX_RANGES = 50;
// Scattered letters ("mnm" in "MyName") may spread over this many characters for each letter typed.
const SCATTERED_SPAN_FACTOR = 3;

export interface TextRange {
    readonly start: number;
    readonly end: number;
}

export type MatchTarget = 'name' | 'content';

// A file as Lookup searches it: its name, and its flat text when it has been read.
export interface LookupCandidate {
    readonly path: string;
    readonly name: string;
    // The folder the file is in, from the workspace root, such as `docs/guides`; '' at the root.
    readonly folder: string;
    readonly text: string | null;
    readonly lineStarts: Int32Array | null;
}

export interface LookupMatch {
    readonly candidate: LookupCandidate;
    // Null when an empty query lists every file.
    readonly target: MatchTarget | null;
    readonly tier: number;
    // Where the first range starts.
    readonly position: number;
    readonly ranges: ReadonlyArray<TextRange>;
}

export interface MatchList {
    // The best matches, at most MAX_RESULTS of them.
    readonly matches: ReadonlyArray<LookupMatch>;
    // How many files matched in all.
    readonly total: number;
}

interface Matcher {
    readonly target: MatchTarget;
    readonly tier: number;
    readonly find: (text: string, query: LookupQuery) => TextRange[] | null;
}

const MATCHERS: ReadonlyArray<Matcher> = [
    { target: 'name', tier: 5, find: (text, query) => regexRanges(query.phrase, text) },
    { target: 'name', tier: 4, find: (text, query) => wordRanges(query, text) },
    { target: 'content', tier: 3, find: (text, query) => regexRanges(query.phrase, text) },
    { target: 'name', tier: 2, find: (text, query) => scatteredRanges(query, text) },
    { target: 'content', tier: 1, find: (text, query) => wordRanges(query, text) },
];

const NAME_ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function findMatches(candidates: Iterable<LookupCandidate>, queryText: string): MatchList {
    const query = createLookupQuery(queryText);

    if (query == null) {
        return listAll(candidates);
    }

    const matches: LookupMatch[] = [];

    for (const candidate of candidates) {
        const match = matchCandidate(candidate, query);

        if (match != null) {
            matches.push(match);
        }
    }

    matches.sort(compareMatches);

    return { matches: matches.slice(0, MAX_RESULTS), total: matches.length };
}

function matchCandidate(candidate: LookupCandidate, query: LookupQuery): LookupMatch | null {
    for (const matcher of MATCHERS) {
        const text = matcher.target === 'name' ? candidate.name : candidate.text;

        if (text == null || text === '') {
            continue;
        }

        const ranges = matcher.find(text, query);
        const first = ranges?.[0];

        if (ranges != null && first != null) {
            return { candidate, target: matcher.target, tier: matcher.tier, position: first.start, ranges };
        }
    }

    return null;
}

function compareMatches(left: LookupMatch, right: LookupMatch): number {
    return right.tier - left.tier
        || left.position - right.position
        || left.candidate.name.length - right.candidate.name.length
        || NAME_ORDER.compare(left.candidate.name, right.candidate.name)
        || NAME_ORDER.compare(left.candidate.path, right.candidate.path);
}

// Every file, by folder and then by name, for an empty query.
function listAll(candidates: Iterable<LookupCandidate>): MatchList {
    const all = [...candidates].sort((left, right) => (
        NAME_ORDER.compare(left.folder, right.folder) || NAME_ORDER.compare(left.name, right.name)
    ));

    return {
        matches: all
            .slice(0, MAX_RESULTS)
            .map((candidate) => ({ candidate, target: null, tier: 0, position: 0, ranges: [] })),
        total: all.length,
    };
}

// Every match of the expression from `from` on, at most MAX_RANGES of them; null when there is none.
function regexRanges(regex: RegExp, text: string, from = 0): TextRange[] | null {
    const ranges: TextRange[] = [];
    regex.lastIndex = from;

    for (let match = regex.exec(text); match != null && ranges.length < MAX_RANGES; match = regex.exec(text)) {
        ranges.push({ start: match.index, end: match.index + match[0].length });

        if (match[0] === '') {
            regex.lastIndex += 1;
        }
    }

    return ranges.length === 0 ? null : ranges;
}

// Every word of the query, in any order; null when one of them is missing or the query has a single word.
function wordRanges(query: LookupQuery, text: string): TextRange[] | null {
    if (query.words.length < 2) {
        return null;
    }

    const all: TextRange[] = [];

    for (const word of query.words) {
        const ranges = regexRanges(word, text);

        if (ranges == null) {
            return null;
        }

        all.push(...ranges);
    }

    return all
        .sort((left, right) => left.start - right.start || left.end - right.end)
        .slice(0, MAX_RANGES);
}

// The typed letters in order and close together: from each place the first letter appears, the nearest letters after it,
// until they span at most SCATTERED_SPAN_FACTOR characters for each letter typed.
function scatteredRanges(query: LookupQuery, text: string): TextRange[] | null {
    const regex = query.scattered;

    if (regex == null) {
        return null;
    }

    const maxSpan = query.letterCount * SCATTERED_SPAN_FACTOR;
    regex.lastIndex = 0;

    for (let match = regex.exec(text); match != null; match = regex.exec(text)) {
        const groups = (match.indices ?? []).slice(1);
        const first = groups[0];
        const last = groups.at(-1);

        if (first != null && last != null && last[1] - first[0] <= maxSpan) {
            return groups.flatMap((group) => (group == null ? [] : [{ start: group[0], end: group[1] }]));
        }

        regex.lastIndex = match.index + 1;
    }

    return null;
}

// The first match of a query in a file's text as an editor holds it, from the start of `line` on when it is known,
// so the match Lookup showed is the one selected: the phrase, else the earliest of the words when all of them are there.
export function firstMatchRange(text: string, queryText: string, line: number | null): TextRange | null {
    const query = createLookupQuery(queryText);

    if (query == null) {
        return null;
    }

    const from = line == null ? 0 : offsetOfLine(text, line);

    return firstFrom(text, query, from) ?? (from > 0 ? firstFrom(text, query, 0) : null);
}

function firstFrom(text: string, query: LookupQuery, from: number): TextRange | null {
    const phrase = regexRanges(query.phrase, text, from)?.[0];

    if (phrase != null) {
        return phrase;
    }

    let earliest: TextRange | null = null;

    for (const word of query.words) {
        const first = regexRanges(word, text, from)?.[0];

        if (first == null) {
            return null;
        }

        earliest = earliest == null || first.start < earliest.start ? first : earliest;
    }

    return earliest;
}

// Where a line, counting from 1, starts in text with `\n` line breaks; the end of the text when it has fewer lines.
function offsetOfLine(text: string, line: number): number {
    let offset = 0;

    for (let current = 1; current < line; current += 1) {
        const lineBreak = text.indexOf('\n', offset);

        if (lineBreak < 0) {
            return text.length;
        }

        offset = lineBreak + 1;
    }

    return offset;
}
