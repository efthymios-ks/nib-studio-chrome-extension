import { describe, expect, it } from 'vitest';
import { extractRtfText } from './rtfText.js';

describe('extractRtfText', () => {
    it('keeps paragraphs, line breaks and tabs, and drops formatting', () => {
        const rtf = '{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red0\\green0\\blue0;}\\f0\\fs24 Hello {\\b bold} world\\par Second\\line line\\tab end\\par}';

        expect(extractRtfText(rtf)).toBe('Hello bold world\nSecond\nline\tend');
    });

    it('decodes hex escapes in the document code page and Unicode escapes with their fallback skipped', () => {
        expect(extractRtfText('{\\rtf1\\ansi\\ansicpg1253 \\\'c1\\\'e8\\\'de\\\'ed\\\'e1}')).toBe('Αθήνα');
        expect(extractRtfText('{\\rtf1\\ansi\\uc1\\u915?\\u-3913?x}')).toBe('Γx');
        expect(extractRtfText('{\\rtf1 caf\\\'e9 \\\'80}')).toBe('café €');
    });

    it('skips pictures, ignorable destinations and field instructions but keeps field results', () => {
        const rtf = '{\\rtf1 A{\\pict\\pngblip 89504e47}B{\\*\\generator Word;}C{\\field{\\*\\fldinst HYPERLINK "x"}{\\fldrslt link}}D}';

        expect(extractRtfText(rtf)).toBe('ABClinkD');
    });

    it('turns escaped symbols and cells into text', () => {
        expect(extractRtfText('{\\rtf1 a\\{b\\}c\\\\d\\~e\\-f\\_g\\cell h\\row}')).toBe('a{b}c\\d\u00A0ef\u2011g\th');
    });
});
