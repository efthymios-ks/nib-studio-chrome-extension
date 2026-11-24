import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeBase64 } from '../../common/encoding/base64.js';
import { settleAsync } from '../testing/testHelpers.js';
import { lastToast, mountCard, pressEnter, stubClipboard, typeInto, type MountedCard } from '../testing/toolCardHarness.js';
import { buildJwtCard } from './jwtCard.js';

const NOW = Date.UTC(2026, 10, 16, 12, 0, 0);
const NOW_SECONDS = NOW / 1000;
const SAMPLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

const mounted: MountedCard[] = [];

function segment(value: unknown): string {
    return encodeBase64(JSON.stringify(value), { urlSafe: true, padding: false });
}

function mount(): MountedCard {
    const card = mountCard(buildJwtCard);
    mounted.push(card);

    return card;
}

function decode(card: MountedCard, token: string): void {
    const area = card.element.querySelector('textarea') as HTMLTextAreaElement;
    typeInto(area, token);
    pressEnter(area);
}

function claims(card: MountedCard): Array<[string, string]> {
    const terms = [...card.element.querySelectorAll('.jwt-claims dt')].map((term) => term.textContent ?? '');
    const values = [...card.element.querySelectorAll('.jwt-claims dd')].map((value) => value.textContent ?? '');

    return terms.map((term, index) => [term, values[index] ?? '']);
}

function result(card: MountedCard): HTMLElement {
    return card.element.querySelector('.jwt-result') as HTMLElement;
}

function error(card: MountedCard): HTMLElement {
    return card.element.querySelector('.tool-message') as HTMLElement;
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});

afterEach(() => {
    for (const card of mounted.splice(0)) {
        card.unmount();
    }

    document.querySelector('.toast-stack')?.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('buildJwtCard', () => {
    it('says the signature is not verified and shows nothing until Enter', () => {
        const card = mount();
        const area = card.element.querySelector('textarea') as HTMLTextAreaElement;

        expect(card.element.querySelector('.tool-card-header .badge')?.textContent).toBe('Signature not verified');
        expect(card.element.querySelector(`label[for="${area.id}"]`)?.textContent).toBe('Token');

        typeInto(area, SAMPLE);
        expect(result(card).hidden).toBe(true);
    });

    it('decodes the header and payload as formatted JSON on Enter', () => {
        const card = mount();

        decode(card, SAMPLE);

        const [header, payload] = [...card.element.querySelectorAll('.jwt-json')].map((block) => block.textContent);
        expect(result(card).hidden).toBe(false);
        expect(header).toBe('{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
        expect(payload).toBe('{\n  "sub": "1234567890",\n  "name": "John Doe",\n  "iat": 1516239022\n}');
        expect(card.element.querySelector('.jwt-signature')?.textContent).toBe('HS256 · 32-byte signature, not verified');
        expect(card.element.querySelector('.jwt-validity')?.textContent).toBe('No expiry');
    });

    it('shows exp, nbf and iat as local dates and says when an expired token expired', () => {
        const card = mount();
        const expires = NOW_SECONDS - 2 * 86_400;

        decode(card, `${segment({ alg: 'HS256' })}.${segment({ exp: expires, iat: expires - 3600, nbf: 'soon' })}.c2ln`);

        const rows = claims(card);
        expect(rows.map(([term]) => term)).toEqual(['Expires (exp)', 'Not before (nbf)', 'Issued (iat)']);
        expect(rows[0]?.[1]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC[+-]\d{2}:\d{2} · 2 days ago$/);
        expect(rows[1]?.[1]).toBe('Not a number: "soon"');
        expect(card.element.querySelector('.jwt-validity')?.textContent).toBe('Expired 2 days ago');
        expect(card.element.querySelector<HTMLElement>('.jwt-validity')?.dataset['tone']).toBe('fail');
    });

    it('says when a token is still valid, and when it is not valid yet', () => {
        const card = mount();

        decode(card, `${segment({ alg: 'HS256' })}.${segment({ exp: NOW_SECONDS + 7200 })}.c2ln`);
        expect(card.element.querySelector('.jwt-validity')?.textContent).toBe('Not expired · expires in 2 hours');

        decode(card, `${segment({ alg: 'HS256' })}.${segment({ nbf: NOW_SECONDS + 60, exp: NOW_SECONDS + 120 })}.c2ln`);
        expect(card.element.querySelector('.jwt-validity')?.textContent).toBe('Not valid yet · starts in 1 minute');
    });

    it('notes an unsigned token', () => {
        const card = mount();

        decode(card, `${segment({ alg: 'none' })}.${segment({ sub: 'x' })}.`);

        expect(card.element.querySelector('.jwt-signature')?.textContent).toBe('Unsigned (alg none)');
    });

    it('explains why a token is invalid, where, and selects the place', () => {
        const card = mount();
        const area = card.element.querySelector('textarea') as HTMLTextAreaElement;

        decode(card, `${segment({ alg: 'HS256' })}.ab*d.sig`);

        expect(result(card).hidden).toBe(true);
        expect(error(card).textContent).toMatch(/^Payload: Invalid Base64 character '\*' at position \d+\.$/);
        expect(area.selectionEnd! - area.selectionStart!).toBe(1);
        expect(area.value.charAt(area.selectionStart ?? 0)).toBe('*');

        decode(card, 'not-a-token');
        expect(error(card).textContent).toBe("A JWT has three parts separated by '.', this has 1.");
    });

    it('clears on Enter with nothing pasted', () => {
        const card = mount();
        decode(card, SAMPLE);

        decode(card, '');

        expect(result(card).hidden).toBe(true);
        expect(error(card).hidden).toBe(true);
    });

    it('copies nothing when the header or payload JSON is clicked', async () => {
        const writeText = stubClipboard();
        const card = mount();
        decode(card, SAMPLE);
        const blocks = [...card.element.querySelectorAll<HTMLElement>('.jwt-json')];

        for (const block of blocks) {
            block.click();
            block.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }

        await settleAsync();

        expect(blocks.map((block) => block.hasAttribute('title'))).toEqual([false, false]);
        expect(writeText).not.toHaveBeenCalled();
        expect(lastToast()).toBeNull();
    });

    it('lets the keyboard reach the JSON, and Ctrl+C there takes all of it', () => {
        const card = mount();
        decode(card, SAMPLE);
        const payload = card.element.querySelectorAll<HTMLElement>('.jwt-json')[1] as HTMLElement;
        window.getSelection()?.removeAllRanges();

        payload.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));

        expect(payload.tabIndex).toBe(0);
        expect(window.getSelection()?.toString()).toBe(payload.textContent);
    });
});
