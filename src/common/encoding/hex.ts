import { fail, quoteCharacterAt, succeed, type CodecResult } from './codecResult.js';

export function bytesToHex(bytes: Uint8Array, upperCase = false): string {
    const digits: string[] = [];

    for (const byte of bytes) {
        digits.push(byte.toString(16).padStart(2, '0'));
    }

    const hex = digits.join('');

    return upperCase ? hex.toUpperCase() : hex;
}

// Hex digits in either case; spaces, line breaks, `:` and `-` between them, and `0x` before a group, are skipped.
export function parseHex(text: string): CodecResult<Uint8Array> {
    const nibbles = new Uint8Array(text.length);
    let count = 0;
    let lastDigitIndex = -1;

    for (let index = 0; index < text.length; index += 1) {
        const character = text.charAt(index);

        if (isSeparator(character)) {
            continue;
        }

        if (character === '0' && /[xX]/.test(text.charAt(index + 1)) && (index === 0 || isSeparator(text.charAt(index - 1)))) {
            index += 1;
            continue;
        }

        const value = Number.parseInt(character, 16);

        if (Number.isNaN(value)) {
            return fail(`Invalid hex character ${quoteCharacterAt(text, index)}`, index, (text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1);
        }

        nibbles[count] = value;
        count += 1;
        lastDigitIndex = index;
    }

    if (count % 2 === 1) {
        return fail(`Odd number of hex digits; ${quoteCharacterAt(text, lastDigitIndex)} has no pair`, lastDigitIndex);
    }

    const bytes = new Uint8Array(count / 2);

    for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = ((nibbles[index * 2] ?? 0) << 4) | (nibbles[index * 2 + 1] ?? 0);
    }

    return succeed(bytes);
}

function isSeparator(character: string): boolean {
    return character === ':' || character === '-' || /\s/.test(character);
}
