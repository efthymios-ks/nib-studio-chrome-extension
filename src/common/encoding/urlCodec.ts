import { fail, succeed, type CodecResult } from './codecResult.js';
import { findInvalidUtf8, findUnpairedSurrogate } from './utf8.js';

// Percent-encoding of a URL component, as encodeURIComponent does it.
export function encodeUrlComponent(text: string): CodecResult<string> {
    const unpaired = findUnpairedSurrogate(text);

    if (unpaired != null) {
        return fail('Half of a surrogate pair cannot be percent-encoded', unpaired);
    }

    return succeed(encodeURIComponent(text));
}

// decodeURIComponent, with the place of a malformed `%` sequence or of escapes that aren't UTF-8.
// `+` stays a plus sign, as decodeURIComponent leaves it.
export function decodeUrlComponent(text: string): CodecResult<string> {
    let index = 0;

    while (index < text.length) {
        if (text.charAt(index) !== '%') {
            index += 1;
            continue;
        }

        const run = readEscapeRun(text, index);

        if (!run.ok) {
            return run;
        }

        const invalidByte = findInvalidUtf8(run.value.bytes);

        if (invalidByte != null) {
            const position = index + invalidByte * 3;

            return fail(`${text.slice(position, position + 3)} is not part of valid UTF-8`, position, 3);
        }

        index = run.value.end;
    }

    return succeed(decodeURIComponent(text));
}

interface EscapeRun {
    readonly bytes: Uint8Array;
    readonly end: number;
}

// Consecutive %XX escapes from start, which together must spell whole UTF-8 characters.
function readEscapeRun(text: string, start: number): CodecResult<EscapeRun> {
    const bytes: number[] = [];
    let index = start;

    while (text.charAt(index) === '%') {
        const digits = text.slice(index + 1, index + 3);

        if (!/^[0-9a-fA-F]{2}$/.test(digits)) {
            return fail("Malformed % sequence: '%' must be followed by two hex digits", index, 1 + digits.length);
        }

        bytes.push(Number.parseInt(digits, 16));
        index += 3;
    }

    return succeed({ bytes: Uint8Array.from(bytes), end: index });
}
