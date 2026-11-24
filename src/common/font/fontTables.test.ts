import { describe, expect, it } from 'vitest';
import {
    readCmapCodePoints,
    readFvar,
    readGlyphCount,
    readNameTable,
    readOs2,
    readUnitsPerEm,
} from './fontTables.js';
import { buildCmap, buildFvar, buildHead, buildMaxp, buildName, buildOs2, sampleFontTables, windowsName } from './testing/fontBuilder.js';

const TABLES = sampleFontTables();

describe('readNameTable', () => {
    it('reads the Windows English names as UTF-16', () => {
        const names = readNameTable(TABLES['name'] as Uint8Array);

        expect(names.get(1)).toBe('Nib Sans');
        expect(names.get(4)).toBe('Nib Sans Regular');
        expect(names.get(14)).toBe('https://openfontlicense.org');
    });

    it('prefers Windows English over other languages and over Macintosh names', () => {
        const names = readNameTable(buildName([
            { platform: 1, encoding: 0, language: 0, nameId: 1, text: 'Mac Family' },
            { platform: 3, encoding: 1, language: 0x0408, nameId: 1, text: 'Greek Family' },
            windowsName(1, 'English Family'),
            { platform: 1, encoding: 0, language: 0, nameId: 2, text: 'Mac Style' },
            { platform: 3, encoding: 1, language: 0x0408, nameId: 4, text: 'Ελληνικά' },
        ]));

        expect(names.get(1)).toBe('English Family');
        expect(names.get(2)).toBe('Mac Style');
        expect(names.get(4)).toBe('Ελληνικά');
    });

    it('leaves out empty names', () => {
        expect(readNameTable(buildName([windowsName(9, '  ')])).has(9)).toBe(false);
    });
});

describe('readCmapCodePoints', () => {
    it('reads format 4, through deltas and through the glyph array', () => {
        expect(readCmapCodePoints(buildCmap([0x41, 0x42, 0x44, 0x3a9]))).toEqual([[0x41, 0x42], [0x44, 0x44], [0x3a9, 0x3a9]]);
    });

    it('prefers the full-repertoire format 12 subtable, beyond the BMP too', () => {
        expect(readCmapCodePoints(TABLES['cmap'] as Uint8Array)).toEqual([[0x41, 0x43], [0x61, 0x61], [0x1f600, 0x1f601]]);
    });

    it('skips a group that starts at glyph 0', () => {
        const cmap = buildCmap([0x41], [[0x20, 0x22]]);
        const view = new DataView(cmap.buffer);
        const format12 = view.getUint32(4 + 8 + 4);
        view.setUint32(format12 + 16 + 8, 0);

        expect(readCmapCodePoints(cmap)).toEqual([[0x21, 0x22]]);
    });

    it('is empty without a Unicode subtable', () => {
        expect(readCmapCodePoints(new Uint8Array([0, 0, 0, 0]))).toEqual([]);
    });
});

describe('OS/2, head and maxp', () => {
    it('reads weight, width and embedding, units per em and the glyph count', () => {
        expect(readOs2(buildOs2(700, 3, 0x0004))).toEqual({ weightClass: 700, widthClass: 3, embedding: 0x0004 });
        expect(readUnitsPerEm(buildHead(2048))).toBe(2048);
        expect(readGlyphCount(buildMaxp(1234))).toBe(1234);
    });

    it('throws for a table that ends early', () => {
        expect(() => readOs2(new Uint8Array(4))).toThrow(/ends early/);
    });
});

describe('readFvar', () => {
    it('reads the axes with their ranges, names and hidden flag, and counts the named styles', () => {
        const names = readNameTable(TABLES['name'] as Uint8Array);
        const variations = readFvar(TABLES['fvar'] as Uint8Array, names);

        expect(variations.instanceCount).toBe(3);
        expect(variations.axes).toEqual([
            { tag: 'wght', name: 'Heaviness', min: 100, defaultValue: 400, max: 900, isHidden: false },
            { tag: 'wdth', name: 'Width', min: 75, defaultValue: 100, max: 125, isHidden: false },
            { tag: 'XHID', name: 'XHID', min: 0, defaultValue: 0, max: 1, isHidden: true },
        ]);
    });

    it('reads fractional and negative axis values', () => {
        const fvar = buildFvar([{ tag: 'slnt', min: -12.5, defaultValue: 0, max: 0, nameId: 300 }], 0);

        expect(readFvar(fvar, new Map()).axes[0]).toMatchObject({ name: 'Slant', min: -12.5, max: 0 });
    });
});
