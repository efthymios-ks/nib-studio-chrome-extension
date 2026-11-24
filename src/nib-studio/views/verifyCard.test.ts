import { afterEach, describe, expect, it } from 'vitest';
import { digestAllAsync } from '../../common/hash/hash.js';
import { hmacAllAsync } from '../../common/hash/hmac.js';
import { mountCard, pressEnter, typeInto, type MountedCard } from '../testing/toolCardHarness.js';
import { createHashSurfaceState, type HashSurfaceState } from './hashSurfaceState.js';
import { buildVerifyCard, evaluateVerify, verifyMatches } from './verifyCard.js';

const SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const SHA256_ABC_BASE64 = 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=';
const MD5_ABC = '900150983cd24fb0d6963f7d28e17f72';
const HMAC_SHA256_JEFE = '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843';

const mounted: MountedCard[] = [];

async function hashedStateAsync(): Promise<HashSurfaceState> {
    const state = createHashSurfaceState();
    state.hash.digests = await digestAllAsync(new TextEncoder().encode('abc'));
    state.hash.source = { kind: 'text', text: 'abc', byteLength: 3 };

    return state;
}

async function mountHashedAsync(): Promise<MountedCard> {
    const digests = await digestAllAsync(new TextEncoder().encode('abc'));
    const card = mountCard(buildVerifyCard, (state) => {
        state.hash.digests = digests;
        state.hash.source = { kind: 'text', text: 'abc', byteLength: 3 };
    });
    mounted.push(card);

    return card;
}

function verify(card: MountedCard, text: string): void {
    const input = card.element.querySelector('input') as HTMLInputElement;
    typeInto(input, text);
    pressEnter(input);
}

function resultText(card: MountedCard): { verdict: string; lines: string[]; tone: string | undefined; hidden: boolean } {
    const result = card.element.querySelector<HTMLElement>('.verify-result') as HTMLElement;

    return {
        verdict: result.querySelector('.verify-verdict')?.textContent ?? '',
        lines: [...result.querySelectorAll<HTMLElement>('.tool-message')].filter((line) => !line.hidden).map((line) => line.textContent ?? ''),
        tone: result.dataset['tone'],
        hidden: result.hidden === true,
    };
}

afterEach(() => {
    for (const card of mounted.splice(0)) {
        card.unmount();
    }
});

describe('evaluateVerify', () => {
    it('is idle until a digest is submitted', async () => {
        expect(evaluateVerify(await hashedStateAsync())).toEqual({ kind: 'idle' });
    });

    it('needs something hashed to check against', () => {
        const state = createHashSurfaceState();
        state.verify.submitted = SHA256_ABC;

        expect(evaluateVerify(state).kind).toBe('nothing-hashed');
    });

    it('matches hex against every algorithm', async () => {
        const state = await hashedStateAsync();
        state.verify.submitted = ` ${MD5_ABC.toUpperCase()} `;

        const outcome = evaluateVerify(state);

        expect(outcome.kind === 'checked' && outcome.matches).toEqual(['MD5']);
        expect(verifyMatches(state)).toEqual(new Set(['MD5']));
    });

    it('matches Base64 too', async () => {
        const state = await hashedStateAsync();
        state.verify.submitted = SHA256_ABC_BASE64;

        const outcome = evaluateVerify(state);

        expect(outcome.kind === 'checked' && outcome.expected.encoding).toBe('base64');
        expect(outcome.kind === 'checked' && outcome.matches).toEqual(['SHA-256']);
    });

    it('matches HMAC signatures', async () => {
        const state = createHashSurfaceState();
        const encoder = new TextEncoder();
        state.hmac.signatures = await hmacAllAsync(encoder.encode('Jefe'), encoder.encode('what do ya want for nothing?'));
        state.verify.submitted = `sha256=${HMAC_SHA256_JEFE}`;

        const outcome = evaluateVerify(state);

        expect(outcome.kind === 'checked' && outcome.matches).toEqual(['HMAC-SHA-256']);
    });

    it('describes invalid input with its position', async () => {
        const state = await hashedStateAsync();
        state.verify.submitted = 'abc!';

        expect(evaluateVerify(state)).toEqual({
            kind: 'invalid',
            message: "Not hex or Base64: Invalid Base64 character '!' at position 4.",
            position: 3,
            length: 1,
        });
    });
});

describe('buildVerifyCard', () => {
    it('labels its field and hides the result until Enter', async () => {
        const card = await mountHashedAsync();
        const input = card.element.querySelector('input') as HTMLInputElement;

        expect(card.element.querySelector(`label[for="${input.id}"]`)?.textContent).toBe('Expected digest');
        expect(resultText(card).hidden).toBe(true);

        typeInto(input, SHA256_ABC);
        expect(resultText(card).hidden).toBe(true);
    });

    it('says which algorithm matches, with the encoding and length', async () => {
        const card = await mountHashedAsync();

        verify(card, `  ${SHA256_ABC.toUpperCase()}  `);

        expect(resultText(card)).toEqual({
            verdict: 'Matches SHA-256',
            lines: ['Hex · 32 bytes, the length of SHA-256 · digest of the text'],
            tone: 'ok',
            hidden: false,
        });
    });

    it('says No match, which algorithm the length suggests, and what that algorithm gives', async () => {
        const card = await mountHashedAsync();

        verify(card, '00'.repeat(32));

        expect(resultText(card)).toEqual({
            verdict: 'No match',
            lines: ['Hex · 32 bytes, the length of SHA-256', `SHA-256 of the text: ${SHA256_ABC}`],
            tone: 'fail',
            hidden: false,
        });
    });

    it('shows what the suggested algorithm gives in Base64 when the digest was Base64', async () => {
        const card = await mountHashedAsync();

        verify(card, 'A'.repeat(43) + '=');

        expect(resultText(card).lines[1]).toBe(`SHA-256 of the text: ${SHA256_ABC_BASE64}`);
    });

    it('notes a length no algorithm gives', async () => {
        const card = await mountHashedAsync();

        verify(card, 'abcd');

        expect(resultText(card).lines).toEqual(['Hex · 2 bytes, no algorithm here gives that length']);
    });

    it('reports invalid input and selects where it goes wrong', async () => {
        const card = await mountHashedAsync();
        const input = card.element.querySelector('input') as HTMLInputElement;

        verify(card, 'abc!');

        expect(resultText(card).verdict).toBe("Not hex or Base64: Invalid Base64 character '!' at position 4.");
        expect([input.selectionStart, input.selectionEnd]).toEqual([3, 4]);
    });

    it('clears the result on Enter with an empty field', async () => {
        const card = await mountHashedAsync();
        verify(card, SHA256_ABC);

        verify(card, '');

        expect(resultText(card).hidden).toBe(true);
    });

    it('checks again when the digests change', async () => {
        const card = await mountHashedAsync();
        verify(card, MD5_ABC);
        expect(resultText(card).verdict).toBe('Matches MD5');

        card.state.hash.digests = await digestAllAsync(new TextEncoder().encode('abd'));
        card.context.refresh();

        expect(resultText(card).verdict).toBe('No match');
    });

    it('asks for something to hash first', () => {
        const card = mountCard(buildVerifyCard);
        mounted.push(card);

        verify(card, MD5_ABC);

        expect(resultText(card).verdict).toBe('Nothing to check against yet');
    });

    it('names the file it checked against', async () => {
        const digests = await digestAllAsync(new TextEncoder().encode('abc'));
        const card = mountCard(buildVerifyCard, (state) => {
            state.hash.digests = digests;
            state.hash.source = { kind: 'file', name: 'release.zip', size: 2048 };
        });
        mounted.push(card);

        verify(card, `${SHA256_ABC}  release.zip`);

        expect(resultText(card).lines).toEqual(['Hex · 32 bytes, the length of SHA-256 · digest of release.zip (2 KB)']);
    });
});
