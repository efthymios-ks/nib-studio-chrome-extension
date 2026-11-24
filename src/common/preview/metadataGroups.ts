import { formatByteSize } from '../text/byteSize.js';
import { formatLocalDateTime } from '../text/timeFormat.js';

export interface MetadataRow {
    readonly label: string;
    readonly value: string;
}

// A titled set of rows in the preview's Info panel, such as File, Image, Camera or Location.
export interface MetadataGroup {
    readonly title: string;
    readonly rows: ReadonlyArray<MetadataRow>;
}

export type MetadataEntry = readonly [label: string, value: string | null | undefined];

// Rows without a value are left out, and a group left with no rows is null, so the panel lists only what the file holds.
export function metadataGroup(title: string, entries: ReadonlyArray<MetadataEntry>): MetadataGroup | null {
    const rows = entries
        .filter((entry): entry is readonly [string, string] => entry[1] != null && entry[1].trim() !== '')
        .map(([label, value]) => ({ label, value }));

    return rows.length === 0 ? null : { title, rows };
}

export function compactGroups(groups: ReadonlyArray<MetadataGroup | null>): MetadataGroup[] {
    return groups.filter((group): group is MetadataGroup => group != null);
}

// The File group every preview starts with: name, kind, size and when it last changed on disk.
export function fileMetadataGroup(file: Pick<File, 'name' | 'size' | 'lastModified'>, typeLabel: string): MetadataGroup {
    return {
        title: 'File',
        rows: [
            { label: 'Name', value: file.name },
            { label: 'Type', value: typeLabel },
            { label: 'Size', value: formatFileSize(file.size) },
            { label: 'Modified', value: formatLocalDateTime(new Date(file.lastModified)) },
        ],
    };
}

// "20 KB (19,971 bytes)", or just "512 bytes" when the short form already says it exactly.
export function formatFileSize(bytes: number): string {
    const short = formatByteSize(bytes);

    return bytes < 1024 ? short : `${short} (${bytes.toLocaleString('en-US')} bytes)`;
}

// "1,234", for a count of pages, words or glyphs; null when the count is missing or zero,
// as files write zero for counts they never worked out.
export function formatCount(count: number | null | undefined): string | null {
    return count == null || !Number.isFinite(count) || count <= 0 ? null : count.toLocaleString('en-US');
}

// A date the file records, in local time with the offset, as the File group's Modified row shows it;
// null when it is missing or invalid.
export function formatMetadataDate(date: Date | null | undefined): string | null {
    return date == null || Number.isNaN(date.getTime()) ? null : formatLocalDateTime(date);
}

// "4,032 × 3,024 pixels".
export function formatDimensions(width: number, height: number): string {
    return `${width.toLocaleString('en-US')} × ${height.toLocaleString('en-US')} pixels`;
}

// "12.2 MP", or "0.26 MP" for small images, so a tiny image still shows a non-zero count.
export function formatMegapixels(width: number, height: number): string {
    const megapixels = (width * height) / 1_000_000;
    const rounded = megapixels >= 10 ? megapixels.toFixed(1) : megapixels.toFixed(2);

    return `${rounded} MP`;
}

// "0:02.5" under a minute, "3:07" under an hour, "1:02:03" beyond, rounded to the nearest tenth or second;
// null when the length is unknown.
export function formatDuration(seconds: number): string | null {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return null;
    }

    const pad = (value: number): string => String(value).padStart(2, '0');

    const tenths = Math.round(seconds * 10);

    if (tenths < 600) {
        return `0:${pad(Math.floor(tenths / 10))}.${tenths % 10}`;
    }

    const total = Math.round(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = total % 60;

    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}
