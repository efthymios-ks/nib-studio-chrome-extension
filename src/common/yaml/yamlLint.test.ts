import { describe, expect, it } from 'vitest';
import { lintYaml } from './yamlLint.js';
import { parseYamlStream } from './yamlParser.js';

function summary(text: string): string[] {
    return lintYaml(text).map((issue) => `${issue.severity} ${issue.line}:${issue.column} ${issue.message}`);
}

describe('lintYaml', () => {
    it('finds nothing in valid YAML', () => {
        expect(lintYaml('name: demo\nitems:\n  - 1\n  - 2\n')).toEqual([]);
    });

    it('marks a syntax error with its offsets, line and column', () => {
        const issues = lintYaml('a: 1\nb: [1, 2\nc: 3\n');

        expect(issues).toEqual([{
            severity: 'error',
            message: 'Flow sequence in block collection must be sufficiently indented and end with a ]',
            from: 14,
            to: 15,
            line: 3,
            column: 1,
        }]);
    });

    it('marks a tab used as indentation', () => {
        expect(summary('a:\n\tb: 1\n')).toEqual(['error 2:1 Tabs are not allowed as indentation']);
    });

    it('reports a repeated key as a warning, not an error', () => {
        expect(summary('a: 1\nb: 2\na: 3\n')).toEqual(['warning 3:1 The key a is repeated; the last value wins']);
    });

    it('reports an unknown tag as a warning', () => {
        expect(summary('bucket: !Ref Bucket\n')).toEqual(['warning 1:9 Unresolved tag: !Ref']);
    });

    it('marks an alias with no anchor before it', () => {
        expect(summary('first: *later\nsecond: &later 1\n')).toEqual(['error 1:8 No anchor &later comes before this alias']);
    });

    it('marks aliases that expand too far at the first alias', () => {
        const levels = ['a: &a [x, x, x, x, x, x, x, x, x, x]'];

        for (const [name, previous] of [['b', 'a'], ['c', 'b'], ['d', 'c'], ['e', 'd']]) {
            levels.push(`${name}: &${name} [${Array.from({ length: 10 }, () => `*${previous}`).join(', ')}]`);
        }

        expect(summary(`${levels.join('\n')}\n`)).toEqual([
            'error 2:8 Too many aliases: they expand an anchor to more than 1,000 copies',
        ]);
    });

    it('counts lines from the start of the text in every document', () => {
        expect(summary('a: 1\n---\nb: [\n')).toEqual([
            'error 4:1 Flow sequence in block collection must be sufficiently indented and end with a ]',
        ]);
    });
});

describe('parseYamlStream', () => {
    it('reads every document and sorts the issues of all of them by position', () => {
        const stream = parseYamlStream('x: 1\nx: 2\n---\ny: !Custom 3\n');

        expect(stream.documents).toHaveLength(2);
        expect(stream.issues.map((issue) => [issue.severity, issue.line])).toEqual([['warning', 2], ['warning', 4]]);
    });
});
