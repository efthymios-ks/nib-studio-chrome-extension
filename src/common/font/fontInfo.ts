import { compactGroups, formatCount, metadataGroup, type MetadataGroup } from '../preview/metadataGroups.js';
import { countShownCharacters } from './fontCharacters.js';
import {
    readFontFileAsync,
    type FontContainer,
    type FontOutlines,
    type InflateAsync,
    type Unbrotli,
} from './fontFile.js';
import {
    NAME_IDS,
    readCmapCodePoints,
    readFvar,
    readGlyphCount,
    readNameTable,
    readOs2,
    readUnitsPerEm,
    type CodePointRanges,
    type Os2Info,
    type VariationAxis,
    type Variations,
} from './fontTables.js';

// What the font preview knows about a font's first face.
export interface FontInfo {
    readonly container: FontContainer;
    readonly outlines: FontOutlines;
    readonly faceCount: number;
    readonly names: ReadonlyMap<number, string>;
    readonly glyphCount: number | null;
    readonly unitsPerEm: number | null;
    readonly os2: Os2Info | null;
    readonly variations: Variations | null;
    readonly codePoints: CodePointRanges;
}

// Reads a font file's container and tables; a table that is missing or damaged is simply left out.
export async function readFontInfoAsync(
    bytes: Uint8Array,
    inflateAsync?: InflateAsync,
    unbrotli?: Unbrotli,
): Promise<FontInfo> {
    const font = await readFontFileAsync(bytes, inflateAsync, unbrotli);
    const table = <T>(tag: string, read: (data: Uint8Array) => T): T | null => {
        const data = font.tables.get(tag);

        if (data == null) {
            return null;
        }

        try {
            return read(data);
        }
        catch {
            return null;
        }
    };
    const names = table('name', readNameTable) ?? new Map<number, string>();

    return {
        container: font.container,
        outlines: font.outlines,
        faceCount: font.faceCount,
        names,
        glyphCount: table('maxp', readGlyphCount),
        unitsPerEm: table('head', readUnitsPerEm),
        os2: table('OS/2', readOs2),
        variations: table('fvar', (data) => readFvar(data, names)),
        codePoints: table('cmap', readCmapCodePoints) ?? [],
    };
}

const CONTAINER_LABELS: Readonly<Record<FontContainer, string>> = Object.freeze({
    sfnt: 'font',
    collection: 'collection',
    woff: 'WOFF',
    woff2: 'WOFF2',
});

// "TrueType font", "OpenType font with CFF outlines", "WOFF2, TrueType outlines", "TrueType collection".
export function fontFormatLabel(info: Pick<FontInfo, 'container' | 'outlines'>): string {
    const kind = info.outlines === 'CFF' ? 'OpenType' : 'TrueType';

    if (info.container === 'sfnt') {
        return info.outlines === 'CFF' ? 'OpenType font with CFF outlines' : 'TrueType font';
    }

    if (info.container === 'collection') {
        return `${kind} collection`;
    }

    return `${CONTAINER_LABELS[info.container]}, ${info.outlines} outlines`;
}

const WEIGHT_NAMES: Readonly<Record<number, string>> = Object.freeze({
    100: 'Thin',
    200: 'Extra Light',
    300: 'Light',
    400: 'Regular',
    500: 'Medium',
    600: 'Semi Bold',
    700: 'Bold',
    800: 'Extra Bold',
    900: 'Black',
});

const WIDTH_NAMES: ReadonlyArray<string> = [
    'Ultra-condensed',
    'Extra-condensed',
    'Condensed',
    'Semi-condensed',
    'Normal',
    'Semi-expanded',
    'Expanded',
    'Extra-expanded',
    'Ultra-expanded',
];

// "400 (Regular)".
export function formatWeightClass(weight: number): string {
    const name = WEIGHT_NAMES[weight];

    return name == null ? String(weight) : `${weight} (${name})`;
}

// "5 (Normal)".
export function formatWidthClass(width: number): string {
    const name = WIDTH_NAMES[width - 1];

    return name == null ? String(width) : `${width} (${name})`;
}

// The OS/2 embedding permissions, as a font's licence grants them to documents that embed it.
export function formatEmbedding(fsType: number): string {
    if ((fsType & 0x0002) !== 0) {
        return 'Restricted';
    }

    if ((fsType & 0x0004) !== 0) {
        return 'Preview and print';
    }

    if ((fsType & 0x0008) !== 0) {
        return 'Editable';
    }

    return 'Installable';
}

// "100 to 900, default 400".
function formatAxisRange(axis: VariationAxis): string {
    return `${formatAxisValue(axis.min)} to ${formatAxisValue(axis.max)}, default ${formatAxisValue(axis.defaultValue)}`;
}

function formatAxisValue(value: number): string {
    return String(Math.round(value * 100) / 100);
}

// The Font, Variable axes and Credits groups of the Info panel; the File group comes from the preview.
export function fontMetadataGroups(info: FontInfo): MetadataGroup[] {
    const name = (id: number): string | undefined => info.names.get(id);
    const axes = info.variations?.axes ?? [];
    const instanceCount = info.variations?.instanceCount ?? 0;

    return compactGroups([
        metadataGroup('Font', [
            ['Family', name(NAME_IDS.typographicFamily) ?? name(NAME_IDS.family)],
            ['Style', name(NAME_IDS.typographicSubfamily) ?? name(NAME_IDS.subfamily)],
            ['Full name', name(NAME_IDS.fullName)],
            ['Version', name(NAME_IDS.version)],
            ['Faces', info.faceCount > 1 ? `${info.faceCount}, the first is shown` : null],
            ['Glyphs', formatCount(info.glyphCount)],
            ['Characters', formatCount(countShownCharacters(info.codePoints))],
            ['Units per em', info.unitsPerEm == null ? null : info.unitsPerEm.toLocaleString('en-US')],
            ['Weight', info.os2 == null ? null : formatWeightClass(info.os2.weightClass)],
            ['Width', info.os2 == null ? null : formatWidthClass(info.os2.widthClass)],
        ]),
        metadataGroup('Variable axes', [
            ...axes.map((axis): readonly [string, string] => [`${axis.name} (${axis.tag})`, formatAxisRange(axis)]),
            ['Named styles', instanceCount > 0 ? String(instanceCount) : null],
        ]),
        metadataGroup('Credits', [
            ['Designer', name(NAME_IDS.designer)],
            ['Foundry', name(NAME_IDS.manufacturer)],
            ['Copyright', name(NAME_IDS.copyright)],
            ['Licence', name(NAME_IDS.license)],
            ['Licence URL', name(NAME_IDS.licenseUrl)],
            ['Embedding', info.os2 == null ? null : formatEmbedding(info.os2.embedding)],
        ]),
    ]);
}
