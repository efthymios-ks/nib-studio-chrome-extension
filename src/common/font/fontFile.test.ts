import { describe, expect, it, vi } from 'vitest';
import { readFontFileAsync } from './fontFile.js';
import {
    buildCollection,
    buildName,
    buildSfnt,
    buildWoff,
    buildWoff2,
    buildWoff2Collection,
    sampleFontTables,
    windowsName,
} from './testing/fontBuilder.js';

const TABLES = sampleFontTables();
const OTTO = 0x4f54544f;

function tableTags(tables: ReadonlyMap<string, Uint8Array>): string[] {
    return [...tables.keys()].sort();
}

describe('readFontFileAsync', () => {
    it('reads the tables of a TrueType font', async () => {
        const font = await readFontFileAsync(buildSfnt(TABLES));

        expect([font.container, font.outlines, font.faceCount]).toEqual(['sfnt', 'TrueType', 1]);
        expect(tableTags(font.tables)).toEqual(['OS/2', 'cmap', 'fvar', 'head', 'maxp', 'name']);
        expect(font.tables.get('maxp')).toEqual(TABLES['maxp']);
    });

    it('tells CFF outlines by the OTTO signature', async () => {
        expect((await readFontFileAsync(buildSfnt(TABLES, OTTO))).outlines).toBe('CFF');
    });

    it('reads only the tables it needs', async () => {
        const font = await readFontFileAsync(buildSfnt({ ...TABLES, glyf: new Uint8Array(64) }));

        expect(font.tables.has('glyf')).toBe(false);
    });

    it('takes the first face of a collection and counts the faces', async () => {
        const second = { ...TABLES, name: buildName([windowsName(1, 'Second Face')]) };
        const font = await readFontFileAsync(buildCollection([TABLES, second]));

        expect([font.container, font.faceCount]).toEqual(['collection', 2]);
        expect(font.tables.get('name')).toEqual(TABLES['name']);
    });

    it('inflates the zlib tables of a WOFF', async () => {
        const font = await readFontFileAsync(buildWoff(TABLES));

        expect(font.container).toBe('woff');
        expect(font.tables.get('name')).toEqual(TABLES['name']);
        expect(font.tables.get('cmap')).toEqual(TABLES['cmap']);
    });

    it('uses the inflater it is given, only for compressed tables', async () => {
        const inflate = vi.fn(async () => new Uint8Array([1, 2, 3]));
        const font = await readFontFileAsync(buildWoff(TABLES), inflate);

        expect(inflate).toHaveBeenCalled();
        expect(font.tables.get('maxp')).toEqual(TABLES['maxp']);
    });

    it('undoes the Brotli stream of a WOFF2, with known and spelled-out tags', async () => {
        const font = await readFontFileAsync(buildWoff2({ ...TABLES, Zzzz: new Uint8Array(5) }, OTTO));

        expect([font.container, font.outlines]).toEqual(['woff2', 'CFF']);
        expect(tableTags(font.tables)).toEqual(['OS/2', 'cmap', 'fvar', 'head', 'maxp', 'name']);
        expect(font.tables.get('fvar')).toEqual(TABLES['fvar']);
    });

    it('takes the first face of a WOFF2 collection, with the flavor its collection directory gives', async () => {
        const second = { ...TABLES, name: buildName([windowsName(1, 'Second Face')]) };
        const font = await readFontFileAsync(buildWoff2Collection([TABLES, second], OTTO));

        expect([font.container, font.outlines, font.faceCount]).toEqual(['woff2', 'CFF', 2]);
        expect(tableTags(font.tables)).toEqual(['OS/2', 'cmap', 'fvar', 'head', 'maxp', 'name']);
        expect(font.tables.get('name')).toEqual(TABLES['name']);
    });

    it('throws a readable error for anything else', async () => {
        await expect(readFontFileAsync(new TextEncoder().encode('not a font at all'))).rejects.toThrow(/not a TrueType/);
        await expect(readFontFileAsync(new Uint8Array([0, 1, 0, 0, 0, 9]))).rejects.toThrow(/ends early/);
    });
});
