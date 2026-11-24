import { describe, expect, it } from 'vitest';
import { formatByteSize } from './byteSize.js';

describe('formatByteSize', () => {
    it('counts bytes under a kilobyte', () => {
        expect(formatByteSize(0)).toBe('0 bytes');
        expect(formatByteSize(1)).toBe('1 byte');
        expect(formatByteSize(1023)).toBe('1023 bytes');
    });

    it('keeps one decimal under ten units', () => {
        expect(formatByteSize(1024)).toBe('1 KB');
        expect(formatByteSize(1536)).toBe('1.5 KB');
        expect(formatByteSize(5 * 1024 * 1024 + 300 * 1024)).toBe('5.3 MB');
    });

    it('rounds to whole units from ten up', () => {
        expect(formatByteSize(12.4 * 1024 * 1024)).toBe('12 MB');
        expect(formatByteSize(3 * 1024 ** 3)).toBe('3 GB');
        expect(formatByteSize(2048 * 1024 ** 4)).toBe('2048 TB');
    });
});
