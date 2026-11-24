import { describe, expect, it } from 'vitest';
import { Rc4 } from './rc4.js';

function text(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

function hex(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('hex').toUpperCase();
}

describe('Rc4', () => {
    it('encrypts the published test vectors', () => {
        expect(hex(new Rc4(text('Key')).apply(text('Plaintext')))).toBe('BBF316E8D940AF0AD3');
        expect(hex(new Rc4(text('Wiki')).apply(text('pedia')))).toBe('1021BF0420');
        expect(hex(new Rc4(text('Secret')).apply(text('Attack at dawn')))).toBe('45A01F645FC35B383552544B9BF5');
    });

    it('gives the RFC 6229 keystream for a 40-bit key', () => {
        expect(hex(new Rc4(Uint8Array.of(1, 2, 3, 4, 5)).apply(new Uint8Array(8)))).toBe('B2396305F03DC027');
    });

    it('decrypts with the same key', () => {
        const encrypted = new Rc4(text('Key')).apply(text('Plaintext'));

        expect(new TextDecoder().decode(new Rc4(text('Key')).apply(encrypted.slice()))).toBe('Plaintext');
    });

    it('refuses an empty key', () => {
        expect(() => new Rc4(new Uint8Array(0))).toThrow('An RC4 key needs at least one byte.');
    });
});
