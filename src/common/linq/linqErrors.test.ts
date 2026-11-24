import { describe, expect, it } from 'vitest';
import { LinqError, isLinqError, locateOffset, suggestName, withSuggestion } from './linqErrors.js';

describe('linqErrors', () => {
    describe('LinqError', () => {
        it('keeps the message, name and span', () => {
            const error = new LinqError('Unexpected token.', { start: 4, end: 9 });

            expect(error).toBeInstanceOf(Error);
            expect(error.message).toBe('Unexpected token.');
            expect(error.name).toBe('LinqError');
            expect(error.start).toBe(4);
            expect(error.end).toBe(9);
            expect(error.line).toBe(1);
            expect(error.column).toBe(1);
        });

        it('never lets the end fall before the start', () => {
            const error = new LinqError('Bad span.', { start: 7, end: 3 });

            expect(error.end).toBe(7);
        });

        it('locates its line and column in the query text and returns itself', () => {
            const error = new LinqError('Unknown column.', { start: 18, end: 22 });

            const located = error.locate('from row in rows\nwhere row.x > 1');

            expect(located).toBe(error);
            expect(error.line).toBe(2);
            expect(error.column).toBe(2);
        });
    });

    describe('locateOffset', () => {
        it('places offset zero at line 1, column 1', () => {
            expect(locateOffset('abc', 0)).toEqual({ line: 1, column: 1 });
        });

        it('counts columns on the first line', () => {
            expect(locateOffset('abcdef', 3)).toEqual({ line: 1, column: 4 });
        });

        it('starts a new line after each line feed', () => {
            expect(locateOffset('ab\ncd\nef', 3)).toEqual({ line: 2, column: 1 });
            expect(locateOffset('ab\ncd\nef', 7)).toEqual({ line: 3, column: 2 });
        });

        it('clamps an offset past the end to the end of the text', () => {
            expect(locateOffset('ab\ncd', 100)).toEqual({ line: 2, column: 3 });
        });

        it('handles empty text', () => {
            expect(locateOffset('', 5)).toEqual({ line: 1, column: 1 });
        });
    });

    describe('isLinqError', () => {
        it('recognises only LinqError instances', () => {
            expect(isLinqError(new LinqError('x', { start: 0, end: 0 }))).toBe(true);
            expect(isLinqError(new Error('x'))).toBe(false);
            expect(isLinqError({ name: 'LinqError', start: 0, end: 0 })).toBe(false);
            expect(isLinqError(undefined)).toBe(false);
        });
    });

    describe('suggestName', () => {
        const columns = ['city', 'country', 'ordered_at', 'total'];

        it('suggests the closest candidate for a typo', () => {
            expect(suggestName('cty', columns)).toBe('city');
            expect(suggestName('ordred_at', columns)).toBe('ordered_at');
        });

        it('matches ignoring case and keeps the candidate spelling', () => {
            expect(suggestName('TOTAL', ['Total'])).toBe('Total');
        });

        it('returns null when nothing is close enough', () => {
            expect(suggestName('price', columns)).toBeNull();
        });

        it('returns null without candidates', () => {
            expect(suggestName('city', [])).toBeNull();
        });

        it('allows one edit for short names', () => {
            expect(suggestName('ab', ['ac'])).toBe('ac');
            expect(suggestName('ab', ['cd'])).toBeNull();
        });

        it('prefers the first of equally close candidates', () => {
            expect(suggestName('cat', ['bat', 'hat'])).toBe('bat');
        });

        it('accepts any iterable', () => {
            expect(suggestName('cty', new Set(columns))).toBe('city');
        });
    });

    describe('withSuggestion', () => {
        it('appends a suggestion when one is close', () => {
            expect(withSuggestion("Unknown column 'cty'.", 'cty', ['city'])).toBe("Unknown column 'cty'. Did you mean 'city'?");
        });

        it('returns the message unchanged when nothing is close', () => {
            expect(withSuggestion("Unknown column 'price'.", 'price', ['city'])).toBe("Unknown column 'price'.");
        });
    });
});
