const RELATIVE_UNITS: ReadonlyArray<{ readonly unit: Intl.RelativeTimeFormatUnit; readonly seconds: number }> = [
    { unit: 'year', seconds: 365 * 24 * 3600 },
    { unit: 'month', seconds: 30 * 24 * 3600 },
    { unit: 'day', seconds: 24 * 3600 },
    { unit: 'hour', seconds: 3600 },
    { unit: 'minute', seconds: 60 },
    { unit: 'second', seconds: 1 },
];

const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

// "2026-11-16 21:30:05 UTC+02:00", in the device's time zone.
export function formatLocalDateTime(date: Date): string {
    const pad = (value: number): string => String(value).padStart(2, '0');
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

    return `${day} ${time} UTC${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

// "in 3 hours", "2 days ago", "now": the largest unit that fits, rounded to the nearest whole one.
export function formatRelativeTime(targetMs: number, nowMs: number): string {
    const seconds = Math.round((targetMs - nowMs) / 1000);
    const unit = RELATIVE_UNITS.find((candidate) => Math.abs(seconds) >= candidate.seconds) ?? RELATIVE_UNITS.at(-1);

    if (unit == null) {
        return '';
    }

    return relativeFormat.format(Math.round(seconds / unit.seconds), unit.unit);
}
