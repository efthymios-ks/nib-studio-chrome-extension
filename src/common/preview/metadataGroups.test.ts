import { describe, expect, it } from 'vitest';
import {
    compactGroups,
    fileMetadataGroup,
    formatCount,
    formatDimensions,
    formatDuration,
    formatFileSize,
    formatMegapixels,
    formatMetadataDate,
    metadataGroup,
} from './metadataGroups.js';

describe('metadataGroup', () => {
    it('keeps only the rows that have a value', () => {
        expect(metadataGroup('Image', [['Size', '4 × 3 pixels'], ['Frames', null], ['Note', '  ']])).toEqual({
            title: 'Image',
            rows: [{ label: 'Size', value: '4 × 3 pixels' }],
        });
    });

    it('is null without rows, and compactGroups drops it', () => {
        const empty = metadataGroup('Camera', [['Camera', undefined]]);

        expect(empty).toBeNull();
        expect(compactGroups([empty, { title: 'File', rows: [] }])).toEqual([{ title: 'File', rows: [] }]);
    });
});

describe('formatCount and formatMetadataDate', () => {
    it('groups thousands and leaves out a count that is missing or zero', () => {
        expect(formatCount(2_849)).toBe('2,849');
        expect(formatCount(1)).toBe('1');
        expect(formatCount(0)).toBeNull();
        expect(formatCount(undefined)).toBeNull();
        expect(formatCount(Number.NaN)).toBeNull();
    });

    it('shows a date as the Modified row does, and leaves out a missing or invalid one', () => {
        const date = new Date(Date.UTC(2026, 10, 2, 9, 30, 0));

        expect(formatMetadataDate(date)).toMatch(/^2026-11-02 \d{2}:30:00 UTC[+-]\d{2}:\d{2}$/);
        expect(formatMetadataDate(new Date(Number.NaN))).toBeNull();
        expect(formatMetadataDate(null)).toBeNull();
    });
});

describe('fileMetadataGroup', () => {
    it('lists the name, type, size and modified time', () => {
        const group = fileMetadataGroup({ name: 'photo.jpg', size: 19_971, lastModified: Date.UTC(2026, 0, 2, 3, 4, 5) }, 'JPEG image');

        expect(group.title).toBe('File');
        expect(group.rows.map((row) => row.label)).toEqual(['Name', 'Type', 'Size', 'Modified']);
        expect(group.rows[2]?.value).toBe('20 KB (19,971 bytes)');
        expect(group.rows[3]?.value).toMatch(/^2026-01-0[12] \d\d:\d\d:05 UTC[+-]\d\d:\d\d$/);
    });
});

describe('formats', () => {
    it('writes sizes with the exact byte count once past a kilobyte', () => {
        expect(formatFileSize(512)).toBe('512 bytes');
        expect(formatFileSize(1_764_955)).toBe('1.7 MB (1,764,955 bytes)');
    });

    it('writes dimensions and megapixels', () => {
        expect(formatDimensions(4032, 3024)).toBe('4,032 × 3,024 pixels');
        expect(formatMegapixels(4032, 3024)).toBe('12.2 MP');
        expect(formatMegapixels(400, 640)).toBe('0.26 MP');
    });

    it('writes durations by their length, rounded to the nearest tenth or second', () => {
        expect(formatDuration(2.04)).toBe('0:02.0');
        expect(formatDuration(2.94)).toBe('0:02.9');
        expect(formatDuration(2.977)).toBe('0:03.0');
        expect(formatDuration(2.993)).toBe('0:03.0');
        expect(formatDuration(0.3)).toBe('0:00.3');
        expect(formatDuration(0.04)).toBe('0:00.0');
        expect(formatDuration(59.97)).toBe('1:00');
        expect(formatDuration(187.4)).toBe('3:07');
        expect(formatDuration(187.9)).toBe('3:08');
        expect(formatDuration(3599.6)).toBe('1:00:00');
        expect(formatDuration(3723)).toBe('1:02:03');
        expect(formatDuration(Number.POSITIVE_INFINITY)).toBeNull();
        expect(formatDuration(Number.NaN)).toBeNull();
    });
});
