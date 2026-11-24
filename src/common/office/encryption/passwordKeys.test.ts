import { describe, expect, it } from 'vitest';
import { digestSync } from '../../hash/syncDigest.js';
import { littleEndian32, passwordBytes, readStreamSize, sizedTo, spinPasswordHash } from './passwordKeys.js';

describe('passwordBytes', () => {
    it('writes the password as UTF-16 little-endian', () => {
        expect([...passwordBytes('Aβ')]).toEqual([0x41, 0x00, 0xb2, 0x03]);
    });
});

describe('spinPasswordHash', () => {
    it('hashes the salt and password, then the counter and the hash each time round', () => {
        const salt = Uint8Array.of(9, 8, 7);
        const first = digestSync('SHA-1', salt, passwordBytes('pw'));
        const second = digestSync('SHA-1', littleEndian32(0), first);
        const third = digestSync('SHA-1', littleEndian32(1), second);

        expect(spinPasswordHash('SHA-1', salt, 'pw', 0)).toEqual(first);
        expect(spinPasswordHash('SHA-1', salt, 'pw', 2)).toEqual(third);
    });
});

describe('sizedTo', () => {
    it('cuts long bytes and pads short ones with the fill byte', () => {
        expect([...sizedTo(Uint8Array.of(1, 2, 3), 2, 0x36)]).toEqual([1, 2]);
        expect([...sizedTo(Uint8Array.of(1), 3, 0x36)]).toEqual([1, 0x36, 0x36]);
    });
});

describe('readStreamSize', () => {
    it('reads the 64-bit little-endian size, and zero when the stream is too short', () => {
        expect(readStreamSize(Uint8Array.of(0x10, 0x27, 0, 0, 1, 0, 0, 0, 0xff))).toBe(0x1_0000_2710);
        expect(readStreamSize(Uint8Array.of(1, 2))).toBe(0);
    });
});

describe('littleEndian32', () => {
    it('writes a number low byte first', () => {
        expect([...littleEndian32(0x01020304)]).toEqual([4, 3, 2, 1]);
    });
});
