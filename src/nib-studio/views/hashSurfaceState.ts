import { encodeBase64 } from '../../common/encoding/base64.js';
import type { CodecId } from '../../common/encoding/codecs.js';
import type { CodecResult } from '../../common/encoding/codecResult.js';
import type { DecodedJwt } from '../../common/encoding/jwt.js';
import type { DigestFormat } from '../../common/hash/digestFormat.js';
import type { Digests } from '../../common/hash/hash.js';
import type { HmacAlgorithm } from '../../common/hash/hmac.js';

// Everything the Hash & encode cards hold lives in memory only, for as long as the studio tab is open:
// keys, tokens and texts can be sensitive, so none of it is written to storage or disk.

export type HashSource =
    | { readonly kind: 'text'; readonly text: string; readonly byteLength: number }
    | { readonly kind: 'file'; readonly name: string; readonly size: number };

export interface HashState {
    // The text area as typed, which may run ahead of the digests until Enter.
    text: string;
    source: HashSource | null;
    digests: Digests | null;
    format: DigestFormat;
    // The file being hashed, with the share done from 0 to 1.
    pending: { readonly name: string; readonly size: number; readonly progress: number } | null;
    error: string | null;
    // Bumped by every computation, so a slower earlier one can't overwrite a later result.
    run: number;
    abort: AbortController | null;
}

export interface VerifyState {
    draft: string;
    // What was in the field at the last Enter; checked again whenever the digests change.
    submitted: string;
}

export type KeyEncoding = 'text' | 'hex' | 'base64';

export interface PaneMessage {
    readonly text: string;
    readonly tone: 'fail' | 'warn' | 'muted';
}

export interface HmacState {
    key: string;
    keyEncoding: KeyEncoding;
    message: string;
    signatures: ReadonlyMap<HmacAlgorithm, Uint8Array> | null;
    format: DigestFormat;
    notice: PaneMessage | null;
    run: number;
}

export type CodecSide = 'plain' | 'encoded';

export interface CodecState {
    codec: CodecId;
    plain: string;
    encoded: string;
    urlSafe: boolean;
    padding: boolean;
    // The side last typed in, which a change of codec or option converts from.
    source: CodecSide;
    // The side the last conversion wrote, shaded until it is edited.
    output: CodecSide | null;
    messages: Record<CodecSide, PaneMessage | null>;
}

export interface JwtState {
    draft: string;
    decoded: CodecResult<DecodedJwt> | null;
}

export interface HashSurfaceState {
    readonly hash: HashState;
    readonly verify: VerifyState;
    readonly hmac: HmacState;
    readonly codec: CodecState;
    readonly jwt: JwtState;
}

export const SAMPLE_HASH_TEXT = 'Nib Studio';
export const SAMPLE_CODEC_TEXT = 'Nib Studio works fully offline.';

export function createHashSurfaceState(): HashSurfaceState {
    return {
        hash: {
            text: SAMPLE_HASH_TEXT,
            source: null,
            digests: null,
            format: 'hex',
            pending: null,
            error: null,
            run: 0,
            abort: null,
        },
        verify: { draft: '', submitted: '' },
        hmac: {
            key: '',
            keyEncoding: 'text',
            message: '',
            signatures: null,
            format: 'hex',
            notice: null,
            run: 0,
        },
        codec: {
            codec: 'base64',
            plain: SAMPLE_CODEC_TEXT,
            encoded: encodeBase64(SAMPLE_CODEC_TEXT),
            urlSafe: false,
            padding: true,
            source: 'plain',
            output: 'encoded',
            messages: { plain: null, encoded: null },
        },
        jwt: { draft: '', decoded: null },
    };
}
