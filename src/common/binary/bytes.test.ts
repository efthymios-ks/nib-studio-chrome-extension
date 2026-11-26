import { describe, expect, it } from 'vitest';
import { bytesEqual, concatBytes, toArrayBuffer } from './bytes.js';

describe('bytes', () => {
    it('compares arrays byte by byte', () => {
        expect(bytesEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBe(true);
        expect(bytesEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
        expect(bytesEqual(Uint8Array.of(1), Uint8Array.of(1, 2))).toBe(false);
    });

    it('joins parts into one array', () => {
        expect(concatBytes([Uint8Array.of(1), new Uint8Array(0), Uint8Array.of(2, 3)])).toEqual(Uint8Array.of(1, 2, 3));
    });

    it('hands over the buffer the bytes fill', () => {
        const bytes = new Uint8Array([1, 2, 3]);

        expect(toArrayBuffer(bytes)).toBe(bytes.buffer);
    });

    it('copies just the viewed bytes otherwise', () => {
        const bytes = new Uint8Array([1, 2, 3, 4]).subarray(1, 3);

        expect([...new Uint8Array(toArrayBuffer(bytes))]).toEqual([2, 3]);
    });
});
