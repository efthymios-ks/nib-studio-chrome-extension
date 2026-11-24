import { parseBase64 } from './base64.js';
import { fail, succeed, type CodecResult } from './codecResult.js';
import { findInvalidUtf8 } from './utf8.js';
import { errorMessage } from '../errorMessage.js';

export type JwtTimeClaimName = 'exp' | 'iat' | 'nbf';

export interface JwtTimeClaim {
    readonly name: JwtTimeClaimName;
    // Seconds since 1970 UTC, or null when the claim isn't a number.
    readonly seconds: number | null;
    readonly raw: unknown;
}

export interface DecodedJwt {
    readonly header: Readonly<Record<string, unknown>>;
    readonly payload: unknown;
    readonly headerJson: string;
    readonly payloadJson: string;
    readonly algorithm: string | null;
    readonly signatureLength: number;
    readonly timeClaims: ReadonlyArray<JwtTimeClaim>;
}

export type JwtValidity = 'expired' | 'not-yet-valid' | 'active' | 'no-expiry';

const TIME_CLAIMS: ReadonlyArray<JwtTimeClaimName> = ['exp', 'nbf', 'iat'];

interface Segment {
    readonly text: string;
    readonly start: number;
}

// Decodes a JWS compact token, header.payload.signature, without checking its signature.
// A leading "Bearer " and whitespace, such as line breaks from a log, are skipped. Returns null for blank text.
export function decodeJwt(text: string): CodecResult<DecodedJwt> | null {
    const token = compactToken(text);

    if (token.text === '') {
        return null;
    }

    const segments = splitSegments(token.text);

    if (segments.length === 5) {
        return fail('This is an encrypted token (JWE, five parts); its payload cannot be read without the key', null, 0);
    }

    if (segments.length !== 3) {
        return fail(`A JWT has three parts separated by '.', this has ${segments.length}`, null, 0);
    }

    const [headerSegment, payloadSegment, signatureSegment] = segments as [Segment, Segment, Segment];
    const toOriginal = (position: number | null): number | null => (position == null ? null : (token.positions[position] ?? null));

    const header = decodeJsonSegment(headerSegment, 'Header');

    if (!header.ok) {
        return fail(header.error.message, toOriginal(header.error.position), header.error.length);
    }

    if (typeof header.value !== 'object' || header.value == null || Array.isArray(header.value)) {
        return fail('Header is JSON but not an object', toOriginal(headerSegment.start), headerSegment.text.length);
    }

    const payload = decodeJsonSegment(payloadSegment, 'Payload');

    if (!payload.ok) {
        return fail(payload.error.message, toOriginal(payload.error.position), payload.error.length);
    }

    const signature = parseBase64(signatureSegment.text, { urlOnly: true });

    if (!signature.ok) {
        const position = signature.error.position == null ? null : signatureSegment.start + signature.error.position;

        return fail(`Signature: ${signature.error.message}`, toOriginal(position), signature.error.length);
    }

    const headerObject = header.value as Record<string, unknown>;

    return succeed({
        header: headerObject,
        payload: payload.value,
        headerJson: JSON.stringify(headerObject, null, 2),
        payloadJson: JSON.stringify(payload.value, null, 2),
        algorithm: typeof headerObject['alg'] === 'string' ? headerObject['alg'] : null,
        signatureLength: signature.value.length,
        timeClaims: readTimeClaims(payload.value),
    });
}

// Whether the token's exp and nbf claims allow it at nowMs.
export function jwtValidity(timeClaims: ReadonlyArray<JwtTimeClaim>, nowMs: number): JwtValidity {
    const seconds = (name: JwtTimeClaimName): number | null => timeClaims.find((claim) => claim.name === name)?.seconds ?? null;
    const expires = seconds('exp');
    const notBefore = seconds('nbf');

    if (expires != null && expires * 1000 <= nowMs) {
        return 'expired';
    }

    if (notBefore != null && notBefore * 1000 > nowMs) {
        return 'not-yet-valid';
    }

    return expires == null ? 'no-expiry' : 'active';
}

// The token without whitespace or a Bearer prefix, and where each of its characters was in the original text.
function compactToken(text: string): { readonly text: string; readonly positions: number[] } {
    const bearer = /^\s*bearer\s+/i.exec(text);
    const start = bearer?.[0].length ?? 0;
    const characters: string[] = [];
    const positions: number[] = [];

    for (let index = start; index < text.length; index += 1) {
        const character = text.charAt(index);

        if (/\s/.test(character)) {
            continue;
        }

        characters.push(character);
        positions.push(index);
    }

    return { text: characters.join(''), positions };
}

function splitSegments(token: string): Segment[] {
    const segments: Segment[] = [];
    let start = 0;

    for (const part of token.split('.')) {
        segments.push({ text: part, start });
        start += part.length + 1;
    }

    return segments;
}

function decodeJsonSegment(segment: Segment, name: string): CodecResult<unknown> {
    if (segment.text === '') {
        return fail(`${name} is empty`, segment.start, 0);
    }

    const bytes = parseBase64(segment.text, { urlOnly: true });

    if (!bytes.ok) {
        const position = bytes.error.position == null ? null : segment.start + bytes.error.position;

        return fail(`${name}: ${bytes.error.message}`, position, bytes.error.length);
    }

    const invalidByte = findInvalidUtf8(bytes.value);

    if (invalidByte != null) {
        return fail(`${name} is not UTF-8 text (byte ${invalidByte + 1})`, segment.start, segment.text.length);
    }

    try {
        return succeed(JSON.parse(new TextDecoder().decode(bytes.value)) as unknown);
    }
    catch (error) {
        const reason = errorMessage(error);

        return fail(`${name} is not JSON: ${reason}`, segment.start, segment.text.length);
    }
}

function readTimeClaims(payload: unknown): JwtTimeClaim[] {
    if (typeof payload !== 'object' || payload == null || Array.isArray(payload)) {
        return [];
    }

    const claims = payload as Record<string, unknown>;

    return TIME_CLAIMS
        .filter((name) => Object.hasOwn(claims, name))
        .map((name) => {
            const raw = claims[name];

            return { name, raw, seconds: typeof raw === 'number' && Number.isFinite(raw) ? raw : null };
        });
}
