import { codePageOfLanguageTags, isDoubleByteCodePage } from '../office/codePage.js';

// How a text file's bytes are read and written back: UTF-8, with or without its byte order mark, UTF-16 behind one,
// or a Windows single-byte code page, such as Windows-1253 for Greek text saved by older Windows programs.
export type TextEncoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | `windows-${number}`;

// Bytes ready to write.
export type EncodedBytes = Uint8Array<ArrayBuffer>;

export type EncodedText =
    | { readonly ok: true; readonly bytes: EncodedBytes }
    | { readonly ok: false; readonly unrepresentable: ReadonlyArray<string> };

export interface DecodedText {
    readonly text: string;
    readonly encoding: TextEncoding;
}

// The code pages a file that isn't UTF-8 is weighed against: Greek, Western and Cyrillic.
const SINGLE_BYTE_CANDIDATES: ReadonlyArray<number> = [1253, 1252, 1251];

const WESTERN_CODE_PAGE = 1252;

const BYTE_ORDER_MARKS: ReadonlyArray<{ readonly bytes: ReadonlyArray<number>; readonly encoding: TextEncoding }> = [
    { bytes: [0xef, 0xbb, 0xbf], encoding: 'utf-8-bom' },
    { bytes: [0xff, 0xfe], encoding: 'utf-16le' },
    { bytes: [0xfe, 0xff], encoding: 'utf-16be' },
];

const FIXED_LABELS: Readonly<Record<string, string>> = Object.freeze({
    'utf-8': 'UTF-8',
    'utf-8-bom': 'UTF-8 with BOM',
    'utf-16le': 'UTF-16 LE',
    'utf-16be': 'UTF-16 BE',
});

// How much a word read in a code page counts for or against it, per character outside ASCII.
const PLAUSIBLE_WORD_WEIGHT = 1;
const IMPLAUSIBLE_WORD_WEIGHT = -2;
// How much of a file the code pages are weighed on.
const SCORED_BYTES = 256 * 1024;
// A byte the code page leaves undefined, or reads as a control character, all but rules it out.
const UNDEFINED_BYTE_WEIGHT = -4;
// Western European words hold a few accented letters among plain ones, never a run of three.
const LATIN_ACCENTED_RUN = /[^\u0000-\u007f]{3,}/u;
// Greek writes the final sigma only at the end of a word, and upsilon and iota with both dialytika and tonos
// hardly ever; Cyrillic read as Greek puts them everywhere, as they stand for its `т`, `а` and `А`.
const GREEK_FINAL_SIGMA_INSIDE = /ς\p{L}/u;
const GREEK_RARE_LETTERS = /[ΰΐ]/u;

// The name the status bar and the dialogs give an encoding, such as `Windows-1253`.
export function textEncodingLabel(encoding: TextEncoding): string {
    return FIXED_LABELS[encoding] ?? `Windows-${encoding.slice('windows-'.length)}`;
}

// The code page text files from older Windows programs are likely in, from the languages the browser is set to.
export function preferredCodePage(): number {
    const languages = globalThis.navigator?.languages ?? [globalThis.navigator?.language ?? ''];

    return codePageOfLanguageTags(languages);
}

// The encoding of a text file's bytes: its byte order mark, else UTF-8 when every byte reads as UTF-8,
// else the single-byte code page its non-ASCII bytes read best in. A tie goes to the code page of the browser's
// languages, then to Windows-1252.
export function detectTextEncoding(bytes: Uint8Array, preferred: number = preferredCodePage()): TextEncoding {
    const marked = BYTE_ORDER_MARKS.find((mark) => mark.bytes.every((byte, index) => bytes[index] === byte));

    if (marked != null) {
        return marked.encoding;
    }

    if (isUtf8(bytes)) {
        return 'utf-8';
    }

    const candidates = singleByteCandidates(preferred);
    let best = candidates[0] ?? WESTERN_CODE_PAGE;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const codePage of candidates) {
        const score = scoreCodePage(bytes, codePage);

        if (score > bestScore) {
            best = codePage;
            bestScore = score;
        }
    }

    return `windows-${best}`;
}

// Tab, line feed, vertical tab, form feed, carriage return and escape, which coloured logs use, are at home in text.
const TEXT_CONTROL_BYTES: ReadonlySet<number> = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1b]);

// Control characters may make up at most this share of single-byte text.
const MAX_CONTROL_SHARE = 0.02;

// Whether bytes that aren't UTF-8 read as text in a single-byte code page: next to no control characters,
// and words that read well in at least one of the code pages weighed.
export function looksLikeSingleByteText(bytes: Uint8Array, preferred: number = preferredCodePage()): boolean {
    const controls = bytes.filter((byte) => (byte < 0x20 && !TEXT_CONTROL_BYTES.has(byte)) || byte === 0x7f).length;

    if (controls > bytes.length * MAX_CONTROL_SHARE) {
        return false;
    }

    return singleByteCandidates(preferred).some((codePage) => scoreCodePage(bytes, codePage) > 0);
}

// The text of a file's bytes, in the encoding detectTextEncoding finds, without its byte order mark.
export function decodeTextBytes(bytes: Uint8Array, preferred?: number): DecodedText {
    const encoding = detectTextEncoding(bytes, preferred);

    return { text: decodeWith(bytes, encoding), encoding };
}

export async function readTextBlobAsync(blob: Blob, preferred?: number): Promise<DecodedText> {
    return decodeTextBytes(new Uint8Array(await blob.arrayBuffer()), preferred);
}

// The bytes of a text in an encoding, or the characters it can't hold, each once, in the order they first come.
export function encodeText(text: string, encoding: TextEncoding): EncodedText {
    if (encoding === 'utf-8' || encoding === 'utf-8-bom') {
        const body = new TextEncoder().encode(text);

        return { ok: true, bytes: encoding === 'utf-8' ? body : concat(Uint8Array.of(0xef, 0xbb, 0xbf), body) };
    }

    if (encoding === 'utf-16le' || encoding === 'utf-16be') {
        return { ok: true, bytes: encodeUtf16(text, encoding === 'utf-16le') };
    }

    return encodeSingleByte(text, Number(encoding.slice('windows-'.length)));
}

function decodeWith(bytes: Uint8Array, encoding: TextEncoding): string {
    if (encoding === 'utf-8-bom') {
        return new TextDecoder('utf-8').decode(bytes.subarray(3));
    }

    if (encoding === 'utf-16le' || encoding === 'utf-16be') {
        return new TextDecoder(encoding).decode(bytes.subarray(2));
    }

    return new TextDecoder(encoding).decode(bytes);
}

function isUtf8(bytes: Uint8Array): boolean {
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);

        return true;
    }
    catch {
        return false;
    }
}

// The code pages weighed, in the order a tie goes: the browser's own single-byte code page, then Windows-1252,
// then the rest.
function singleByteCandidates(preferred: number): number[] {
    const own = isDoubleByteCodePage(preferred) || !isKnownCodePage(preferred) ? [] : [preferred];

    return [...new Set([...own, WESTERN_CODE_PAGE, ...SINGLE_BYTE_CANDIDATES])];
}

function isKnownCodePage(codePage: number): boolean {
    try {
        new TextDecoder(`windows-${codePage}`);

        return true;
    }
    catch {
        return false;
    }
}

// The character of each byte in a code page, null where it defines none or gives a control character.
const characterTables = new Map<number, ReadonlyArray<string | null>>();

function charactersOf(codePage: number): ReadonlyArray<string | null> {
    const known = characterTables.get(codePage);

    if (known != null) {
        return known;
    }

    const decoder = new TextDecoder(`windows-${codePage}`);
    const table = Array.from({ length: 256 }, (_, byte) => {
        const character = decoder.decode(Uint8Array.of(byte));
        const code = character.charCodeAt(0);
        const isControl = byte >= 0x80 && (code === 0xfffd || (code >= 0x80 && code <= 0x9f));

        return isControl ? null : character;
    });
    characterTables.set(codePage, table);

    return table;
}

// How well the non-ASCII bytes read in a code page: words in one script and in one of the usual letter cases
// count for it, words that mix scripts or cases, or Latin words crowded with accented letters, against it.
// The start of a large file is enough to tell.
function scoreCodePage(bytes: Uint8Array, codePage: number): number {
    const table = charactersOf(codePage);
    const letters = lettersOf(codePage);
    let score = 0;
    let word = '';

    const endWord = (): void => {
        score += scoreWord(word);
        word = '';
    };

    for (const byte of bytes.subarray(0, SCORED_BYTES)) {
        const character = table[byte];

        if (character == null) {
            score += UNDEFINED_BYTE_WEIGHT;
            endWord();
            continue;
        }

        if (letters[byte] === true) {
            word += character;
            continue;
        }

        endWord();
    }

    endWord();

    return score;
}

// Which bytes of a code page are letters.
const letterTables = new Map<number, ReadonlyArray<boolean>>();

function lettersOf(codePage: number): ReadonlyArray<boolean> {
    const known = letterTables.get(codePage);

    if (known != null) {
        return known;
    }

    const table = charactersOf(codePage).map((character) => character != null && /\p{L}/u.test(character));
    letterTables.set(codePage, table);

    return table;
}

function scoreWord(word: string): number {
    const outsideAscii = [...word].filter((character) => character.charCodeAt(0) >= 0x80).length;

    if (outsideAscii === 0) {
        return 0;
    }

    const weight = isPlausibleWord(word) ? PLAUSIBLE_WORD_WEIGHT : IMPLAUSIBLE_WORD_WEIGHT;

    return weight * outsideAscii;
}

function isPlausibleWord(word: string): boolean {
    const scripts = new Set([...word].map(scriptOf));

    if (scripts.size > 1) {
        return false;
    }

    if (!hasUsualCase(word)) {
        return false;
    }

    if (scripts.has('greek') && (GREEK_FINAL_SIGMA_INSIDE.test(word) || GREEK_RARE_LETTERS.test(word))) {
        return false;
    }

    return !scripts.has('latin') || !LATIN_ACCENTED_RUN.test(word);
}

function scriptOf(character: string): string {
    if (/\p{Script=Greek}/u.test(character)) {
        return 'greek';
    }

    if (/\p{Script=Cyrillic}/u.test(character)) {
        return 'cyrillic';
    }

    return /\p{Script=Latin}/u.test(character) ? 'latin' : 'other';
}

// All lower case, all upper case, or a capital and then lower case.
function hasUsualCase(word: string): boolean {
    const rest = word.slice(1);

    return word === word.toLowerCase() || word === word.toUpperCase() || rest === rest.toLowerCase();
}

function encodeUtf16(text: string, isLittleEndian: boolean): EncodedBytes {
    const bytes = new Uint8Array(2 + text.length * 2);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 0xfeff, isLittleEndian);

    for (let index = 0; index < text.length; index += 1) {
        view.setUint16(2 + index * 2, text.charCodeAt(index), isLittleEndian);
    }

    return bytes;
}

function encodeSingleByte(text: string, codePage: number): EncodedText {
    const table = charactersOf(codePage);
    const byteOf = new Map<string, number>();
    table.forEach((character, byte) => {
        if (character != null && !byteOf.has(character)) {
            byteOf.set(character, byte);
        }
    });

    const bytes: number[] = [];
    const missing = new Set<string>();

    for (const character of text) {
        const byte = byteOf.get(character);

        if (byte == null) {
            missing.add(character);
            continue;
        }

        bytes.push(byte);
    }

    return missing.size > 0 ? { ok: false, unrepresentable: [...missing] } : { ok: true, bytes: Uint8Array.from(bytes) };
}

function concat(first: Uint8Array, second: Uint8Array): EncodedBytes {
    const joined = new Uint8Array(first.length + second.length);
    joined.set(first);
    joined.set(second, first.length);

    return joined;
}
