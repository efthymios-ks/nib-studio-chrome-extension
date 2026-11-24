import { FontReader } from './fontFile.js';

// The strings of a font's name table that the preview shows, by name ID.
export const NAME_IDS = Object.freeze({
    copyright: 0,
    family: 1,
    subfamily: 2,
    fullName: 4,
    version: 5,
    manufacturer: 8,
    designer: 9,
    license: 13,
    licenseUrl: 14,
    typographicFamily: 16,
    typographicSubfamily: 17,
});

// Reads every name record, preferring Windows English, then any Windows or Unicode name, then a Macintosh one.
export function readNameTable(bytes: Uint8Array): ReadonlyMap<number, string> {
    const reader = new FontReader(bytes);
    const count = reader.uint16At(2);
    const storage = reader.uint16At(4);
    const best = new Map<number, { readonly rank: number; readonly text: string }>();

    for (let index = 0; index < count; index += 1) {
        const record = 6 + index * 12;
        const platform = reader.uint16At(record);
        const encoding = reader.uint16At(record + 2);
        const language = reader.uint16At(record + 4);
        const nameId = reader.uint16At(record + 6);
        const length = reader.uint16At(record + 8);
        const offset = reader.uint16At(record + 10);
        const rank = nameRank(platform, encoding, language);

        if (rank == null || (best.get(nameId)?.rank ?? Number.POSITIVE_INFINITY) <= rank) {
            continue;
        }

        const data = reader.slice(storage + offset, length);
        const text = platform === 1 ? decodeMacRoman(data) : decodeUtf16(data);
        best.set(nameId, { rank, text: text.trim() });
    }

    const names = [...best.entries()]
        .filter(([, entry]) => entry.text !== '')
        .map(([nameId, entry]): [number, string] => [nameId, entry.text]);

    return new Map(names);
}

// Windows names and cmaps in Unicode: the BMP (1), the full repertoire (10), or symbol fonts (0).
function isWindowsUnicode(platform: number, encoding: number): boolean {
    return platform === 3 && (encoding === 1 || encoding === 10 || encoding === 0);
}

// Lower is better; null for records in encodings the preview does not read.
function nameRank(platform: number, encoding: number, language: number): number | null {
    if (isWindowsUnicode(platform, encoding)) {
        return language === 0x0409 ? 0 : 1;
    }

    if (platform === 0) {
        return 2;
    }

    if (platform === 1 && encoding === 0) {
        return language === 0 ? 3 : 4;
    }

    return null;
}

function decodeUtf16(data: Uint8Array): string {
    const units: number[] = [];

    for (let index = 0; index + 1 < data.length; index += 2) {
        units.push(((data[index] ?? 0) << 8) | (data[index + 1] ?? 0));
    }

    return String.fromCharCode(...units);
}

// Mac Roman matches ASCII below 128; the rest is read as Latin-1, which covers the names fonts use in practice.
function decodeMacRoman(data: Uint8Array): string {
    return String.fromCharCode(...data);
}

// Inclusive runs of code points a font maps to a glyph.
export type CodePointRanges = ReadonlyArray<readonly [number, number]>;

// The characters a font maps, from the best Unicode subtable of its cmap: full-repertoire format 12 first, then format 4.
export function readCmapCodePoints(bytes: Uint8Array): CodePointRanges {
    const reader = new FontReader(bytes);
    const count = reader.uint16At(2);
    const subtables: Array<{ readonly rank: number; readonly offset: number }> = [];

    for (let index = 0; index < count; index += 1) {
        const record = 4 + index * 8;
        const platform = reader.uint16At(record);
        const encoding = reader.uint16At(record + 2);
        const offset = reader.uint32At(record + 4);
        const format = offset + 2 <= reader.length ? reader.uint16At(offset) : -1;
        const rank = subtableRank(platform, encoding, format);

        if (rank != null) {
            subtables.push({ rank, offset });
        }
    }

    const chosen = subtables.sort((left, right) => left.rank - right.rank)[0];

    if (chosen == null) {
        return [];
    }

    const ranges = reader.uint16At(chosen.offset) === 12
        ? readFormat12(reader, chosen.offset)
        : readFormat4(reader, chosen.offset);

    return mergeRanges(ranges);
}

function subtableRank(platform: number, encoding: number, format: number): number | null {
    if (platform !== 0 && !isWindowsUnicode(platform, encoding)) {
        return null;
    }

    if (format === 12) {
        return 0;
    }

    if (format === 4) {
        return platform === 3 && encoding === 0 ? 2 : 1;
    }

    return null;
}

function readFormat4(reader: FontReader, start: number): Array<[number, number]> {
    const segments = reader.uint16At(start + 6) / 2;
    const ends = start + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const rangeOffsets = deltas + segments * 2;
    const ranges: Array<[number, number]> = [];

    for (let segment = 0; segment < segments; segment += 1) {
        const last = reader.uint16At(ends + segment * 2);
        const first = reader.uint16At(starts + segment * 2);
        const delta = reader.uint16At(deltas + segment * 2);
        const rangeOffsetAt = rangeOffsets + segment * 2;
        const rangeOffset = reader.uint16At(rangeOffsetAt);

        for (let code = first; code <= last && code !== 0xffff; code += 1) {
            const glyph = rangeOffset === 0
                ? (code + delta) & 0xffff
                : glyphAt(reader, rangeOffsetAt + rangeOffset + (code - first) * 2, delta);

            if (glyph !== 0) {
                pushCode(ranges, code);
            }
        }
    }

    return ranges;
}

function glyphAt(reader: FontReader, offset: number, delta: number): number {
    if (offset + 2 > reader.length) {
        return 0;
    }

    const glyph = reader.uint16At(offset);

    return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
}

function readFormat12(reader: FontReader, start: number): Array<[number, number]> {
    const groups = reader.uint32At(start + 12);
    const ranges: Array<[number, number]> = [];

    for (let group = 0; group < groups; group += 1) {
        const record = start + 16 + group * 12;
        const first = reader.uint32At(record);
        const last = Math.min(reader.uint32At(record + 4), 0x10ffff);
        const firstGlyph = reader.uint32At(record + 8);
        const from = firstGlyph === 0 ? first + 1 : first;

        if (from <= last) {
            ranges.push([from, last]);
        }
    }

    return ranges;
}

function pushCode(ranges: Array<[number, number]>, code: number): void {
    const last = ranges[ranges.length - 1];

    if (last != null && last[1] === code - 1) {
        last[1] = code;

        return;
    }

    ranges.push([code, code]);
}

function mergeRanges(ranges: ReadonlyArray<readonly [number, number]>): CodePointRanges {
    const sorted = [...ranges].sort((left, right) => left[0] - right[0]);
    const merged: Array<[number, number]> = [];

    for (const [first, last] of sorted) {
        const previous = merged[merged.length - 1];

        if (previous != null && first <= previous[1] + 1) {
            previous[1] = Math.max(previous[1], last);
            continue;
        }

        merged.push([first, last]);
    }

    return merged;
}

export interface Os2Info {
    readonly weightClass: number;
    readonly widthClass: number;
    // The embedding permissions, fsType.
    readonly embedding: number;
}

export function readOs2(bytes: Uint8Array): Os2Info {
    const reader = new FontReader(bytes);

    return { weightClass: reader.uint16At(4), widthClass: reader.uint16At(6), embedding: reader.uint16At(8) };
}

export function readUnitsPerEm(head: Uint8Array): number {
    return new FontReader(head).uint16At(18);
}

export function readGlyphCount(maxp: Uint8Array): number {
    return new FontReader(maxp).uint16At(4);
}

export interface VariationAxis {
    readonly tag: string;
    readonly name: string;
    readonly min: number;
    readonly defaultValue: number;
    readonly max: number;
    readonly isHidden: boolean;
}

export interface Variations {
    readonly axes: ReadonlyArray<VariationAxis>;
    readonly instanceCount: number;
}

// The design axes of a variable font, named from the name table where it has their names.
export function readFvar(bytes: Uint8Array, names: ReadonlyMap<number, string>): Variations {
    const reader = new FontReader(bytes);
    const axesOffset = reader.uint16At(4);
    const axisCount = reader.uint16At(8);
    const axisSize = reader.uint16At(10);
    const axes: VariationAxis[] = [];

    for (let index = 0; index < axisCount; index += 1) {
        const record = axesOffset + index * axisSize;
        const tag = reader.tagAt(record);
        axes.push({
            tag,
            name: names.get(reader.uint16At(record + 18)) ?? REGISTERED_AXES[tag] ?? tag,
            min: reader.fixedAt(record + 4),
            defaultValue: reader.fixedAt(record + 8),
            max: reader.fixedAt(record + 12),
            isHidden: (reader.uint16At(record + 16) & 0x0001) !== 0,
        });
    }

    return { axes, instanceCount: reader.uint16At(12) };
}

const REGISTERED_AXES: Readonly<Record<string, string>> = Object.freeze({
    wght: 'Weight',
    wdth: 'Width',
    ital: 'Italic',
    slnt: 'Slant',
    opsz: 'Optical size',
});
