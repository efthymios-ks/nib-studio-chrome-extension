import { describe, expect, it } from 'vitest';
import { decodePlainText, sniffWordContainer } from './wordFormat.js';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('sniffWordContainer', () => {
    it('tells the containers a Word name can hide apart by their first bytes', () => {
        expect(sniffWordContainer(new Uint8Array())).toBe('empty');
        expect(sniffWordContainer(Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0))).toBe('compound');
        expect(sniffWordContainer(Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 0))).toBe('ooxml');
        expect(sniffWordContainer(bytes('  {\\rtf1\\ansi hello}'))).toBe('rtf');
        expect(sniffWordContainer(bytes('<html xmlns:o="urn:schemas-microsoft-com:office:office"><body>Hi</body></html>'))).toBe('html');
        expect(sniffWordContainer(bytes('<!DOCTYPE html><p>Hi</p>'))).toBe('html');
        expect(sniffWordContainer(bytes('<?xml version="1.0"?><w:wordDocument/>'))).toBe('xml');
        expect(sniffWordContainer(bytes('digraph G { a -> b }\n'))).toBe('text');
        expect(sniffWordContainer(Uint8Array.of(1, 2, 3, 0, 5))).toBe('binary');
    });

    it('tells a Word for Windows 1.0 or 2.0 file by its identifier, and leaves text with the same first bytes as text', () => {
        const header = (first: number, second: number, fib: number): Uint8Array => Uint8Array.of(first, second, fib, 0, ...new Array(60).fill(0));

        expect(sniffWordContainer(header(0xdb, 0xa5, 0x2d))).toBe('early-word');
        expect(sniffWordContainer(header(0x9b, 0xa5, 0x21))).toBe('early-word');
        expect(sniffWordContainer(header(0xdc, 0xa5, 0x65))).toBe('binary');
        expect(sniffWordContainer(bytes('ۥ starts with the bytes DB A5'))).toBe('text');
    });

    it('reads UTF-16 text with a byte order mark as text', () => {
        expect(sniffWordContainer(Uint8Array.of(0xff, 0xfe, 0x48, 0, 0x69, 0))).toBe('text');
    });
});

describe('decodePlainText', () => {
    it('reads UTF-8, UTF-16 by its mark, and falls back to Windows-1252', () => {
        expect(decodePlainText(bytes('Αθήνα'))).toBe('Αθήνα');
        expect(decodePlainText(Uint8Array.of(0xff, 0xfe, 0x48, 0, 0x69, 0))).toBe('Hi');
        expect(decodePlainText(Uint8Array.of(0x63, 0x61, 0x66, 0xe9, 0x20, 0x80))).toBe('café €');
    });
});
