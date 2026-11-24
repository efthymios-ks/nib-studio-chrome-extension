import { formatLocalDateTime } from '../text/timeFormat.js';

// How much of a date was written: a year, a month, a day, or a day and a time.
export type PdfDatePrecision = 'year' | 'month' | 'day' | 'time';

// A date read from a PDF. Its parts are as written; `offsetMinutes` is its time zone east of UTC,
// or null when the date names none, which the PDF format reads as the author's unknown local time.
export interface PdfDate {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly hour: number;
    readonly minute: number;
    readonly second: number;
    readonly precision: PdfDatePrecision;
    readonly offsetMinutes: number | null;
}

// D:YYYYMMDDHHmmSSOHH'mm', where everything after the year may be missing, and the zone is Z, + or -.
const PDF_DATE_PATTERN = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?\s*(?:([Zz+-])\s*(?:(\d{2})'?\s*(?:(\d{2})'?)?)?)?/;

// The ISO 8601 dates of XMP metadata: 2024-03-12, 2024-03-12T10:15, 2024-03-12T10:15:22.5+02:00.
const ISO_DATE_PATTERN = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?)?)?)?\s*(?:(Z|z|[+-])(\d{2})?:?(\d{2})?)?$/;

// Reads a PDF date or an XMP date; null for text that is neither or names an impossible day or time.
export function parsePdfDate(raw: string | null | undefined): PdfDate | null {
    const text = raw?.trim() ?? '';

    if (text === '') {
        return null;
    }

    const match = ISO_DATE_PATTERN.exec(text) ?? PDF_DATE_PATTERN.exec(text);

    if (match == null) {
        return null;
    }

    const part = (index: number, fallback: number): number => {
        const value = match[index];

        return value == null || value === '' ? fallback : Number(value);
    };
    const date = {
        year: part(1, 0),
        month: part(2, 1),
        day: part(3, 1),
        hour: part(4, 0),
        minute: part(5, 0),
        // A leap second shows as the last second of its minute.
        second: Math.min(59, part(6, 0)),
        precision: precisionOf(match),
        offsetMinutes: zoneOffset(match[7], match[8], match[9]),
    };

    return isPossibleDate(date) ? date : null;
}

function precisionOf(match: RegExpExecArray): PdfDatePrecision {
    if (match[4] != null) {
        return 'time';
    }

    if (match[3] != null) {
        return 'day';
    }

    return match[2] == null ? 'year' : 'month';
}

function zoneOffset(
    sign: string | undefined,
    hours: string | undefined,
    minutes: string | undefined,
): number | null {
    if (sign == null) {
        return null;
    }

    if (sign === 'Z' || sign === 'z') {
        return 0;
    }

    const total = Number(hours ?? '0') * 60 + Number(minutes ?? '0');

    return sign === '-' ? -total : total;
}

function isPossibleDate(date: PdfDate): boolean {
    const daysInMonth = new Date(Date.UTC(date.year, date.month, 0)).getUTCDate();

    return date.month >= 1
        && date.month <= 12
        && date.day >= 1
        && date.day <= daysInMonth
        && date.hour <= 23
        && date.minute <= 59
        && (date.offsetMinutes == null || Math.abs(date.offsetMinutes) <= 14 * 60);
}

// The moment a dated time names; null without a time zone, since then the moment is unknown.
export function pdfDateToInstant(date: PdfDate): Date | null {
    if (date.offsetMinutes == null) {
        return null;
    }

    const utc = Date.UTC(date.year, date.month - 1, date.day, date.hour, date.minute, date.second);

    return new Date(utc - date.offsetMinutes * 60_000);
}

// "2024-03-12 10:15:22 UTC+02:00" in the device's time zone when the date names a zone,
// "2024-03-12 10:15:22" as written when it doesn't,
// and "2024-03-12", "2024-03" or "2024" for a date written without a time.
export function formatPdfDate(date: PdfDate): string {
    const pad = (value: number): string => String(value).padStart(2, '0');
    const year = String(date.year).padStart(4, '0');
    const day = `${year}-${pad(date.month)}-${pad(date.day)}`;

    if (date.precision === 'year') {
        return year;
    }

    if (date.precision === 'month') {
        return `${year}-${pad(date.month)}`;
    }

    if (date.precision === 'day') {
        return day;
    }

    const instant = pdfDateToInstant(date);

    if (instant != null) {
        return formatLocalDateTime(instant);
    }

    return `${day} ${pad(date.hour)}:${pad(date.minute)}:${pad(date.second)}`;
}

// The Info panel's text for a date field: formatted when it parses, the text as written when it doesn't.
export function describePdfDate(raw: unknown): string | null {
    if (typeof raw !== 'string' || raw.trim() === '') {
        return null;
    }

    const date = parsePdfDate(raw);

    return date == null ? raw.trim() : formatPdfDate(date);
}
