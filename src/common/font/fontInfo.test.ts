import { describe, expect, it } from 'vitest';
import {
    fontFormatLabel,
    fontMetadataGroups,
    formatEmbedding,
    formatWeightClass,
    formatWidthClass,
    readFontInfoAsync,
} from './fontInfo.js';
import { buildCmap, buildSfnt, buildWoff2, sampleFontTables } from './testing/fontBuilder.js';

describe('readFontInfoAsync', () => {
    it('gathers names, metrics, axes and characters from a WOFF2', async () => {
        const info = await readFontInfoAsync(buildWoff2(sampleFontTables()));

        expect(info.container).toBe('woff2');
        expect(info.names.get(1)).toBe('Nib Sans');
        expect([info.glyphCount, info.unitsPerEm, info.os2?.weightClass]).toEqual([42, 1000, 400]);
        expect(info.variations?.axes.map((axis) => axis.tag)).toEqual(['wght', 'wdth', 'XHID']);
        expect(info.codePoints).toHaveLength(3);
    });

    it('leaves out a damaged table and keeps the rest', async () => {
        const info = await readFontInfoAsync(buildSfnt({ ...sampleFontTables(), 'OS/2': new Uint8Array(3) }));

        expect(info.os2).toBeNull();
        expect(info.names.get(1)).toBe('Nib Sans');
    });
});

describe('fontMetadataGroups', () => {
    it('lists the Font, Variable axes and Credits rows', async () => {
        const groups = fontMetadataGroups(await readFontInfoAsync(buildSfnt(sampleFontTables())));

        expect(groups).toEqual([
            {
                title: 'Font',
                rows: [
                    { label: 'Family', value: 'Nib Sans' },
                    { label: 'Style', value: 'Regular' },
                    { label: 'Full name', value: 'Nib Sans Regular' },
                    { label: 'Version', value: 'Version 1.002' },
                    { label: 'Glyphs', value: '42' },
                    { label: 'Characters', value: '6' },
                    { label: 'Units per em', value: '1,000' },
                    { label: 'Weight', value: '400 (Regular)' },
                    { label: 'Width', value: '5 (Normal)' },
                ],
            },
            {
                title: 'Variable axes',
                rows: [
                    { label: 'Heaviness (wght)', value: '100 to 900, default 400' },
                    { label: 'Width (wdth)', value: '75 to 125, default 100' },
                    { label: 'XHID (XHID)', value: '0 to 1, default 0' },
                    { label: 'Named styles', value: '3' },
                ],
            },
            {
                title: 'Credits',
                rows: [
                    { label: 'Designer', value: 'A. Designer' },
                    { label: 'Foundry', value: 'Nib Type Foundry' },
                    { label: 'Copyright', value: 'Copyright 2026 Nib Type' },
                    { label: 'Licence', value: 'SIL Open Font License 1.1' },
                    { label: 'Licence URL', value: 'https://openfontlicense.org' },
                    { label: 'Embedding', value: 'Editable' },
                ],
            },
        ]);
    });

    it('counts the characters the sheet shows, leaving out spaces and control and format characters', async () => {
        // Tab, space, A, B, no-break space, soft hyphen, zero-width joiner and one character beyond the BMP.
        const cmap = buildCmap([0x09, 0x20, 0x41, 0x42, 0xa0, 0xad, 0x200d], [[0x09, 0x09], [0x20, 0x20], [0x41, 0x42], [0xa0, 0xa0], [0xad, 0xad], [0x200d, 0x200d], [0x1f600, 0x1f600]]);
        const info = await readFontInfoAsync(buildSfnt({ ...sampleFontTables(), cmap }));
        const font = fontMetadataGroups(info).find((group) => group.title === 'Font');

        expect(font?.rows.find((row) => row.label === 'Characters')?.value).toBe('3');
    });

    it('leaves the Characters row out for a font that maps nothing that shows', async () => {
        const cmap = buildCmap([0x20, 0xa0]);
        const info = await readFontInfoAsync(buildSfnt({ ...sampleFontTables(), cmap }));
        const font = fontMetadataGroups(info).find((group) => group.title === 'Font');

        expect(font?.rows.map((row) => row.label)).not.toContain('Characters');
    });

    it('leaves the axes out for a font that does not vary', async () => {
        const { fvar: _fvar, ...tables } = sampleFontTables();
        const groups = fontMetadataGroups(await readFontInfoAsync(buildSfnt(tables)));

        expect(groups.map((group) => group.title)).toEqual(['Font', 'Credits']);
    });
});

describe('font labels', () => {
    it('names the format', () => {
        expect(fontFormatLabel({ container: 'sfnt', outlines: 'TrueType' })).toBe('TrueType font');
        expect(fontFormatLabel({ container: 'sfnt', outlines: 'CFF' })).toBe('OpenType font with CFF outlines');
        expect(fontFormatLabel({ container: 'collection', outlines: 'TrueType' })).toBe('TrueType collection');
        expect(fontFormatLabel({ container: 'woff2', outlines: 'CFF' })).toBe('WOFF2, CFF outlines');
    });

    it('names weights, widths and embedding permissions', () => {
        expect(formatWeightClass(700)).toBe('700 (Bold)');
        expect(formatWeightClass(450)).toBe('450');
        expect(formatWidthClass(3)).toBe('3 (Condensed)');
        expect(formatEmbedding(0)).toBe('Installable');
        expect(formatEmbedding(0x0002)).toBe('Restricted');
        expect(formatEmbedding(0x0004)).toBe('Preview and print');
    });
});
