import { bytesEqual } from '../binary/bytes.js';
import { parseBase64 } from '../encoding/base64.js';
import { fail, succeed, type CodecResult } from '../encoding/codecResult.js';
import { parseHex } from '../encoding/hex.js';
import { DIGEST_LENGTHS, HASH_ALGORITHMS, type HashAlgorithm } from './hash.js';

export type DigestEncoding = 'hex' | 'base64';

export interface ExpectedDigest {
    readonly encoding: DigestEncoding;
    readonly bytes: Uint8Array;
    // The algorithm a prefix such as `sha256-` or `SHA256 (file) =` names, or null.
    readonly namedAlgorithm: HashAlgorithm | null;
}

export interface DigestCandidate {
    readonly label: string;
    readonly bytes: Uint8Array;
}

interface DigestShape {
    readonly pattern: RegExp;
    readonly accepts?: (digest: string) => boolean;
}

const ALGORITHM = '(md5|sha-?1|sha-?256|sha-?384|sha-?512)';
const HEX_DIGEST_LENGTHS = new Set(Object.values(DIGEST_LENGTHS).map((length) => length * 2));

// The ways a published checksum is written, tried in order; group 1 names the algorithm, group 2 is the digest.
const DIGEST_SHAPES: ReadonlyArray<DigestShape> = [
    // BSD and OpenSSL: `SHA256 (file.zip) = 9f86…`.
    { pattern: new RegExp(`^${ALGORITHM}\\s*\\(.*\\)\\s*=\\s*(\\S+)$`, 'id') },
    // Subresource Integrity `sha384-…`, webhook signatures `sha256=…` and OpenSSH `SHA256:…`.
    { pattern: new RegExp(`^${ALGORITHM}\\s*[-:=]\\s*(\\S+)$`, 'id') },
    // sha256sum and friends: `9f86…  file.zip`, or `9f86… *file.zip` in binary mode.
    { pattern: /^()([0-9a-f]+)\s+\*?\S.*$/id, accepts: (digest) => HEX_DIGEST_LENGTHS.has(digest.length) },
    { pattern: /^()([\s\S]*)$/d },
];

// Reads a digest as hex, in either case, or as Base64 in either alphabet. Text made only of hex digits is
// read as hex. Returns null for blank text.
export function parseExpectedDigest(text: string): CodecResult<ExpectedDigest> | null {
    const trimmed = text.trim();

    if (trimmed === '') {
        return null;
    }

    const leading = text.length - text.trimStart().length;

    for (const shape of DIGEST_SHAPES) {
        const match = shape.pattern.exec(trimmed);
        const digest = match?.[2];
        const start = match?.indices?.[2]?.[0];

        if (match == null || digest == null || start == null || shape.accepts?.(digest) === false) {
            continue;
        }

        return parseDigestText(digest, leading + start, toAlgorithm(match[1] ?? ''));
    }

    return null;
}

export function algorithmsForLength(byteLength: number): HashAlgorithm[] {
    return HASH_ALGORITHMS.filter((algorithm) => DIGEST_LENGTHS[algorithm] === byteLength);
}

export function findMatches(expected: ExpectedDigest, candidates: ReadonlyArray<DigestCandidate>): string[] {
    return candidates
        .filter((candidate) => bytesEqual(candidate.bytes, expected.bytes))
        .map((candidate) => candidate.label);
}

function parseDigestText(digest: string, offset: number, namedAlgorithm: HashAlgorithm | null): CodecResult<ExpectedDigest> {
    const isHex = /^[0-9a-f:\s]+$/i.test(digest);
    const parsed = isHex ? parseHex(digest) : parseBase64(digest);

    if (!parsed.ok) {
        const { message, position, length } = parsed.error;
        const prefix = isHex ? '' : 'Not hex or Base64: ';

        return fail(`${prefix}${message}`, position == null ? null : offset + position, length);
    }

    if (parsed.value.length === 0) {
        return fail('No digest after the algorithm name', offset);
    }

    return succeed({ encoding: isHex ? 'hex' : 'base64', bytes: parsed.value, namedAlgorithm });
}

function toAlgorithm(name: string): HashAlgorithm | null {
    const normalized = name.toUpperCase().replace(/^SHA-?/, 'SHA-');

    return HASH_ALGORITHMS.find((algorithm) => algorithm === normalized) ?? null;
}
