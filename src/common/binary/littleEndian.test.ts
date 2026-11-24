import { describe, expect, it } from 'vitest';
import { readInt16, readInt32, readUint16, readUint32 } from './littleEndian.js';

describe('littleEndian', () => {
    const bytes = new Uint8Array([0x34, 0x12, 0xff, 0xff, 0x78, 0x56, 0x34, 0x92]);

    it('reads unsigned and signed integers least significant byte first', () => {
        expect(readUint16(bytes, 0)).toBe(0x1234);
        expect(readInt16(bytes, 2)).toBe(-1);
        expect(readUint32(bytes, 4)).toBe(0x92345678);
        expect(readInt32(bytes, 4)).toBe(0x92345678 - 0x100000000);
    });

    it('reads bytes past the end as 0', () => {
        expect(readUint16(bytes, 7)).toBe(0x92);
        expect(readUint32(bytes, 8)).toBe(0);
    });
});
