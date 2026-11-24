import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsvStreamAsync } from './csvParser.js';

describe('detectDelimiter', () => {
    it('picks comma for standard CSV', () => {
        expect(detectDelimiter('a,b,c\n1,2,3\n4,5,6')).toBe(',');
    });

    it('picks semicolon for European CSV', () => {
        expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    });

    it('picks tab for TSV', () => {
        expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    });

    it('picks pipe for pipe-delimited files', () => {
        expect(detectDelimiter('a|b|c\n1|2|3')).toBe('|');
    });

    it('ignores delimiters inside quotes', () => {
        expect(detectDelimiter('"a,b";c;d\n"1,2";3;4')).toBe(';');
    });

    it('falls back to comma for empty input', () => {
        expect(detectDelimiter('')).toBe(',');
    });
});

describe('parseCsvStreamAsync', () => {
    it('parses a small CSV string with header', async () => {
        const result = await parseCsvStreamAsync('name,age\nAlice,30\nBob,25', { hasHeader: true });

        expect(result.header).toEqual(['name', 'age']);
        expect(result.rows).toHaveLength(2);
        expect(result.rows[0]).toEqual(['Alice', '30']);
        expect(result.rows[1]).toEqual(['Bob', '25']);
        expect(result.errors).toHaveLength(0);
    });

    it('round-trips a sample without a header', async () => {
        const result = await parseCsvStreamAsync('1,2,3\n4,5,6', { hasHeader: false });

        expect(result.rows).toEqual([['1', '2', '3'], ['4', '5', '6']]);
    });

    it('applies dynamic typing when requested', async () => {
        const result = await parseCsvStreamAsync('a,b\n1,2.5\n3,4', {
            hasHeader: true,
            dynamicTyping: true,
        });

        expect(result.rows[0]).toEqual([1, 2.5]);
    });
});
