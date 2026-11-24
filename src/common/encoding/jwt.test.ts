import { describe, expect, it } from 'vitest';
import { encodeBase64, encodeBase64Bytes } from './base64.js';
import { decodeJwt, jwtValidity, type DecodedJwt } from './jwt.js';

// The jwt.io sample: HS256, {"sub":"1234567890","name":"John Doe","iat":1516239022}.
const SAMPLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
const NOW = Date.UTC(2026, 10, 16, 12, 0, 0);

function segment(value: unknown): string {
    return encodeBase64(JSON.stringify(value), { urlSafe: true, padding: false });
}

function token(header: unknown, payload: unknown, signature = 'c2ln'): string {
    return `${segment(header)}.${segment(payload)}.${signature}`;
}

function decoded(text: string): DecodedJwt {
    const result = decodeJwt(text);

    if (result == null || !result.ok) {
        throw new Error(`Expected a decoded token, got ${JSON.stringify(result)}`);
    }

    return result.value;
}

function errorOf(text: string): { message: string; position: number | null } {
    const result = decodeJwt(text);

    if (result == null || result.ok) {
        throw new Error('Expected an error');
    }

    return { message: result.error.message, position: result.error.position };
}

describe('decodeJwt', () => {
    it('returns null for blank text', () => {
        expect(decodeJwt('')).toBeNull();
        expect(decodeJwt('  \n')).toBeNull();
        expect(decodeJwt('Bearer ')).toBeNull();
    });

    it('decodes the header, payload and signature length of a signed token', () => {
        const jwt = decoded(SAMPLE);

        expect(jwt.header).toEqual({ alg: 'HS256', typ: 'JWT' });
        expect(jwt.payload).toEqual({ sub: '1234567890', name: 'John Doe', iat: 1516239022 });
        expect(jwt.algorithm).toBe('HS256');
        expect(jwt.signatureLength).toBe(32);
        expect(jwt.headerJson).toBe('{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
        expect(jwt.timeClaims).toEqual([{ name: 'iat', seconds: 1516239022, raw: 1516239022 }]);
    });

    it('skips a Bearer prefix and whitespace such as line breaks', () => {
        const wrapped = `Bearer ${SAMPLE.slice(0, 30)}\n  ${SAMPLE.slice(30)}\n`;

        expect(decoded(wrapped).algorithm).toBe('HS256');
    });

    it('decodes UTF-8 claims', () => {
        expect(decoded(token({ alg: 'HS256' }, { name: 'Ελένη 😀' })).payload).toEqual({ name: 'Ελένη 😀' });
    });

    it('reads segments whose Base64URL needs - and _', () => {
        // "?>?" and "~~~" encode with the characters that differ from standard Base64.
        const payload = { a: '?>?~~~' };
        const encoded = segment(payload);

        expect(/[-_]/.test(encoded)).toBe(true);
        expect(decoded(`${segment({ alg: 'none' })}.${encoded}.`).payload).toEqual(payload);
    });

    it('accepts segments of every unpadded length, and padded ones', () => {
        for (const name of ['a', 'ab', 'abc', 'abcd']) {
            expect(decoded(token({ alg: 'HS256' }, { name })).payload).toEqual({ name });
        }

        const padded = encodeBase64(JSON.stringify({ alg: 'none' }), { urlSafe: true });

        expect(padded.endsWith('=')).toBe(true);
        expect(decoded(`${padded}.${segment({})}.`).algorithm).toBe('none');
    });

    it('accepts an unsecured token with an empty signature', () => {
        const jwt = decoded(`${segment({ alg: 'none' })}.${segment({ sub: 'x' })}.`);

        expect(jwt.algorithm).toBe('none');
        expect(jwt.signatureLength).toBe(0);
    });

    it('lists exp, nbf and iat, and marks ones that are not numbers', () => {
        const jwt = decoded(token({ alg: 'HS256' }, { iat: 10, exp: '20', nbf: 5 }));

        expect(jwt.timeClaims).toEqual([
            { name: 'exp', seconds: null, raw: '20' },
            { name: 'nbf', seconds: 5, raw: 5 },
            { name: 'iat', seconds: 10, raw: 10 },
        ]);
    });

    it('has no time claims when the payload is not an object', () => {
        expect(decoded(token({ alg: 'HS256' }, 'just a string')).timeClaims).toEqual([]);
    });

    it('rejects a token with the wrong number of parts', () => {
        expect(errorOf('abc.def').message).toBe("A JWT has three parts separated by '.', this has 2");
        expect(errorOf('abc').message).toContain('this has 1');
    });

    it('explains that a five-part token is encrypted', () => {
        expect(errorOf('a.b.c.d.e').message).toContain('JWE');
    });

    it('reports an empty header', () => {
        expect(errorOf(`.${segment({})}.`)).toEqual({ message: 'Header is empty', position: 0 });
    });

    it('reports a character that is not Base64URL where it is in the original text', () => {
        const header = segment({ alg: 'HS256' });

        expect(errorOf(`  ${header}.ab*d.sig`)).toEqual({
            message: "Payload: Invalid Base64 character '*'",
            position: 2 + header.length + 1 + 2,
        });
    });

    it('rejects the standard alphabet that JWTs do not use', () => {
        const header = segment({ alg: 'HS256' });
        const result = errorOf(`${header}.${segment({})}.ab+c`);

        expect(result.message).toBe("Signature: '+' is not Base64URL; use '-'");
        expect(result.position).toBe(header.length + 1 + segment({}).length + 1 + 2);
    });

    it('reports a segment one character too long', () => {
        // {"alg":"xy"} is 12 bytes, 16 characters, so one more leaves a single character over.
        expect(errorOf(`${segment({ alg: 'xy' })}a.${segment({})}.`).message).toContain('Header: Base64 cannot end with a single character');
    });

    it('reports a header that is not JSON, or not a JSON object', () => {
        const notJson = encodeBase64('{alg', { urlSafe: true, padding: false });

        expect(errorOf(`${notJson}.${segment({})}.`).message).toMatch(/^Header is not JSON: /);
        expect(errorOf(`${segment([1, 2])}.${segment({})}.`).message).toBe('Header is JSON but not an object');
    });

    it('reports a payload that is not JSON', () => {
        const notJson = encodeBase64('hello', { urlSafe: true, padding: false });

        expect(errorOf(`${segment({ alg: 'HS256' })}.${notJson}.`).message).toMatch(/^Payload is not JSON: /);
    });

    it('reports a payload that is not UTF-8', () => {
        const binary = encodeBase64Bytes(new Uint8Array([0x7b, 0xff, 0x7d]), { urlSafe: true, padding: false });

        expect(errorOf(`${segment({ alg: 'HS256' })}.${binary}.`).message).toBe('Payload is not UTF-8 text (byte 2)');
    });
});

describe('jwtValidity', () => {
    const at = (offsetSeconds: number): number => NOW / 1000 + offsetSeconds;

    it('is expired once exp has passed', () => {
        expect(jwtValidity([{ name: 'exp', seconds: at(-1), raw: 0 }], NOW)).toBe('expired');
        expect(jwtValidity([{ name: 'exp', seconds: at(0), raw: 0 }], NOW)).toBe('expired');
    });

    it('is active before exp', () => {
        expect(jwtValidity([{ name: 'exp', seconds: at(60), raw: 0 }], NOW)).toBe('active');
    });

    it('is not yet valid before nbf', () => {
        expect(jwtValidity([{ name: 'nbf', seconds: at(60), raw: 0 }, { name: 'exp', seconds: at(120), raw: 0 }], NOW)).toBe('not-yet-valid');
    });

    it('has no expiry without a numeric exp', () => {
        expect(jwtValidity([], NOW)).toBe('no-expiry');
        expect(jwtValidity([{ name: 'exp', seconds: null, raw: 'soon' }], NOW)).toBe('no-expiry');
    });
});
