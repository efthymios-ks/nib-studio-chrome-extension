import { describe, expect, it } from 'vitest';
import { formatLocalDateTime } from '../text/timeFormat.js';
import { describePdfDate, formatPdfDate, parsePdfDate, pdfDateToInstant } from './pdfDate.js';

describe('parsePdfDate', () => {
    it('reads a full PDF date with its time zone', () => {
        expect(parsePdfDate("D:20240312101522+02'00'")).toEqual({
            year: 2024,
            month: 3,
            day: 12,
            hour: 10,
            minute: 15,
            second: 22,
            precision: 'time',
            offsetMinutes: 120,
        });
    });

    it('reads Z, negative and half-hour zones, with or without the apostrophes', () => {
        expect(parsePdfDate('D:20240312101522Z')?.offsetMinutes).toBe(0);
        expect(parsePdfDate("D:20240312101522Z00'00'")?.offsetMinutes).toBe(0);
        expect(parsePdfDate("D:20240312101522-05'30'")?.offsetMinutes).toBe(-330);
        expect(parsePdfDate('D:20240312101522+0530')?.offsetMinutes).toBe(330);
        expect(parsePdfDate("D:20240312101522+02'")?.offsetMinutes).toBe(120);
    });

    it('keeps a date without a zone as the author\'s unknown local time', () => {
        expect(parsePdfDate('D:20240312101522')).toMatchObject({ hour: 10, offsetMinutes: null, precision: 'time' });
        expect(parsePdfDate('20240312101522')).toMatchObject({ year: 2024, minute: 15 });
    });

    it('notes how much of a short date was written', () => {
        expect(parsePdfDate('D:2024')).toMatchObject({ year: 2024, month: 1, day: 1, precision: 'year' });
        expect(parsePdfDate('D:202403')).toMatchObject({ month: 3, precision: 'month' });
        expect(parsePdfDate('D:20240312')).toMatchObject({ day: 12, precision: 'day' });
        expect(parsePdfDate('D:2024031210')).toMatchObject({ hour: 10, minute: 0, precision: 'time' });
    });

    it('reads the ISO 8601 dates of XMP metadata', () => {
        expect(parsePdfDate('2024-03-12T10:15:22+02:00')).toMatchObject({ year: 2024, month: 3, day: 12, hour: 10, minute: 15, second: 22, offsetMinutes: 120 });
        expect(parsePdfDate('2024-03-12T10:15:22.250Z')).toMatchObject({ second: 22, offsetMinutes: 0 });
        expect(parsePdfDate('2024-03-12T10:15')).toMatchObject({ minute: 15, second: 0, offsetMinutes: null, precision: 'time' });
        expect(parsePdfDate('2024-03-12')).toMatchObject({ precision: 'day' });
        expect(parsePdfDate('2024-03')).toMatchObject({ precision: 'month' });
    });

    it('shows a leap second as the last second of its minute', () => {
        expect(parsePdfDate('D:20161231235960Z')?.second).toBe(59);
    });

    it('is null for text that is not a date or names an impossible one', () => {
        for (const raw of ['', '   ', 'yesterday', 'D:', 'D:20241312', 'D:20230229', 'D:20240431', 'D:20240312251522', "D:20240312101522+15'00'", null, undefined]) {
            expect(parsePdfDate(raw), String(raw)).toBeNull();
        }
    });

    it('accepts the 29th of February in a leap year', () => {
        expect(parsePdfDate('D:20240229')?.day).toBe(29);
    });
});

describe('pdfDateToInstant', () => {
    it('places a zoned date on the timeline', () => {
        const date = parsePdfDate("D:20240312101522+02'00'");

        expect(date == null ? null : pdfDateToInstant(date)?.toISOString()).toBe('2024-03-12T08:15:22.000Z');
    });

    it('is null without a zone', () => {
        const date = parsePdfDate('D:20240312101522');

        expect(date == null ? 'unparsed' : pdfDateToInstant(date)).toBeNull();
    });
});

describe('formatPdfDate', () => {
    const format = (raw: string): string => {
        const date = parsePdfDate(raw);

        if (date == null) {
            throw new Error(`Unparsed ${raw}`);
        }

        return formatPdfDate(date);
    };

    it('shows a zoned date in the device\'s time zone', () => {
        expect(format("D:20240312101522+02'00'")).toBe(formatLocalDateTime(new Date(Date.UTC(2024, 2, 12, 8, 15, 22))));
        expect(format('D:20250101090000Z')).toBe(formatLocalDateTime(new Date(Date.UTC(2025, 0, 1, 9, 0, 0))));
    });

    it('shows a date without a zone as written, with no zone', () => {
        expect(format('D:20240312101522')).toBe('2024-03-12 10:15:22');
    });

    it('shows only what a short date wrote', () => {
        expect(format('D:2024')).toBe('2024');
        expect(format('D:202403')).toBe('2024-03');
        expect(format("D:20240312+02'00'")).toBe('2024-03-12');
    });
});

describe('describePdfDate', () => {
    it('formats a date that parses', () => {
        expect(describePdfDate('D:20240312101522')).toBe('2024-03-12 10:15:22');
    });

    it('keeps text that doesn\'t parse as written, trimmed', () => {
        expect(describePdfDate('  Tuesday morning ')).toBe('Tuesday morning');
    });

    it('is null for nothing', () => {
        expect(describePdfDate('')).toBeNull();
        expect(describePdfDate(undefined)).toBeNull();
        expect(describePdfDate(20240312)).toBeNull();
    });
});
