import { describe, expect, it } from 'vitest';
import { encodeText } from './textEncoding.js';
import { looksLikeText, looksLikeTextFileAsync, TEXT_SNIFF_BYTES } from './textSniff.js';

function utf8(text: string): Uint8Array<ArrayBuffer> {
    return new TextEncoder().encode(text);
}

function bytes(...values: ReadonlyArray<number>): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(values);
}

describe('looksLikeText', () => {
    it('takes valid UTF-8 as text, in any script, with or without a byte order mark', () => {
        expect(looksLikeText(utf8('def main():\r\n\treturn 0\n'))).toBe(true);
        expect(looksLikeText(utf8('Καλημέρα, κόσμε. Привет. 你好. 🙂'))).toBe(true);
        expect(looksLikeText(bytes(0xef, 0xbb, 0xbf, ...utf8('with a BOM')))).toBe(true);
    });

    it('takes an empty file as text', () => {
        expect(looksLikeText(new Uint8Array())).toBe(true);
    });

    it('takes UTF-16 with a byte order mark as text, NULs and all', () => {
        expect(looksLikeText(bytes(0xff, 0xfe, 0x68, 0x00, 0x69, 0x00))).toBe(true);
        expect(looksLikeText(bytes(0xfe, 0xff, 0x00, 0x68, 0x00, 0x69))).toBe(true);
    });

    it('takes bytes with a NUL as binary, however much text is around it', () => {
        expect(looksLikeText(utf8(`${'plain text '.repeat(100)}\u0000`))).toBe(false);
        expect(looksLikeText(bytes(0x68, 0x00, 0x69, 0x00))).toBe(false);
    });

    it('takes bytes that are mostly invalid UTF-8 as binary', () => {
        expect(looksLikeText(bytes(0x89, 0xfe, 0xc0, 0xaf, 0x41, 0xff, 0x80, 0xf8))).toBe(false);
    });

    it('takes bytes that are mostly control characters as binary', () => {
        expect(looksLikeText(bytes(0x01, 0x02, 0x03, 0x41, 0x04, 0x05, 0x7f, 0x42))).toBe(false);
        expect(looksLikeText(utf8('\u0085\u0086\u0087a'))).toBe(false);
    });

    it('keeps text with a few stray bytes, form feeds and escape sequences as text', () => {
        expect(looksLikeText(bytes(...utf8('caf'), 0xe9, ...utf8(' au lait, s'), 0xe9, ...utf8('rieux')))).toBe(true);
        expect(looksLikeText(utf8('\u001b[31mred\u001b[0m\fnext page\u000b'))).toBe(true);
    });

    it('takes text in a single-byte code page as text, such as Greek in Windows-1253, though it isn\'t UTF-8', () => {
        const inCodePage = (text: string, encoding: 'windows-1253' | 'windows-1251'): Uint8Array => {
            const encoded = encodeText(text, encoding);

            return encoded.ok ? encoded.bytes : new Uint8Array(0);
        };

        expect(looksLikeText(inCodePage('Παλιές σημειώσεις για τη συνάντηση της Τρίτης.\r\n', 'windows-1253'))).toBe(true);
        expect(looksLikeText(inCodePage('Привет, это старый файл.\n', 'windows-1251'))).toBe(true);
    });

    it('takes bytes of no code page\'s words as binary, even without a NUL', () => {
        const noise = Uint8Array.from({ length: 4096 }, (_, index) => 1 + ((index * 7919 + 13) % 255));

        expect(looksLikeText(noise)).toBe(false);
    });

    it('counts overlong forms, surrogates and code points past U+10FFFF as invalid', () => {
        expect(looksLikeText(bytes(0xc0, 0x80, 0xe0, 0x80, 0x80, 0xed, 0xa0, 0x80, 0xf4, 0x90, 0x80, 0x80))).toBe(false);
    });

    it('ignores a character cut in two at the end of the sample', () => {
        expect(looksLikeText(utf8('αβγ').subarray(0, 5))).toBe(true);
    });
});

describe('looksLikeTextFileAsync', () => {
    it('reads only the first 8 KB, so a NUL further on doesn\'t count', async () => {
        const text = utf8('a'.repeat(TEXT_SNIFF_BYTES));
        const file = new Blob([text, bytes(0x00)]);

        expect(TEXT_SNIFF_BYTES).toBe(8 * 1024);
        expect(await looksLikeTextFileAsync(file)).toBe(true);
        expect(await looksLikeTextFileAsync(new Blob([bytes(0x00), text]))).toBe(false);
    });
});
