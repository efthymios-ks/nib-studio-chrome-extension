import { describe, expect, it } from 'vitest';
import { describePosition, fail, quoteCharacterAt, succeed } from './codecResult.js';

describe('succeed / fail', () => {
    it('wraps a value with no warning by default', () => {
        expect(succeed('text')).toEqual({ ok: true, value: 'text', warning: null });
    });

    it('carries a warning alongside the value', () => {
        const warning = { message: 'odd', position: null, length: 0 };

        expect(succeed(1, warning)).toEqual({ ok: true, value: 1, warning });
    });

    it('records the message, position and a default length of one', () => {
        expect(fail('bad', 4)).toEqual({ ok: false, error: { message: 'bad', position: 4, length: 1 } });
        expect(fail('bad', null, 3)).toEqual({ ok: false, error: { message: 'bad', position: null, length: 3 } });
    });
});

describe('describePosition', () => {
    it('counts from one on a single line', () => {
        expect(describePosition('abc', 0)).toBe('position 1');
        expect(describePosition('abc', 2)).toBe('position 3');
    });

    it('gives the line and column once there are several lines', () => {
        expect(describePosition('ab\ncd\nef', 4)).toBe('line 2, column 2');
        expect(describePosition('ab\ncd', 0)).toBe('line 1, column 1');
        expect(describePosition('ab\ncd', 3)).toBe('line 2, column 1');
    });
});

describe('quoteCharacterAt', () => {
    it('quotes a plain character', () => {
        expect(quoteCharacterAt('a*b', 1)).toBe("'*'");
    });

    it('quotes a whole astral character', () => {
        expect(quoteCharacterAt('x😀', 1)).toBe("'😀'");
    });

    it('names whitespace by its code point', () => {
        expect(quoteCharacterAt('a\tb', 1)).toBe('U+0009');
    });

    it('names the end of the input', () => {
        expect(quoteCharacterAt('ab', 2)).toBe('end of input');
    });
});
