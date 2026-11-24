import { describe, expect, it } from 'vitest';
import { decodeTextBytes, detectTextEncoding, encodeText, textEncodingLabel, type TextEncoding } from './textEncoding.js';

const GREEK = 'Παλιές σημειώσεις: η αναφορά καλύπτει τρεις περιοχές.\r\nΆλλη γραμμή, με ό,τι χρειάζεται.\r\n';
const WESTERN = 'Le café est très chaud; à bientôt, naïve Zoë! Größe: 5 cm.\n';
const CYRILLIC = 'Привет, как дела? Это старый файл в кодировке Windows.\n';

function bytesIn(text: string, encoding: TextEncoding): Uint8Array {
    const encoded = encodeText(text, encoding);

    if (!encoded.ok) {
        throw new Error(`${encoding} can't hold ${encoded.unrepresentable.join('')}`);
    }

    return encoded.bytes;
}

describe('detectTextEncoding', () => {
    it('reads a byte order mark first', () => {
        expect(detectTextEncoding(Uint8Array.of(0xef, 0xbb, 0xbf, 0x61))).toBe('utf-8-bom');
        expect(detectTextEncoding(Uint8Array.of(0xff, 0xfe, 0x61, 0x00))).toBe('utf-16le');
        expect(detectTextEncoding(Uint8Array.of(0xfe, 0xff, 0x00, 0x61))).toBe('utf-16be');
    });

    it('takes bytes that all read as UTF-8 as UTF-8, plain ASCII included', () => {
        expect(detectTextEncoding(new TextEncoder().encode(GREEK), 1252)).toBe('utf-8');
        expect(detectTextEncoding(new TextEncoder().encode('plain text\n'), 1253)).toBe('utf-8');
        expect(detectTextEncoding(new Uint8Array(0))).toBe('utf-8');
    });

    it.each<[string, string, TextEncoding]>([
        ['Greek', GREEK, 'windows-1253'],
        ['Western European', WESTERN, 'windows-1252'],
        ['Cyrillic', CYRILLIC, 'windows-1251'],
    ])('finds %s text in its code page, whatever the browser\'s languages', (_name, text, encoding) => {
        for (const preferred of [1252, 1253, 1251]) {
            expect(detectTextEncoding(bytesIn(text, encoding), preferred)).toBe(encoding);
        }
    });

    it('finds Greek in capitals only, which reads as well in Cyrillic, as Greek unless the browser speaks a Cyrillic language', () => {
        const capitals = bytesIn('ΠΑΛΙΕΣ ΣΗΜΕΙΩΣΕΙΣ\n', 'windows-1253');

        expect(detectTextEncoding(capitals, 1252)).toBe('windows-1253');
        expect(detectTextEncoding(capitals, 1253)).toBe('windows-1253');
        expect(detectTextEncoding(capitals, 1251)).toBe('windows-1251');
    });

    it('leaves a tie to the code page of the browser\'s languages, and Windows-1252 last', () => {
        // A degree sign reads the same in all three.
        const degrees = Uint8Array.of(0x32, 0x35, 0xb0, 0x43, 0x0a);

        expect(detectTextEncoding(degrees, 1253)).toBe('windows-1253');
        expect(detectTextEncoding(degrees, 1251)).toBe('windows-1251');
        expect(detectTextEncoding(degrees, 1252)).toBe('windows-1252');
        expect(detectTextEncoding(degrees, 932)).toBe('windows-1252');
    });

    it('weighs the browser\'s own single-byte code page too, such as Central European', () => {
        const polish = bytesIn('Zażółć gęślą jaźń.\n', 'windows-1250');

        expect(detectTextEncoding(polish, 1250)).toBe('windows-1250');
    });
});

describe('decodeTextBytes', () => {
    it('opens Greek Windows-1253 text as Greek, line endings untouched', () => {
        const decoded = decodeTextBytes(bytesIn(GREEK, 'windows-1253'), 1252);

        expect(decoded).toEqual({ text: GREEK, encoding: 'windows-1253' });
    });

    it('drops the byte order mark from the text, and keeps it in the encoding', () => {
        expect(decodeTextBytes(Uint8Array.of(0xef, 0xbb, 0xbf, 0x61, 0x62))).toEqual({ text: 'ab', encoding: 'utf-8-bom' });
        expect(decodeTextBytes(Uint8Array.of(0xff, 0xfe, 0xb1, 0x03))).toEqual({ text: 'α', encoding: 'utf-16le' });
    });
});

describe('encodeText', () => {
    it.each<[TextEncoding, string]>([
        ['windows-1253', GREEK],
        ['windows-1252', WESTERN],
        ['windows-1251', CYRILLIC],
        ['utf-8', GREEK],
        ['utf-8-bom', GREEK],
        ['utf-16le', GREEK],
        ['utf-16be', GREEK],
    ])('saves %s text back byte for byte as it was read', (encoding, text) => {
        const bytes = bytesIn(text, encoding);
        const decoded = decodeTextBytes(bytes, 1252);

        expect(decoded.text).toBe(text);
        expect(bytesIn(decoded.text, decoded.encoding)).toEqual(bytes);
    });

    it('names the characters a code page can\'t hold, each once, instead of writing something else', () => {
        expect(encodeText('Καλό ü, ü and ☃', 'windows-1253')).toEqual({ ok: false, unrepresentable: ['ü', '☃'] });
    });

    it('writes a UTF-8 byte order mark only for UTF-8 with BOM', () => {
        expect(bytesIn('a', 'utf-8')).toEqual(Uint8Array.of(0x61));
        expect(bytesIn('a', 'utf-8-bom')).toEqual(Uint8Array.of(0xef, 0xbb, 0xbf, 0x61));
    });
});

describe('textEncodingLabel', () => {
    it('names each encoding as the status bar shows it', () => {
        expect(textEncodingLabel('utf-8')).toBe('UTF-8');
        expect(textEncodingLabel('utf-8-bom')).toBe('UTF-8 with BOM');
        expect(textEncodingLabel('utf-16le')).toBe('UTF-16 LE');
        expect(textEncodingLabel('windows-1253')).toBe('Windows-1253');
    });
});
