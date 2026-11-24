import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXT_COMPARE_RULES, type TextCompareRules } from '../text/textCompareRules.js';
import type { DiffDocumentSide, DiffRow } from './diffDocument.js';
import { buildTextDiffDocument } from './textDiffDocument.js';

const ORIGINAL: DiffDocumentSide = { name: 'a.txt', source: 'file', path: 'a.txt' };
const MODIFIED: DiffDocumentSide = { name: 'Pasted text', source: 'pasted' };

function build(originalText: string, modifiedText: string, rules?: Partial<TextCompareRules>): ReturnType<typeof buildTextDiffDocument> {
    return buildTextDiffDocument({
        original: ORIGINAL,
        modified: MODIFIED,
        originalText,
        modifiedText,
        rules: rules == null ? undefined : { ...DEFAULT_TEXT_COMPARE_RULES, ...rules },
    });
}

function describeRows(rows: ReadonlyArray<DiffRow>): string[] {
    const side = (cell: DiffRow['left']): string => cell == null ? '·' : `${cell.line}${cell.status === 'unchanged' ? '' : `:${cell.status}`} ${cell.tokens[0]?.text}`;

    return rows.map((row) => `${side(row.left)} | ${side(row.right)}${row.change == null ? '' : ` <${row.change}>`}`);
}

describe('buildTextDiffDocument', () => {
    it('aligns both sides line for line, pairing removed lines beside added ones with placeholders', () => {
        const document = build('keep\nold one\nold two\nend\n', 'keep\nnew one\nend\nextra\n');

        expect(describeRows(document.rows)).toEqual([
            '1 keep | 1 keep',
            '2:removed old one | 2:added new one <0>',
            '3:removed old two | · <0>',
            '4 end | 3 end',
            '· | 4:added extra <1>',
        ]);
    });

    it('lists each change with its kind, lines, text and first row, and sums them up', () => {
        const document = build('keep\nold one\nold two\nend\n', 'keep\nnew one\nend\nextra\n');

        expect(document.changes).toEqual([
            {
                id: '0',
                kind: 'changed',
                location: { lines: { original: { from: 2, to: 3 }, modified: { from: 2, to: 2 } } },
                row: 1,
                before: 'old one\nold two',
                after: 'new one',
            },
            {
                id: '1',
                kind: 'added',
                location: { lines: { original: null, modified: { from: 4, to: 4 } } },
                row: 4,
                after: 'extra',
            },
        ]);
        expect(document.summary).toEqual({ total: 2, added: 1, removed: 0, changed: 1, typeChanged: 0, lines: { added: 2, removed: 2, ignored: 0 } });
    });

    it('calls a change with lines on one side only an addition or a removal', () => {
        expect(build('a\n', 'a\nb\n').changes.map((change) => change.kind)).toEqual(['added']);
        expect(build('a\nb\n', 'a\n').changes.map((change) => change.kind)).toEqual(['removed']);
    });

    it('keeps lines the rules ignored as ignored rows that are no change of their own', () => {
        const document = build('a\n\nb\n', 'a\nb\n', { ignoreBlankLines: true });

        expect(document.changes).toEqual([]);
        expect(describeRows(document.rows)).toEqual(['1 a | 1 a', '2:ignored  | ·', '3 b | 2 b']);
        expect(document.summary.lines).toEqual({ added: 0, removed: 0, ignored: 1 });
    });

    it('greys the lines an ignore pattern leaves out on both sides', () => {
        const document = build('id: 1\n# 2024\n', 'id: 1\n# 2026\n', { ignorePatterns: ['^#'] });

        expect(document.changes).toEqual([]);
        expect(document.rows.flatMap((row) => [row.left, row.right]).filter((cell) => cell?.status === 'ignored').map((cell) => cell?.tokens[0]?.text))
            .toEqual(['# 2024', '# 2026']);
    });

    it('shows the real lines, not the normalized ones the rules compare', () => {
        const document = build('Value  \n', 'value\n', { ignoreCase: true, whitespace: 'trailing' });

        expect(document.changes).toEqual([]);
        expect(describeRows(document.rows)).toEqual(['1 Value   | 1 value']);
    });

    it('records the rules it compared with', () => {
        const document = build('a\n', 'b\n', { ignoreCase: true, ignorePatterns: ['^#'] });

        expect(document.options).toEqual({ ...DEFAULT_TEXT_COMPARE_RULES, ignoreCase: true, ignorePatterns: ['^#'] });
        expect(document).toMatchObject({ format: 'nib-studio-diff', version: 1, kind: 'text', original: ORIGINAL, modified: MODIFIED });
    });

    it('builds the same JSON for the same inputs', () => {
        expect(JSON.stringify(build('a\nb\n', 'a\nc\n'))).toBe(JSON.stringify(build('a\nb\n', 'a\nc\n')));
    });
});
