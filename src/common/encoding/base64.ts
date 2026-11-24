import { fail, quoteCharacterAt, succeed, type CodecResult } from './codecResult.js';

export interface Base64EncodeOptions {
    readonly urlSafe?: boolean;
    readonly padding?: boolean;
}

export interface Base64ParseOptions {
    // Accepts only the URL-safe alphabet, `-` and `_`, as JWTs require.
    readonly urlOnly?: boolean;
}

const STANDARD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URL_SAFE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const SEXTET_VALUES = buildSextetValues();

export function encodeBase64(text: string, options?: Base64EncodeOptions): string {
    return encodeBase64Bytes(new TextEncoder().encode(text), options);
}

export function encodeBase64Bytes(bytes: Uint8Array, options?: Base64EncodeOptions): string {
    const alphabet = options?.urlSafe === true ? URL_SAFE_ALPHABET : STANDARD_ALPHABET;
    const padding = options?.padding ?? true;
    const characters: string[] = [];

    for (let index = 0; index < bytes.length; index += 3) {
        const first = bytes[index] ?? 0;
        const second = bytes[index + 1] ?? 0;
        const third = bytes[index + 2] ?? 0;
        const remaining = bytes.length - index;

        characters.push(alphabet.charAt(first >> 2));
        characters.push(alphabet.charAt(((first & 0x03) << 4) | (second >> 4)));
        characters.push(remaining > 1 ? alphabet.charAt(((second & 0x0f) << 2) | (third >> 6)) : (padding ? '=' : ''));
        characters.push(remaining > 2 ? alphabet.charAt(third & 0x3f) : (padding ? '=' : ''));
    }

    return characters.join('');
}

// Decodes either alphabet, with or without padding, ignoring whitespace; reports the first character at fault.
export function parseBase64(text: string, options?: Base64ParseOptions): CodecResult<Uint8Array> {
    const sextets = new Uint8Array(text.length);
    let count = 0;
    let paddingCount = 0;
    let firstPaddingIndex = -1;
    let lastDataIndex = -1;

    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);

        if (isWhitespace(code)) {
            continue;
        }

        if (code === 0x3d) {
            if (paddingCount === 0) {
                firstPaddingIndex = index;
            }

            paddingCount += 1;

            if (paddingCount > 2) {
                return fail('Too many "=" padding characters', index);
            }

            continue;
        }

        if (paddingCount > 0) {
            return fail(`Unexpected ${quoteCharacterAt(text, index)} after the "=" padding`, index);
        }

        const value = code < 128 ? (SEXTET_VALUES[code] ?? -1) : -1;

        if (value < 0) {
            return fail(`Invalid Base64 character ${quoteCharacterAt(text, index)}`, index, characterLength(text, index));
        }

        if (options?.urlOnly === true && (code === 0x2b || code === 0x2f)) {
            return fail(`${quoteCharacterAt(text, index)} is not Base64URL; use ${code === 0x2b ? "'-'" : "'_'"}`, index);
        }

        sextets[count] = value;
        count += 1;
        lastDataIndex = index;
    }

    if (count % 4 === 1) {
        return fail('Base64 cannot end with a single character in its last group of four', lastDataIndex);
    }

    if (paddingCount > 0 && (count + paddingCount) % 4 !== 0) {
        return fail('Wrong number of "=" padding characters', firstPaddingIndex, paddingCount);
    }

    return succeed(sextetsToBytes(sextets, count));
}

// Text from Base64 of UTF-8 bytes; throws on input that isn't Base64.
export function decodeBase64(encoded: string): string {
    const result = parseBase64(encoded);

    if (!result.ok) {
        throw new Error(`Invalid Base64: ${result.error.message}.`);
    }

    return new TextDecoder().decode(result.value);
}

function sextetsToBytes(sextets: Uint8Array, count: number): Uint8Array {
    const bytes = new Uint8Array(Math.floor((count * 6) / 8));
    let byteIndex = 0;

    for (let index = 0; index < count; index += 4) {
        const first = sextets[index] ?? 0;
        const second = sextets[index + 1] ?? 0;
        const third = sextets[index + 2] ?? 0;
        const fourth = sextets[index + 3] ?? 0;
        const remaining = count - index;

        bytes[byteIndex] = (first << 2) | (second >> 4);
        byteIndex += 1;

        if (remaining > 2) {
            bytes[byteIndex] = ((second & 0x0f) << 4) | (third >> 2);
            byteIndex += 1;
        }

        if (remaining > 3) {
            bytes[byteIndex] = ((third & 0x03) << 6) | fourth;
            byteIndex += 1;
        }
    }

    return bytes;
}

function buildSextetValues(): Int8Array {
    const values = new Int8Array(128).fill(-1);

    for (let index = 0; index < 64; index += 1) {
        values[STANDARD_ALPHABET.charCodeAt(index)] = index;
        values[URL_SAFE_ALPHABET.charCodeAt(index)] = index;
    }

    return values;
}

function isWhitespace(code: number): boolean {
    return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c;
}

function characterLength(text: string, index: number): number {
    return (text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
}
