import { describe, expect, it } from 'vitest';
import { countShownCharacters, shownCharacters } from './fontCharacters.js';

describe('shownCharacters', () => {
    it('leaves spaces and control characters out of both the list and the count', () => {
        expect(shownCharacters([[0x1f, 0x22]], 10)).toEqual({ shown: ['!', '"'], total: 2 });
    });

    it('leaves out format characters, separators and surrogates by the same rule', () => {
        // Soft hyphen and zero-width joiner (format), no-break space and the line separator (separators),
        // and the first high surrogate, around three letters that show.
        const ranges: ReadonlyArray<readonly [number, number]> = [
            [0x41, 0x43],
            [0xa0, 0xa0],
            [0xad, 0xad],
            [0x200d, 0x200d],
            [0x2028, 0x2028],
            [0xd800, 0xd800],
        ];

        expect(shownCharacters(ranges, 10)).toEqual({ shown: ['A', 'B', 'C'], total: 3 });
    });

    it('stops listing at the limit but counts every character it could show', () => {
        const characters = shownCharacters([[0x00, 0x7f]], 30);

        expect(characters.shown).toHaveLength(30);
        expect(characters.shown.at(-1)).toBe('>');
        expect(characters.total).toBe(94);
    });
});

describe('countShownCharacters', () => {
    it('counts what shownCharacters counts, beyond the BMP too', () => {
        const ranges: ReadonlyArray<readonly [number, number]> = [[0x00, 0x7f], [0xad, 0xad], [0x1f600, 0x1f601]];

        expect(countShownCharacters(ranges)).toBe(96);
        expect(countShownCharacters(ranges)).toBe(shownCharacters(ranges, 0).total);
    });

    it('is zero for a font that maps nothing that shows', () => {
        expect(countShownCharacters([])).toBe(0);
        expect(countShownCharacters([[0x09, 0x0d], [0x20, 0x20]])).toBe(0);
    });
});
