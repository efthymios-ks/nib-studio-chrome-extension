const UNITS = ['KB', 'MB', 'GB', 'TB'] as const;

// "1 byte", "512 bytes", "1.5 KB", "12 MB": binary multiples, one decimal under 10.
export function formatByteSize(bytes: number): string {
    if (bytes < 1024) {
        return bytes === 1 ? '1 byte' : `${bytes} bytes`;
    }

    let value = bytes / 1024;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < UNITS.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);

    return `${rounded} ${UNITS[unitIndex]}`;
}
