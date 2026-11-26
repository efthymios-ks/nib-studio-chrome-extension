import { describe, expect, it } from 'vitest';
import { decodeReferences, flattenText, lineAt, MAX_TEXT_CHARS, sectionAt } from './lookupText.js';

describe('flattenText', () => {
    it('turns every run of white space and control characters into one space, with none at either end', () => {
        expect(flattenText('\n\t  one\u0000two \r\n\u00A0 three  \u0007', { keepLines: false }).text).toBe('one two three');
    });

    it('keeps where each line starts in the flat text, blank lines and \\r\\n included', () => {
        const flat = flattenText('first\r\n\r\nthird line\nfourth', { keepLines: true });

        expect(flat.text).toBe('first third line fourth');
        expect([...flat.lineStarts ?? []]).toEqual([6, 6, 17]);
        expect(lineAt(flat.lineStarts ?? new Int32Array(), 0)).toBe(1);
        expect(lineAt(flat.lineStarts ?? new Int32Array(), flat.text.indexOf('third'))).toBe(3);
        expect(lineAt(flat.lineStarts ?? new Int32Array(), flat.text.indexOf('fourth'))).toBe(4);
    });

    it('counts the lines a leading blank run holds', () => {
        const flat = flattenText('\n\nhello', { keepLines: true });

        expect(lineAt(flat.lineStarts ?? new Int32Array(), 0)).toBe(3);
    });

    it('keeps no lines for a document', () => {
        expect(flattenText('a\nb', { keepLines: false }).lineStarts).toBeNull();
    });

    it('keeps at most 2,000,000 characters', () => {
        const flat = flattenText('word '.repeat(500_000), { keepLines: false });

        expect(flat.text).toHaveLength(MAX_TEXT_CHARS);
        expect(flat.text.startsWith('word word')).toBe(true);
    });
});

describe('sectionAt', () => {
    const sections = [
        { name: 'Q1', firstLine: 1, firstNumber: 1 },
        { name: 'North Region', firstLine: 5, firstNumber: 3 },
    ];

    it('names the section a line lies in, and numbers the line within it', () => {
        expect(sectionAt(sections, 1)).toEqual({ name: 'Q1', number: 1 });
        expect(sectionAt(sections, 4)).toEqual({ name: 'Q1', number: 4 });
        expect(sectionAt(sections, 5)).toEqual({ name: 'North Region', number: 3 });
        expect(sectionAt(sections, 9)).toEqual({ name: 'North Region', number: 7 });
    });

    it('finds none before the first section or without sections', () => {
        expect(sectionAt([{ name: 'Late', firstLine: 3, firstNumber: 1 }], 2)).toBeNull();
        expect(sectionAt([], 1)).toBeNull();
    });
});

describe('decodeReferences', () => {
    it('decodes named and numeric references, and leaves unknown ones and a bare & as they are', () => {
        expect(decodeReferences('AT&amp;T &lt;b&gt; caf&#233; &#x3b1; &bogus; & more')).toBe('AT&T <b> café α &bogus; & more');
    });
});
