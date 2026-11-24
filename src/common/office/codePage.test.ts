import { describe, expect, it } from 'vitest';
import {
    codePageOfLanguage,
    codePageOfLanguageTags,
    cp1252CharCode,
    decodeCodePage,
    decodeCp1252,
    decodeUtf16ByMark,
    isDoubleByteCodePage,
    singleByteCharCodes,
} from './codePage.js';

describe('cp1252CharCode', () => {
    it('maps the 0x80 to 0x9F range to Windows-1252 and leaves the rest as Latin-1', () => {
        expect([0x80, 0x85, 0x8c, 0x91, 0x92, 0x93, 0x94, 0x96, 0x97, 0x99, 0x9f].map(cp1252CharCode)).toEqual([
            0x20ac, 0x2026, 0x0152, 0x2018, 0x2019, 0x201c, 0x201d, 0x2013, 0x2014, 0x2122, 0x0178,
        ]);
        expect([0x41, 0xe9, 0xa0, 0x81, 0x8d, 0x8f, 0x90, 0x9d].map(cp1252CharCode)).toEqual([0x41, 0xe9, 0xa0, 0x81, 0x8d, 0x8f, 0x90, 0x9d]);
    });
});

describe('decodeCodePage', () => {
    it('decodes the code pages Office writes, and unknown ones as Windows-1252', () => {
        expect(decodeCodePage(Uint8Array.of(0xc1, 0xe8, 0xde, 0xed, 0xe1), 1253)).toBe('Αθήνα');
        expect(decodeCodePage(new TextEncoder().encode('Zoë'), 65001)).toBe('Zoë');
        expect(decodeCodePage(Uint8Array.of(0x80, 0x41), 12345)).toBe('€A');
        expect(decodeCp1252(Uint8Array.of(0x93, 0x68, 0x69, 0x94))).toBe('“hi”');
    });

    it('decodes long text without overflowing the call stack', () => {
        expect(decodeCp1252(new Uint8Array(100_000).fill(0x61))).toHaveLength(100_000);
    });
});

describe('codePageOfLanguage', () => {
    it('gives the ANSI code page of a language, Big5 for traditional Chinese and Mac Roman for the Macintosh character set', () => {
        expect([0x0409, 0x0408, 0x0419, 0x0415, 0x041f, 0x0411, 0x0804, 0x0404, 0x0c04].map((id) => codePageOfLanguage(id))).toEqual([
            1252, 1253, 1251, 1250, 1254, 932, 936, 950, 950,
        ]);
        expect(codePageOfLanguage(0x0409, 256)).toBe(10000);
        expect([932, 1253].map(isDoubleByteCodePage)).toEqual([true, false]);
    });
});

describe('singleByteCharCodes', () => {
    it('maps each byte of a single-byte code page, and Windows-1252 for the others', () => {
        const greek = singleByteCharCodes(1253);
        const fallback = singleByteCharCodes(932);

        expect(String.fromCharCode(...[0xc1, 0xe8, 0xde, 0xed, 0xe1, 0x41].map((byte) => greek[byte] ?? 0))).toBe('Αθήνα' + 'A');
        expect(String.fromCharCode(fallback[0x80] ?? 0, fallback[0xe9] ?? 0)).toBe('€é');
    });
});

describe('decodeUtf16ByMark', () => {
    it('reads UTF-16 by its byte order mark, and gives null without one', () => {
        expect(decodeUtf16ByMark(Uint8Array.of(0xff, 0xfe, 0x48, 0, 0x69, 0))).toBe('Hi');
        expect(decodeUtf16ByMark(Uint8Array.of(0xfe, 0xff, 0, 0x48, 0, 0x69))).toBe('Hi');
        expect(decodeUtf16ByMark(Uint8Array.of(0x48, 0x69))).toBeNull();
        expect(decodeUtf16ByMark(new Uint8Array())).toBeNull();
    });
});

describe('codePageOfLanguageTags', () => {
    it('takes the first of the browser\'s languages that has a code page of its own', () => {
        expect(codePageOfLanguageTags(['en-GB', 'el'])).toBe(1253);
        expect(codePageOfLanguageTags(['ru-RU'])).toBe(1251);
        expect(codePageOfLanguageTags(['pl', 'el'])).toBe(1250);
        expect(codePageOfLanguageTags(['zh-TW'])).toBe(950);
        expect(codePageOfLanguageTags(['zh-CN'])).toBe(936);
    });

    it('falls back to Windows-1252', () => {
        expect(codePageOfLanguageTags(['en-US', 'fr'])).toBe(1252);
        expect(codePageOfLanguageTags([])).toBe(1252);
    });
});
