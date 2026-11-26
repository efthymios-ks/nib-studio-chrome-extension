import { describe, expect, it } from 'vitest';
import { LinqError } from './linqErrors.js';
import { tokenize } from './linqTokenizer.js';

describe('tokenize', () => {
    it('splits identifiers, numbers, strings and punctuation', () => {
        const tokens = tokenize('from o in table where o.total >= 1.5e2 && o.city == "Patras"');

        expect(tokens.map((token) => token.kind)).toEqual([
            'identifier', 'identifier', 'identifier', 'identifier', 'identifier', 'identifier', 'punct', 'identifier',
            'punct', 'number', 'punct', 'identifier', 'punct', 'identifier', 'punct', 'string', 'eof',
        ]);
        expect(tokens.find((token) => token.kind === 'number')?.number).toBe(150);
        expect(tokens.find((token) => token.kind === 'string')?.text).toBe('Patras');
    });

    it('prefers the longest operator', () => {
        expect(tokenize('a ?? b <= c != d').filter((token) => token.kind === 'punct').map((token) => token.text)).toEqual(['??', '<=', '!=']);
    });

    it('reads <> as !=', () => {
        expect(tokenize('a <> b')[1]?.text).toBe('!=');
    });

    it('decodes escapes in both quote styles', () => {
        expect(tokenize('"a\\"b" \'it\\\'s\'').slice(0, 2).map((token) => token.text)).toEqual(['a"b', 'it\'s']);
    });

    it('reads a bracketed sheet name after from, and after from row in', () => {
        expect(tokenize('from [North Region]')[1]).toMatchObject({ kind: 'identifier', text: 'North Region', quoted: true, start: 5, end: 19 });
        expect(tokenize('FROM r IN [Q 1]')[3]).toMatchObject({ kind: 'identifier', text: 'Q 1', quoted: true });
    });

    it('keeps brackets anywhere else as punctuation', () => {
        expect(tokenize('row["a"]').map((token) => token.text)).toEqual(['row', '[', 'a', ']', '']);
        expect(tokenize('from * where a in [1]').filter((token) => token.kind === 'punct').map((token) => token.text)).toEqual(['*', '[', ']']);
    });

    it('rejects a bracketed sheet name that is never closed, or is empty', () => {
        expect(() => tokenize('from [North\nwhere')).toThrow('This [sheet name] is never closed with a bracket.');
        expect(() => tokenize('from [North')).toThrow('This [sheet name] is never closed with a bracket.');
        expect(() => tokenize('from [ ]')).toThrow('A [sheet name] cannot be empty.');
    });

    it('reads a backtick name as a quoted identifier', () => {
        const [token] = tokenize('`unit price`');

        expect(token).toMatchObject({ kind: 'identifier', text: 'unit price', quoted: true, start: 0, end: 12 });
    });

    it('skips line comments', () => {
        expect(tokenize('a // note\nb').map((token) => token.text)).toEqual(['a', 'b', '']);
    });

    it('records positions', () => {
        const tokens = tokenize('ab  12');

        expect(tokens[1]).toMatchObject({ start: 4, end: 6 });
    });

    it('leaves the dot after a number to member access', () => {
        expect(tokenize('1.ToString()').map((token) => token.text)).toEqual(['1', '.', 'ToString', '(', ')', '']);
    });

    it('rejects an unclosed string with its position', () => {
        expect(() => tokenize('a == "open')).toThrow(LinqError);

        try {
            tokenize('a == "open');
        }
        catch (error: unknown) {
            expect((error as LinqError).start).toBe(5);
        }
    });

    it('rejects unknown characters', () => {
        expect(() => tokenize('a # b')).toThrow("Unexpected character '#'.");
    });
});
