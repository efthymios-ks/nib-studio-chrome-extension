import { encodeBase64Bytes } from '../encoding/base64.js';
import { bytesToHex } from '../encoding/hex.js';

export type DigestFormat = 'hex' | 'HEX' | 'base64';

export interface DigestFormatOption {
    readonly id: DigestFormat;
    readonly label: string;
}

export const DIGEST_FORMATS: ReadonlyArray<DigestFormatOption> = [
    { id: 'hex', label: 'hex' },
    { id: 'HEX', label: 'HEX' },
    { id: 'base64', label: 'Base64' },
];

export function formatDigest(bytes: Uint8Array, format: DigestFormat): string {
    if (format === 'base64') {
        return encodeBase64Bytes(bytes);
    }

    return bytesToHex(bytes, format === 'HEX');
}

export function isDigestFormat(value: string): value is DigestFormat {
    return DIGEST_FORMATS.some((option) => option.id === value);
}
