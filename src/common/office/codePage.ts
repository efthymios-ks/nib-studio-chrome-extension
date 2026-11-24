// Windows-1252 differs from Latin-1 only in 0x80–0x9F; the five bytes it leaves undefined keep their own code.
const CP1252_HIGH: ReadonlyArray<number> = [
    0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
    0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
    0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
    0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

// The character a Windows-1252 byte stands for, as Word's 8-bit text pieces store it.
export function cp1252CharCode(byte: number): number {
    return byte >= 0x80 && byte <= 0x9f ? CP1252_HIGH[byte - 0x80] ?? byte : byte;
}

export function decodeCp1252(bytes: Uint8Array): string {
    const codes = new Array<number>(bytes.length);

    for (let index = 0; index < bytes.length; index += 1) {
        codes[index] = cp1252CharCode(bytes[index] ?? 0);
    }

    return charCodesToString(codes);
}

function charCodesToString(codes: ReadonlyArray<number>): string {
    const chunks: string[] = [];

    // Spread in slices, so a long text never overflows the argument limit.
    for (let start = 0; start < codes.length; start += 8192) {
        chunks.push(String.fromCharCode(...codes.slice(start, start + 8192)));
    }

    return chunks.join('');
}

// Text after a UTF-16 byte order mark, or null when the bytes start with none.
export function decodeUtf16ByMark(bytes: Uint8Array): string | null {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }

    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    }

    return null;
}

// Labels TextDecoder knows for the Windows code pages Office writes.
const CODE_PAGE_LABELS: ReadonlyMap<number, string> = new Map([
    [65001, 'utf-8'],
    [1200, 'utf-16le'],
    [1201, 'utf-16be'],
    [874, 'windows-874'],
    [932, 'shift_jis'],
    [936, 'gbk'],
    [949, 'euc-kr'],
    [950, 'big5'],
    [1250, 'windows-1250'],
    [1251, 'windows-1251'],
    [1253, 'windows-1253'],
    [1254, 'windows-1254'],
    [1255, 'windows-1255'],
    [1256, 'windows-1256'],
    [1257, 'windows-1257'],
    [1258, 'windows-1258'],
    [10000, 'macintosh'],
    [20866, 'koi8-r'],
    [28591, 'iso-8859-1'],
    [28592, 'iso-8859-2'],
    [28595, 'iso-8859-5'],
    [28597, 'iso-8859-7'],
]);

// The Windows ANSI code page of each primary language that doesn't write in Windows-1252, by its LCID's low 10 bits.
const LANGUAGE_CODE_PAGES: ReadonlyMap<number, number> = new Map([
    [0x01, 1256],
    [0x02, 1251],
    [0x04, 936],
    [0x05, 1250],
    [0x08, 1253],
    [0x0d, 1255],
    [0x0e, 1250],
    [0x11, 932],
    [0x12, 949],
    [0x15, 1250],
    [0x18, 1250],
    [0x19, 1251],
    [0x1a, 1250],
    [0x1b, 1250],
    [0x1c, 1250],
    [0x1e, 874],
    [0x1f, 1254],
    [0x22, 1251],
    [0x23, 1251],
    [0x24, 1250],
    [0x25, 1257],
    [0x26, 1257],
    [0x27, 1257],
    [0x2a, 1258],
]);

// Chinese in Taiwan, Hong Kong and Macao writes Big5; elsewhere it writes GBK.
const TRADITIONAL_CHINESE: ReadonlySet<number> = new Set([0x0404, 0x0c04, 0x1404]);
const MAC_CHARACTER_SET = 256;

// The code page of 8-bit text that a Word 6 or Word 95 file marks with its language and character set.
export function codePageOfLanguage(languageId: number, characterSet = 0): number {
    if (characterSet === MAC_CHARACTER_SET) {
        return 10000;
    }

    if (TRADITIONAL_CHINESE.has(languageId)) {
        return 950;
    }

    return LANGUAGE_CODE_PAGES.get(languageId & 0x3ff) ?? 1252;
}

// The Windows language ID of each language code, for the languages whose ANSI code page isn't Windows-1252.
const LANGUAGE_IDS: ReadonlyMap<string, number> = new Map([
    ['ar', 0x01],
    ['bg', 0x02],
    ['zh', 0x04],
    ['cs', 0x05],
    ['el', 0x08],
    ['he', 0x0d],
    ['hu', 0x0e],
    ['ja', 0x11],
    ['ko', 0x12],
    ['pl', 0x15],
    ['ro', 0x18],
    ['ru', 0x19],
    ['hr', 0x1a],
    ['sk', 0x1b],
    ['sq', 0x1c],
    ['th', 0x1e],
    ['tr', 0x1f],
    ['uk', 0x22],
    ['be', 0x23],
    ['sl', 0x24],
    ['et', 0x25],
    ['lv', 0x26],
    ['lt', 0x27],
    ['vi', 0x2a],
]);

// Chinese written in Taiwan, Hong Kong and Macao, which uses Big5.
const TRADITIONAL_CHINESE_TAGS = /^zh-(?:tw|hk|mo|hant)\b/u;

// The ANSI code page that text files from Windows are likely written in, from the languages the browser is set to,
// such as Windows-1253 when Greek is among them: the first language with a code page of its own wins,
// as Windows writes 8-bit text in its system language's code page; Windows-1252 otherwise.
export function codePageOfLanguageTags(tags: ReadonlyArray<string>): number {
    for (const tag of tags) {
        const lower = tag.toLowerCase();

        if (TRADITIONAL_CHINESE_TAGS.test(lower)) {
            return 950;
        }

        const languageId = LANGUAGE_IDS.get(lower.split('-')[0] ?? '');

        if (languageId != null) {
            return codePageOfLanguage(languageId);
        }
    }

    return 1252;
}

const DOUBLE_BYTE_CODE_PAGES: ReadonlySet<number> = new Set([932, 936, 949, 950]);

// Whether a code page writes some characters in two bytes, so its text can't be read one byte at a time.
export function isDoubleByteCodePage(codePage: number): boolean {
    return DOUBLE_BYTE_CODE_PAGES.has(codePage);
}

// The character of each byte in a single-byte code page; Windows-1252 for one the runtime can't decode.
export function singleByteCharCodes(codePage: number): Uint16Array {
    const codes = Uint16Array.from({ length: 256 }, (_, byte) => cp1252CharCode(byte));
    const label = CODE_PAGE_LABELS.get(codePage);

    if (codePage === 1252 || label == null || isDoubleByteCodePage(codePage)) {
        return codes;
    }

    try {
        const decoder = new TextDecoder(label);

        for (let byte = 0; byte < 256; byte += 1) {
            const text = decoder.decode(Uint8Array.of(byte));

            if (text.length === 1 && text !== '�') {
                codes[byte] = text.charCodeAt(0);
            }
        }
    }
    catch {
        // A runtime without this decoder keeps Windows-1252.
    }

    return codes;
}

// Text in a Windows code page; one TextDecoder doesn't know reads as Windows-1252.
export function decodeCodePage(bytes: Uint8Array, codePage: number): string {
    const label = CODE_PAGE_LABELS.get(codePage);

    if (label != null) {
        try {
            return new TextDecoder(label).decode(bytes);
        }
        catch {
            // A runtime without this decoder falls back to Windows-1252.
        }
    }

    return decodeCp1252(bytes);
}
