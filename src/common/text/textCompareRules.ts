import { diffArrays } from 'diff';
import { errorMessage } from '../errorMessage.js';

// How whitespace differences count: not ignored, at line ends only, changes in amount, or all of it.
export type WhitespaceRule = 'none' | 'trailing' | 'amount' | 'all';

export interface TextCompareRules {
    readonly whitespace: WhitespaceRule;
    readonly ignoreCase: boolean;
    readonly ignoreBlankLines: boolean;
    readonly normalizeLineEndings: boolean;
    readonly ignorePatterns: ReadonlyArray<string>;
    readonly sortLines: boolean;
    readonly uniqueLines: boolean;
    readonly trimLines: boolean;
}

export const DEFAULT_TEXT_COMPARE_RULES: TextCompareRules = Object.freeze({
    whitespace: 'none',
    ignoreCase: false,
    ignoreBlankLines: false,
    normalizeLineEndings: true,
    ignorePatterns: Object.freeze([]) as ReadonlyArray<string>,
    sortLines: false,
    uniqueLines: false,
    trimLines: false,
});

// Lines left out of the comparison show as ignored on their own side.
export type RuledDiffMarker = 'add' | 'del' | 'same' | 'ignored';

export interface RuledDiffLine {
    readonly marker: RuledDiffMarker;
    readonly originalLineNumber: number | null;
    readonly modifiedLineNumber: number | null;
    // The real line on each side, never the normalized comparison key.
    readonly originalText: string | null;
    readonly modifiedText: string | null;
}

export interface RuledDiffResult {
    readonly lines: ReadonlyArray<RuledDiffLine>;
    readonly addCount: number;
    readonly delCount: number;
    readonly ignoredCount: number;
}

interface SideLine {
    readonly number: number;
    readonly text: string;
    readonly key: string;
    readonly included: boolean;
}

// Number of rules that differ from the defaults; unique lines counts only while sorting is on, as it does nothing without it.
export function countActiveRules(rules: TextCompareRules): number {
    let count = rules.whitespace === DEFAULT_TEXT_COMPARE_RULES.whitespace ? 0 : 1;

    for (const key of ['ignoreCase', 'ignoreBlankLines', 'normalizeLineEndings', 'sortLines', 'trimLines'] as const) {
        if (rules[key] !== DEFAULT_TEXT_COMPARE_RULES[key]) {
            count += 1;
        }
    }

    if (rules.sortLines && rules.uniqueLines) {
        count += 1;
    }

    return count + rules.ignorePatterns.length;
}

// Error message for a pattern that is not a valid regular expression, or null when it is.
export function validateIgnorePattern(pattern: string): string | null {
    if (pattern === '') {
        return 'Enter a pattern.';
    }

    try {
        new RegExp(pattern);

        return null;
    }
    catch (error) {
        return errorMessage(error, 'Not a valid regular expression.');
    }
}

// Splits text into lines; the line break after the last line does not add an empty line.
export function splitTextLines(text: string, normalizeLineEndings: boolean): string[] {
    if (text === '') {
        return [];
    }

    const lines = text.split(normalizeLineEndings ? /\r\n|\r|\n/ : '\n');

    if (lines[lines.length - 1] === '') {
        lines.pop();
    }

    return lines;
}

// The text a line is compared by once the whitespace, trim and case rules apply.
export function comparisonKey(line: string, rules: TextCompareRules): string {
    let key = rules.trimLines ? line.trim() : line;

    if (rules.whitespace === 'trailing') {
        key = key.trimEnd();
    }
    else if (rules.whitespace === 'amount') {
        key = key.replace(/\s+/g, ' ').trimEnd();
    }
    else if (rules.whitespace === 'all') {
        key = key.replace(/\s+/g, '');
    }

    return rules.ignoreCase ? key.toLowerCase() : key;
}

export function compareTextWithRules(original: string, modified: string, rules: TextCompareRules): RuledDiffResult {
    const patterns = compilePatterns(rules.ignorePatterns);
    const left = orderSide(prepareSide(original, rules, patterns), rules);
    const right = orderSide(prepareSide(modified, rules, patterns), rules);
    const leftPositions = includedPositions(left);
    const rightPositions = includedPositions(right);
    const changes = diffArrays(
        leftPositions.map((position) => left[position]!.key),
        rightPositions.map((position) => right[position]!.key),
    );
    const lines: RuledDiffLine[] = [];
    const cursor = { left: 0, right: 0, leftIncluded: 0, rightIncluded: 0 };
    let addCount = 0;
    let delCount = 0;

    // Emits the ignored lines of one side that come before its next compared line.
    const flush = (side: 'left' | 'right', upTo: number): void => {
        const source = side === 'left' ? left : right;

        while (cursor[side] < upTo) {
            const line = source[cursor[side]]!;
            lines.push(side === 'left' ? originalOnly('ignored', line) : modifiedOnly('ignored', line));
            cursor[side] += 1;
        }
    };
    const nextLeft = (): SideLine => {
        const position = leftPositions[cursor.leftIncluded]!;
        flush('left', position);
        cursor.left = position + 1;
        cursor.leftIncluded += 1;

        return left[position]!;
    };
    const nextRight = (): SideLine => {
        const position = rightPositions[cursor.rightIncluded]!;
        flush('right', position);
        cursor.right = position + 1;
        cursor.rightIncluded += 1;

        return right[position]!;
    };

    for (const change of changes) {
        for (let index = 0; index < change.count; index += 1) {
            if (change.removed) {
                lines.push(originalOnly('del', nextLeft()));
                delCount += 1;
            }
            else if (change.added) {
                lines.push(modifiedOnly('add', nextRight()));
                addCount += 1;
            }
            else {
                const leftLine = nextLeft();
                const rightLine = nextRight();
                lines.push({
                    marker: 'same',
                    originalLineNumber: leftLine.number,
                    modifiedLineNumber: rightLine.number,
                    originalText: leftLine.text,
                    modifiedText: rightLine.text,
                });
            }
        }
    }

    flush('left', left.length);
    flush('right', right.length);

    return {
        lines,
        addCount,
        delCount,
        ignoredCount: lines.filter((line) => line.marker === 'ignored').length,
    };
}

function includedPositions(lines: ReadonlyArray<SideLine>): number[] {
    const positions: number[] = [];

    lines.forEach((line, position) => {
        if (line.included) {
            positions.push(position);
        }
    });

    return positions;
}

function compilePatterns(patterns: ReadonlyArray<string>): RegExp[] {
    return patterns
        .filter((pattern) => validateIgnorePattern(pattern) == null)
        .map((pattern) => new RegExp(pattern));
}

function prepareSide(text: string, rules: TextCompareRules, patterns: ReadonlyArray<RegExp>): SideLine[] {
    return splitTextLines(text, rules.normalizeLineEndings).map((raw, index) => {
        const display = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        const blank = rules.ignoreBlankLines && raw.trim() === '';
        const matched = patterns.some((pattern) => pattern.test(display));

        return {
            number: index + 1,
            text: display,
            key: comparisonKey(raw, rules),
            included: !blank && !matched,
        };
    });
}

// Sorted comparison lists compared lines by key; ignored and repeated lines follow in file order.
function orderSide(lines: SideLine[], rules: TextCompareRules): SideLine[] {
    if (!rules.sortLines) {
        return lines;
    }

    const seen = new Set<string>();
    const kept: SideLine[] = [];
    const rest: SideLine[] = [];

    for (const line of lines) {
        if (!line.included || (rules.uniqueLines && seen.has(line.key))) {
            rest.push(line.included ? { ...line, included: false } : line);

            continue;
        }

        seen.add(line.key);
        kept.push(line);
    }

    kept.sort((left, right) => compareKeys(left.key, right.key) || left.number - right.number);

    return [...kept, ...rest];
}

function compareKeys(left: string, right: string): number {
    if (left === right) {
        return 0;
    }

    return left < right ? -1 : 1;
}

function originalOnly(marker: RuledDiffMarker, line: SideLine): RuledDiffLine {
    return {
        marker,
        originalLineNumber: line.number,
        modifiedLineNumber: null,
        originalText: line.text,
        modifiedText: null,
    };
}

function modifiedOnly(marker: RuledDiffMarker, line: SideLine): RuledDiffLine {
    return {
        marker,
        originalLineNumber: null,
        modifiedLineNumber: line.number,
        originalText: null,
        modifiedText: line.text,
    };
}
