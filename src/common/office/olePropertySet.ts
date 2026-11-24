import { decodeCodePage } from './codePage.js';
import { cleanProperties, type WordProperties } from './wordProperties.js';

type PropertyValue = string | number | boolean | Date;

// One section of an OLE property set stream: its format id and its values by property id.
interface PropertySection {
    readonly formatId: string;
    readonly values: ReadonlyMap<number, PropertyValue>;
}

export const SUMMARY_INFORMATION_ID = 'F29F85E0-4FF9-1068-AB91-08002B27B3D9';
const DOCUMENT_SUMMARY_INFORMATION_ID = 'D5CDD502-2E9C-101B-9397-08002B2CF9AE';

const PID_CODEPAGE = 1;
const DEFAULT_CODEPAGE = 1252;

// Milliseconds from 1601-01-01, where FILETIME counts from, to 1970-01-01.
const FILETIME_EPOCH_OFFSET_MS = 11_644_473_600_000;

// Reads every section of a property set stream, such as `\x05SummaryInformation`.
// A damaged stream gives what could be read, never an error.
export function readPropertySetStream(bytes: Uint8Array): PropertySection[] {
    if (bytes.length < 48) {
        return [];
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (view.getUint16(0, true) !== 0xfffe) {
        return [];
    }

    const sectionCount = Math.min(view.getUint32(24, true), 4);
    const sections: PropertySection[] = [];

    for (let index = 0; index < sectionCount; index += 1) {
        const header = 28 + index * 20;

        if (header + 20 > bytes.length) {
            break;
        }

        const formatId = formatGuid(bytes.subarray(header, header + 16));
        const offset = view.getUint32(header + 16, true);
        sections.push({ formatId, values: readSection(view, offset) });
    }

    return sections;
}

function readSection(view: DataView, start: number): Map<number, PropertyValue> {
    const values = new Map<number, PropertyValue>();

    if (start + 8 > view.byteLength) {
        return values;
    }

    const count = Math.min(view.getUint32(start + 4, true), 1024);
    const entries: Array<readonly [number, number]> = [];

    for (let index = 0; index < count; index += 1) {
        const entry = start + 8 + index * 8;

        if (entry + 8 > view.byteLength) {
            break;
        }

        entries.push([view.getUint32(entry, true), start + view.getUint32(entry + 4, true)]);
    }

    // The code page decides how 8-bit strings read, so it is read first, wherever it sits.
    const codePageEntry = entries.find(([id]) => id === PID_CODEPAGE);
    const codePageValue = codePageEntry == null ? null : readValue(view, codePageEntry[1], DEFAULT_CODEPAGE);
    const codePage = typeof codePageValue === 'number' ? codePageValue & 0xffff : DEFAULT_CODEPAGE;

    for (const [id, offset] of entries) {
        const value = readValue(view, offset, codePage);

        if (value != null) {
            values.set(id, id === PID_CODEPAGE && typeof value === 'number' ? value & 0xffff : value);
        }
    }

    return values;
}

type ValueReader = (view: DataView, at: number, codePage: number) => PropertyValue | null;

const fixed = (size: number, read: (view: DataView, at: number) => PropertyValue | null): ValueReader => (view, at) => (
    at + size <= view.byteLength ? read(view, at) : null
);

// Readers by VARTYPE; other types, such as thumbnails and vectors, are skipped.
const VALUE_READERS: ReadonlyMap<number, ValueReader> = new Map<number, ValueReader>([
    [0x0002, fixed(2, (view, at) => view.getInt16(at, true))],
    [0x0003, fixed(4, (view, at) => view.getInt32(at, true))],
    [0x0004, fixed(4, (view, at) => view.getFloat32(at, true))],
    [0x0005, fixed(8, (view, at) => view.getFloat64(at, true))],
    [0x000b, fixed(2, (view, at) => view.getUint16(at, true) !== 0)],
    [0x0012, fixed(2, (view, at) => view.getUint16(at, true))],
    [0x0013, fixed(4, (view, at) => view.getUint32(at, true))],
    [0x0014, fixed(8, (view, at) => Number(view.getBigInt64(at, true)))],
    [0x0015, fixed(8, (view, at) => Number(view.getBigUint64(at, true)))],
    [0x0016, fixed(4, (view, at) => view.getInt32(at, true))],
    [0x0017, fixed(4, (view, at) => view.getUint32(at, true))],
    [0x001e, (view, at, codePage) => readCodePageString(view, at, codePage)],
    [0x001f, (view, at) => readUnicodeString(view, at)],
    [0x0040, fixed(8, (view, at) => fileTimeToDate(view.getUint32(at, true), view.getUint32(at + 4, true)))],
]);

function readValue(view: DataView, offset: number, codePage: number): PropertyValue | null {
    if (offset + 4 > view.byteLength) {
        return null;
    }

    const reader = VALUE_READERS.get(view.getUint16(offset, true));

    try {
        return reader == null ? null : reader(view, offset + 4, codePage);
    }
    catch {
        return null;
    }
}

function readCodePageString(view: DataView, at: number, codePage: number): string | null {
    const size = view.getUint32(at, true);
    const start = at + 4;

    if (start + size > view.byteLength) {
        return null;
    }

    const bytes = new Uint8Array(view.buffer, view.byteOffset + start, size);

    return trimNulls(decodeCodePage(bytes, codePage));
}

function readUnicodeString(view: DataView, at: number): string | null {
    const length = view.getUint32(at, true);
    const start = at + 4;

    if (start + length * 2 > view.byteLength) {
        return null;
    }

    return trimNulls(new TextDecoder('utf-16le').decode(new Uint8Array(view.buffer, view.byteOffset + start, length * 2)));
}

function trimNulls(text: string): string {
    const end = text.indexOf('\u0000');

    return end < 0 ? text : text.slice(0, end);
}

// A FILETIME counts 100-nanosecond steps from 1601; zero means the time was never set.
export function fileTimeToDate(low: number, high: number): Date | null {
    if (low === 0 && high === 0) {
        return null;
    }

    const milliseconds = (high * 0x1_0000_0000 + low) / 10_000 - FILETIME_EPOCH_OFFSET_MS;
    const date = new Date(milliseconds);

    return Number.isNaN(date.getTime()) || milliseconds < 0 ? null : date;
}

export function formatGuid(bytes: Uint8Array): string {
    const hex = (from: number, to: number, reverse: boolean): string => {
        const part = [...bytes.subarray(from, to)];

        return (reverse ? part.reverse() : part).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    };

    return [
        hex(0, 4, true),
        hex(4, 6, true),
        hex(6, 8, true),
        hex(8, 10, false),
        hex(10, 16, false),
    ].join('-').toUpperCase();
}

function sectionValues(stream: Uint8Array | null, formatId: string): ReadonlyMap<number, PropertyValue> {
    const section = stream == null ? null : readPropertySetStream(stream).find((candidate) => candidate.formatId === formatId);

    return section?.values ?? new Map();
}

function text(values: ReadonlyMap<number, PropertyValue>, id: number): string | undefined {
    const value = values.get(id);

    return typeof value === 'string' ? value : undefined;
}

function count(values: ReadonlyMap<number, PropertyValue>, id: number): number | undefined {
    const value = values.get(id);

    return typeof value === 'number' ? value : undefined;
}

function date(values: ReadonlyMap<number, PropertyValue>, id: number): Date | undefined {
    const value = values.get(id);

    return value instanceof Date ? value : undefined;
}

// The properties of a .doc, from its SummaryInformation and DocumentSummaryInformation streams.
export function readSummaryProperties(summary: Uint8Array | null, documentSummary: Uint8Array | null): WordProperties {
    const info = sectionValues(summary, SUMMARY_INFORMATION_ID);
    const documentInfo = sectionValues(documentSummary, DOCUMENT_SUMMARY_INFORMATION_ID);

    return cleanProperties({
        title: text(info, 2),
        subject: text(info, 3),
        author: text(info, 4),
        keywords: text(info, 5),
        comments: text(info, 6),
        lastSavedBy: text(info, 8),
        revision: text(info, 9),
        created: date(info, 12),
        modified: date(info, 13),
        pages: count(info, 14),
        words: count(info, 15),
        characters: count(info, 16),
        application: text(info, 18),
        category: text(documentInfo, 2),
        manager: text(documentInfo, 14),
        company: text(documentInfo, 15),
    });
}
