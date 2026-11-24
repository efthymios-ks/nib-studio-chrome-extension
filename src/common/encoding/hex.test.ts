import { describe, expect, it } from 'vitest';
import { bytesToHex, parseHex } from './hex.js';

describe('bytesToHex', () => {
    it('writes two lower-case digits per byte', () => {
        expect(bytesToHex(new Uint8Array([0, 1, 0xab, 0xff]))).toBe('0001abff');
    });

    it('writes upper case on request', () => {
        expect(bytesToHex(new Uint8Array([0xab, 0xcd]), true)).toBe('ABCD');
    });

    it('writes nothing for no bytes', () => {
        expect(bytesToHex(new Uint8Array())).toBe('');
    });
});

describe('parseHex', () => {
    it('round-trips every byte value', () => {
        const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
        const result = parseHex(bytesToHex(bytes));

        expect(result.ok && [...result.value]).toEqual([...bytes]);
    });

    it('reads either case and skips separators and 0x prefixes', () => {
        for (const text of ['DEADbeef', 'de ad be ef', 'de:ad:be:ef', 'de-ad-be-ef', '0xdead 0xbeef', 'de\nad\r\nbe\tef']) {
            const result = parseHex(text);

            expect(result.ok && [...result.value]).toEqual([0xde, 0xad, 0xbe, 0xef]);
        }
    });

    it('reports an invalid character with its position', () => {
        const result = parseHex('abzd');

        expect(!result.ok && result.error).toEqual({ message: "Invalid hex character 'z'", position: 2, length: 1 });
    });

    it('reports the digit left without a pair', () => {
        const result = parseHex('ab cd e');

        expect(!result.ok && result.error).toEqual({ message: "Odd number of hex digits; 'e' has no pair", position: 6, length: 1 });
    });

    it('treats 0x inside a group as digits and an x', () => {
        const result = parseHex('a0x1');

        expect(!result.ok && result.error.position).toBe(2);
    });

    it('reads empty input as no bytes', () => {
        const result = parseHex('  ');

        expect(result.ok && result.value.length).toBe(0);
    });
});
