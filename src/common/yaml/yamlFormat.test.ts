import { describe, expect, it } from 'vitest';
import { formatYaml } from './yamlFormat.js';

function formatted(text: string): string {
    const result = formatYaml(text);

    if (!result.ok) {
        throw new Error(`${result.message} (line ${result.line}, column ${result.column})`);
    }

    return result.text;
}

describe('formatYaml', () => {
    it('indents with 2 spaces and keeps every comment', () => {
        const text = [
            '# Service settings',
            'server:',
            '    host:   localhost   # where it listens',
            '    ports:',
            '    -   80',
            '    -  443',
            '    # more to come',
            '',
        ].join('\n');

        expect(formatted(text)).toBe([
            '# Service settings',
            'server:',
            '  host: localhost # where it listens',
            '  ports:',
            '    - 80',
            '    - 443',
            '    # more to come',
            '',
        ].join('\n'));
    });

    it('keeps every document with its markers', () => {
        expect(formatted('# first\na:    1\n---\n# second\n- x\n-    y\n...\n---\nc: 3\n')).toBe(
            '# first\na: 1\n---\n# second\n- x\n- y\n...\n---\nc: 3\n',
        );
    });

    it('keeps anchors, aliases and merge keys as written', () => {
        const text = 'defaults: &defaults\n    retries: 3\njob:\n    <<: *defaults\n    copy: *defaults\n';

        expect(formatted(text)).toBe('defaults: &defaults\n  retries: 3\njob:\n  <<: *defaults\n  copy: *defaults\n');
    });

    it('keeps numbers, quotes and tags as written', () => {
        const text = 'hex: 0x1F\nexp: 1e3\nfraction: 1.50\ninf: .Inf\nsingle: \'s\'\ndouble: "d"\nday: !!timestamp 2001-12-14\n';

        expect(formatted(text)).toBe(text);
    });

    it('keeps folded text broken where it was, and literal blocks as they are', () => {
        const text = 'about:\n    summary: >-\n        first line\n        second line\n\n        new paragraph\n    script: |\n        echo one\n          echo two\n';

        expect(formatted(text)).toBe(
            'about:\n  summary: >-\n    first line\n    second line\n\n    new paragraph\n  script: |\n    echo one\n      echo two\n',
        );
    });

    it('gives the same text when run again', () => {
        const once = formatted('a:\n      b: [1,2]\n      c: {d: 1}\n# end\n');

        expect(formatted(once)).toBe(once);
    });

    it('formats despite a repeated key, which is only a warning', () => {
        expect(formatted('a:   1\na:   2\n')).toBe('a: 1\na: 2\n');
    });

    it('leaves a text of comments alone', () => {
        expect(formatted('# nothing here yet\n')).toBe('# nothing here yet\n');
    });

    it('refuses invalid YAML with the line and column of the error', () => {
        expect(formatYaml('a: 1\n  b: 2\n')).toEqual({
            ok: false,
            message: 'Nested mappings are not allowed in compact mappings',
            line: 1,
            column: 4,
        });
    });

    it('refuses an alias with no anchor before it', () => {
        expect(formatYaml('a: 1\nb: *missing\n')).toEqual({
            ok: false,
            message: 'No anchor &missing comes before this alias',
            line: 2,
            column: 4,
        });
    });
});
