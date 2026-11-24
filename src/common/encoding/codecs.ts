import { encodeBase64, parseBase64 } from './base64.js';
import { succeed, type CodecError, type CodecResult } from './codecResult.js';
import { bytesToHex, parseHex } from './hex.js';
import { decodeHtmlEntities, encodeHtmlEntities, type EntityResolver } from './htmlEntities.js';
import { decodeUrlComponent, encodeUrlComponent } from './urlCodec.js';
import { decodeUtf8, encodeUtf8 } from './utf8.js';

export type CodecId = 'base64' | 'url' | 'hex' | 'html';

export interface CodecOptions {
    readonly urlSafe: boolean;
    readonly padding: boolean;
    readonly resolveEntity?: EntityResolver;
}

export interface Codec {
    readonly id: CodecId;
    readonly label: string;
    // What the encoded side is called, such as "Base64".
    readonly encodedLabel: string;
    readonly encode: (text: string, options: CodecOptions) => CodecResult<string>;
    readonly decode: (text: string, options: CodecOptions) => CodecResult<string>;
}

export const CODECS: ReadonlyArray<Codec> = [
    {
        id: 'base64',
        label: 'Base64',
        encodedLabel: 'Base64',
        encode: (text, options) => succeed(encodeBase64(text, { urlSafe: options.urlSafe, padding: options.padding })),
        decode: (text) => bytesToText(parseBase64(text)),
    },
    {
        id: 'url',
        label: 'URL',
        encodedLabel: 'URL-encoded',
        encode: (text) => encodeUrlComponent(text),
        decode: (text) => decodeUrlComponent(text),
    },
    {
        id: 'hex',
        label: 'Hex',
        encodedLabel: 'Hex',
        encode: (text) => succeed(bytesToHex(encodeUtf8(text))),
        decode: (text) => bytesToText(parseHex(text)),
    },
    {
        id: 'html',
        label: 'HTML entities',
        encodedLabel: 'HTML',
        encode: (text) => succeed(encodeHtmlEntities(text)),
        decode: (text, options) => decodeHtmlEntities(text, options.resolveEntity),
    },
];

export function findCodec(id: CodecId): Codec {
    return CODECS.find((codec) => codec.id === id) ?? (CODECS[0] as Codec);
}

// Decoded bytes as UTF-8 text; bytes that aren't UTF-8 still show, as U+FFFD, with a warning saying where.
function bytesToText(result: CodecResult<Uint8Array>): CodecResult<string> {
    if (!result.ok) {
        return result;
    }

    const decoded = decodeUtf8(result.value);

    if (decoded.invalidAt == null) {
        return succeed(decoded.text);
    }

    const warning: CodecError = {
        message: `Byte ${decoded.invalidAt + 1} of ${result.value.length} is not valid UTF-8 text; such bytes show as �`,
        position: null,
        length: 0,
    };

    return succeed(decoded.text, warning);
}
