import { describe, expect, it } from 'vitest';
import { formatPageSize, paperSizeName } from './paperSize.js';

const millimetres = (value: number): number => (value * 72) / 25.4;

describe('paperSizeName', () => {
    it('names the common sheets in points as PDF writers round them', () => {
        expect(paperSizeName(595.28, 841.89)).toBe('A4');
        expect(paperSizeName(595, 842)).toBe('A4');
        expect(paperSizeName(612, 792)).toBe('Letter');
        expect(paperSizeName(612, 1008)).toBe('Legal');
        expect(paperSizeName(842, 1191)).toBe('A3');
        expect(paperSizeName(420, 595)).toBe('A5');
        expect(paperSizeName(792, 1224)).toBe('Tabloid');
    });

    it('says landscape when the page is wider than tall', () => {
        expect(paperSizeName(841.89, 595.28)).toBe('A4 landscape');
        expect(paperSizeName(792, 612)).toBe('Letter landscape');
    });

    it('tells the ISO and JIS B5 sheets apart', () => {
        expect(paperSizeName(millimetres(176), millimetres(250))).toBe('B5');
        expect(paperSizeName(millimetres(182), millimetres(257))).toBe('JIS B5');
    });

    it('allows two millimetres either way, and no more', () => {
        expect(paperSizeName(millimetres(211.9), millimetres(295.1))).toBe('A4');
        expect(paperSizeName(millimetres(212.5), millimetres(297))).toBeNull();
    });

    it('is null for an uncommon size', () => {
        expect(paperSizeName(500, 500)).toBeNull();
        expect(paperSizeName(1000, 200)).toBeNull();
    });
});

describe('formatPageSize', () => {
    it('gives millimetres, inches and the sheet name', () => {
        expect(formatPageSize(595.28, 841.89)).toBe('210 × 297 mm (8.27 × 11.69 in), A4');
        expect(formatPageSize(612, 792)).toBe('215.9 × 279.4 mm (8.5 × 11 in), Letter');
        expect(formatPageSize(792, 612)).toBe('279.4 × 215.9 mm (11 × 8.5 in), Letter landscape');
    });

    it('leaves the name out for an uncommon size', () => {
        expect(formatPageSize(360, 360)).toBe('127 × 127 mm (5 × 5 in)');
    });
});
