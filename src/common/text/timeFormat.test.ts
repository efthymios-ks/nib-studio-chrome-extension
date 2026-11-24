import { describe, expect, it } from 'vitest';
import { formatLocalDateTime, formatRelativeTime } from './timeFormat.js';

describe('formatLocalDateTime', () => {
    it('writes the local date, time and UTC offset', () => {
        const date = new Date(2026, 10, 16, 9, 5, 7);
        const offset = -date.getTimezoneOffset();
        const sign = offset >= 0 ? '+' : '-';
        const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
        const minutes = String(Math.abs(offset) % 60).padStart(2, '0');

        expect(formatLocalDateTime(date)).toBe(`2026-11-16 09:05:07 UTC${sign}${hours}:${minutes}`);
    });
});

describe('formatRelativeTime', () => {
    const now = Date.UTC(2026, 10, 16, 12, 0, 0);

    it('says now for the same second', () => {
        expect(formatRelativeTime(now, now)).toBe('now');
    });

    it('uses the largest unit that fits', () => {
        expect(formatRelativeTime(now + 45_000, now)).toBe('in 45 seconds');
        expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5 minutes ago');
        expect(formatRelativeTime(now + 3 * 3_600_000 + 20 * 60_000, now)).toBe('in 3 hours');
        expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2 days ago');
        expect(formatRelativeTime(now + 400 * 86_400_000, now)).toBe('next year');
    });

    it('rounds to the nearest whole unit', () => {
        expect(formatRelativeTime(now + 2 * 3_600_000 - 5_000, now)).toBe('in 2 hours');
        expect(formatRelativeTime(now - 3_600_000 - 5_000, now)).toBe('1 hour ago');
        expect(formatRelativeTime(now + 90 * 60_000, now)).toBe('in 2 hours');
    });
});
