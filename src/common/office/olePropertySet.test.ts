import { describe, expect, it } from 'vitest';
import {
    fileTimeToDate,
    formatGuid,
    readPropertySetStream,
    readSummaryProperties,
    SUMMARY_INFORMATION_ID,
} from './olePropertySet.js';
import { buildPropertySet, SUMMARY_FORMAT_ID } from './testing/docFixtures.js';

describe('readPropertySetStream', () => {
    it('reads the section\'s format id, code page and typed values', () => {
        const date = new Date('2008-01-04T09:15:00Z');
        const sections = readPropertySetStream(buildPropertySet(SUMMARY_FORMAT_ID, [
            [2, 'string', 'Test Document'],
            [8, 'unicode', 'Νίκος'],
            [12, 'date', date],
            [14, 'int', 2],
        ]));

        expect(sections).toHaveLength(1);
        expect(sections[0]?.formatId).toBe(SUMMARY_INFORMATION_ID);
        expect(Object.fromEntries(sections[0]?.values ?? [])).toEqual({ 1: 1252, 2: 'Test Document', 8: 'Νίκος', 12: date, 14: 2 });
    });

    it('gives nothing for a stream that isn\'t a property set, and what it can for a cut one', () => {
        const whole = buildPropertySet(SUMMARY_FORMAT_ID, [[2, 'string', 'Kept'], [3, 'string', 'Lost at the end of the stream']]);

        expect(readPropertySetStream(Uint8Array.of(1, 2, 3))).toEqual([]);
        expect(readPropertySetStream(new Uint8Array(64))).toEqual([]);
        expect(readSummaryProperties(whole.subarray(0, whole.length - 20), null)).toEqual({ title: 'Kept' });
    });
});

describe('property helpers', () => {
    it('turns a FILETIME into a date, and zero into none', () => {
        expect(fileTimeToDate(0, 0)).toBeNull();
        expect(fileTimeToDate(0xd53e8000, 0x019db1de)?.toISOString()).toBe('1970-01-01T00:00:00.000Z');
    });

    it('formats a GUID with its first three groups little-endian', () => {
        expect(formatGuid(Uint8Array.from(SUMMARY_FORMAT_ID))).toBe('F29F85E0-4FF9-1068-AB91-08002B27B3D9');
    });
});
