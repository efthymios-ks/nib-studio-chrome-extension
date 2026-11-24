import { describe, expect, it } from 'vitest';
import { SAMPLE_CODEC_TEXT, SAMPLE_HASH_TEXT, createHashSurfaceState } from './hashSurfaceState.js';

describe('createHashSurfaceState', () => {
    it('starts with the sample texts, the codec sample encoded and no digests', () => {
        const state = createHashSurfaceState();

        expect(state.hash.text).toBe(SAMPLE_HASH_TEXT);
        expect(state.hash.digests).toBeNull();
        expect(state.hash.format).toBe('hex');
        expect(state.codec.plain).toBe(SAMPLE_CODEC_TEXT);
        expect(state.codec.encoded).toBe(btoa(SAMPLE_CODEC_TEXT));
        expect(state.codec.output).toBe('encoded');
        expect(state.codec.codec).toBe('base64');
        expect(state.codec.padding).toBe(true);
        expect(state.codec.urlSafe).toBe(false);
        expect(state.hmac.key).toBe('');
        expect(state.jwt.decoded).toBeNull();
    });

    it('gives each call its own state', () => {
        const first = createHashSurfaceState();
        const second = createHashSurfaceState();
        first.codec.messages.plain = { text: 'x', tone: 'fail' };

        expect(second.codec.messages.plain).toBeNull();
    });
});
