import { describe, expect, it } from 'vitest';
import { bytesEqual, concatBytes } from './bytes.js';

describe('bytes', () => {
    it('compares arrays byte by byte', () => {
        expect(bytesEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBe(true);
        expect(bytesEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
        expect(bytesEqual(Uint8Array.of(1), Uint8Array.of(1, 2))).toBe(false);
    });

    it('joins parts into one array', () => {
        expect(concatBytes([Uint8Array.of(1), new Uint8Array(0), Uint8Array.of(2, 3)])).toEqual(Uint8Array.of(1, 2, 3));
    });
});
