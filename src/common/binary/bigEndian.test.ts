import { describe, expect, it } from 'vitest';
import { readUint16BigEndian, readUint32BigEndian } from './bigEndian.js';

describe('bigEndian', () => {
    it('reads integers most significant byte first, and bytes past the end as 0', () => {
        const bytes = new Uint8Array([0x12, 0x34, 0x89, 0xab, 0xcd, 0xef]);

        expect(readUint16BigEndian(bytes, 0)).toBe(0x1234);
        expect(readUint32BigEndian(bytes, 2)).toBe(0x89abcdef);
        expect(readUint32BigEndian(bytes, 4)).toBe(0xcdef0000);
    });
});
