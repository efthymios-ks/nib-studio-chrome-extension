import { describe, expect, it } from 'vitest';
import {
    DEFAULT_TEXT_COMPARE_RULES,
    compareTextWithRules,
    comparisonKey,
    countActiveRules,
    splitTextLines,
    validateIgnorePattern,
    type TextCompareRules,
} from './textCompareRules.js';

function rules(overrides: Partial<TextCompareRules> = {}): TextCompareRules {
    return { ...DEFAULT_TEXT_COMPARE_RULES, ...overrides };
}

function counts(original: string, modified: string, overrides: Partial<TextCompareRules> = {}): [number, number] {
    const result = compareTextWithRules(original, modified, rules(overrides));

    return [result.addCount, result.delCount];
}

describe('compareTextWithRules', () => {
    it('reports a changed line with the default rules', () => {
        expect(counts('one\ntwo\nthree\n', 'one\n2\nthree\n')).toEqual([1, 1]);
    });

    it('treats identical text as unchanged', () => {
        const result = compareTextWithRules('a\nb\n', 'a\nb\n', rules());

        expect(result.lines.every((line) => line.marker === 'same')).toBe(true);
        expect(result.lines.map((line) => line.modifiedLineNumber)).toEqual([1, 2]);
    });

    it('ignores trailing whitespace only with the trailing rule', () => {
        expect(counts('value  \n', 'value\n', { whitespace: 'trailing' })).toEqual([0, 0]);
        expect(counts('  value\n', 'value\n', { whitespace: 'trailing' })).toEqual([1, 1]);
    });

    it('ignores changes in the amount of whitespace', () => {
        expect(counts('a  b\tc\n', 'a b c \n', { whitespace: 'amount' })).toEqual([0, 0]);
        expect(counts('ab\n', 'a b\n', { whitespace: 'amount' })).toEqual([1, 1]);
    });

    it('ignores all whitespace', () => {
        expect(counts('ab\n', ' a b\n', { whitespace: 'all' })).toEqual([0, 0]);
    });

    it('ignores case', () => {
        expect(counts('Hello\n', 'hello\n')).toEqual([1, 1]);
        expect(counts('Hello\n', 'hello\n', { ignoreCase: true })).toEqual([0, 0]);
    });

    it('ignores blank lines and lists them as ignored', () => {
        const result = compareTextWithRules('a\n\nb\n', 'a\nb\n   \n', rules({ ignoreBlankLines: true }));

        expect([result.addCount, result.delCount]).toEqual([0, 0]);
        expect(result.ignoredCount).toBe(2);
    });

    it('normalizes line endings by default and can keep them', () => {
        expect(counts('a\r\nb\r\n', 'a\nb\n')).toEqual([0, 0]);
        expect(counts('a\r\nb\r\n', 'a\nb\n', { normalizeLineEndings: false })).toEqual([2, 2]);
    });

    it('skips lines matching an ignore pattern', () => {
        const original = 'id: 1\n// generated 2024\nname: a\n';
        const modified = 'id: 1\n// generated 2026\nname: a\n';

        expect(counts(original, modified)).toEqual([1, 1]);
        expect(counts(original, modified, { ignorePatterns: ['^// generated'] })).toEqual([0, 0]);
    });

    it('drops invalid patterns instead of failing', () => {
        expect(counts('a\n', 'b\n', { ignorePatterns: ['('] })).toEqual([1, 1]);
    });

    it('sorts lines so reordered lines are not reported', () => {
        expect(counts('b\na\nc\n', 'c\nb\na\n')).not.toEqual([0, 0]);
        expect(counts('b\na\nc\n', 'c\nb\na\n', { sortLines: true })).toEqual([0, 0]);
    });

    it('counts repeated lines unless unique lines only is on', () => {
        expect(counts('a\nb\n', 'a\na\nb\n', { sortLines: true })).toEqual([1, 0]);
        expect(counts('a\nb\n', 'a\na\nb\n', { sortLines: true, uniqueLines: true })).toEqual([0, 0]);
    });

    it('trims each line', () => {
        expect(counts('  a  \n', 'a\n', { trimLines: true })).toEqual([0, 0]);
    });

    it('keeps the real lines on each side', () => {
        const result = compareTextWithRules('Value  \n', 'value\n', rules({ ignoreCase: true, whitespace: 'trailing' }));

        expect(result.lines).toEqual([{
            marker: 'same',
            originalLineNumber: 1,
            modifiedLineNumber: 1,
            originalText: 'Value  ',
            modifiedText: 'value',
        }]);
    });

    it('places ignored lines next to their neighbours', () => {
        const result = compareTextWithRules('a\n# x\nb\n', 'a\nb\n', rules({ ignorePatterns: ['^#'] }));

        expect(result.lines.map((line) => line.marker)).toEqual(['same', 'ignored', 'same']);
    });
});

describe('textCompareRules helpers', () => {
    it('splits lines without a trailing empty line', () => {
        expect(splitTextLines('a\r\nb\n', true)).toEqual(['a', 'b']);
        expect(splitTextLines('a\r\nb', false)).toEqual(['a\r', 'b']);
        expect(splitTextLines('', true)).toEqual([]);
    });

    it('builds comparison keys', () => {
        expect(comparisonKey('  A  b ', rules({ trimLines: true, ignoreCase: true }))).toBe('a  b');
    });

    it('validates patterns', () => {
        expect(validateIgnorePattern('^a+$')).toBeNull();
        expect(validateIgnorePattern('(')).not.toBeNull();
        expect(validateIgnorePattern('')).not.toBeNull();
    });

    it('counts rules that differ from the defaults', () => {
        expect(countActiveRules(rules())).toBe(0);
        expect(countActiveRules(rules({ whitespace: 'all', normalizeLineEndings: false, ignorePatterns: ['x', 'y'] }))).toBe(4);
    });

    it('counts unique lines only while sorting is on, as it does nothing without it', () => {
        expect(countActiveRules(rules({ sortLines: true, uniqueLines: true }))).toBe(2);
        expect(countActiveRules(rules({ sortLines: false, uniqueLines: true }))).toBe(0);
    });
});
