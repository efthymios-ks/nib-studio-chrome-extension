import { describe, expect, it } from 'vitest';
import { foldCharacter, foldKeepingOffsets, foldPattern } from './findFolding.js';

describe('foldCharacter', () => {
    it('lowers case and drops accents, Greek tonos and dialytika included', () => {
        expect(['Ά', 'ό', 'ΐ', 'ϋ', 'É', 'ñ'].map(foldCharacter)).toEqual(['α', 'ο', 'ι', 'υ', 'e', 'n']);
    });

    it('folds a final sigma and a capital sigma to σ', () => {
        expect(['ς', 'Σ', 'σ'].map(foldCharacter)).toEqual(['σ', 'σ', 'σ']);
    });

    it('drops the dot that lower-casing İ leaves behind, and a lone combining mark', () => {
        expect(foldCharacter('İ')).toBe('i');
        expect(foldCharacter('́')).toBe('');
    });
});

describe('foldKeepingOffsets', () => {
    it('folds case, accents and final sigmas as PDF Find does, keeping the length', () => {
        const text = 'ΟΔΟΣ οδός Café';

        expect(foldKeepingOffsets(text)).toBe('οδοσ οδοσ cafe');
        expect(foldKeepingOffsets(text)).toHaveLength(text.length);
    });

    it('turns a no-break space into a plain one', () => {
        expect(foldKeepingOffsets('10\u00A0km')).toBe('10 km');
    });

    it('keeps a character whose fold has another length, such as a combining mark, which folds to nothing', () => {
        expect(foldKeepingOffsets('İx')).toBe('ix');
        expect(foldKeepingOffsets('é')).toBe('é');
    });
});

describe('foldPattern', () => {
    const matches = (typed: string, text: string): boolean => new RegExp(foldPattern(typed) ?? '(?!)', 'iu').test(text);

    it('matches a letter with every accent and tone it can carry, in either case', () => {
        expect(['α', 'ά', 'Ά', 'ὰ', 'ᾶ'].every((text) => matches('α', text))).toBe(true);
        expect(['e', 'é', 'È', 'ê'].every((text) => matches('e', text))).toBe(true);
        expect(matches('é', 'E')).toBe(true);
        expect(matches('α', 'ε')).toBe(false);
    });

    it('matches σ, a final ς and a capital Σ whichever one is typed', () => {
        expect(['σ', 'ς', 'Σ'].every((text) => matches('ς', text) && matches('Σ', text))).toBe(true);
    });

    it('escapes characters that mean something in a regular expression, and gives null for a mark on its own', () => {
        expect(matches('.', 'a')).toBe(false);
        expect(matches('+', '+')).toBe(true);
        expect(matches('(', '(')).toBe(true);
        expect(foldPattern('́')).toBeNull();
    });
});
