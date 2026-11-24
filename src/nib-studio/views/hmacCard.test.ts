import { afterEach, describe, expect, it, vi } from 'vitest';
import { settleAsync } from '../testing/testHelpers.js';
import { digestOf, lastToast, mountCard, pressEnter, stubClipboard, typeInto, type MountedCard } from '../testing/toolCardHarness.js';
import { buildHmacCard } from './hmacCard.js';

// RFC 2202 and RFC 4231 test case 2: key "Jefe", data "what do ya want for nothing?".
const MESSAGE = 'what do ya want for nothing?';
const EXPECTED = {
    'HMAC-SHA-1': 'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79',
    'HMAC-SHA-256': '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    'HMAC-SHA-384': 'af45d2e376484031617f78d2b58a6b1b9c7ef464f5a01b47e42ec3736322445e8e2240ca5e69e2c78b3239ecfab21649',
    'HMAC-SHA-512': '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737',
};

const mounted: MountedCard[] = [];

function mount(): MountedCard {
    const card = mountCard(buildHmacCard);
    mounted.push(card);

    return card;
}

function fields(card: MountedCard): { key: HTMLInputElement; message: HTMLTextAreaElement; encoding: HTMLSelectElement; format: HTMLSelectElement } {
    const selects = [...card.element.querySelectorAll('select')];

    return {
        key: card.element.querySelector('input') as HTMLInputElement,
        message: card.element.querySelector('textarea') as HTMLTextAreaElement,
        encoding: selects[0] as HTMLSelectElement,
        format: selects[1] as HTMLSelectElement,
    };
}

function notice(card: MountedCard): HTMLElement {
    return card.element.querySelector('.tool-message') as HTMLElement;
}

afterEach(() => {
    for (const card of mounted.splice(0)) {
        card.unmount();
    }

    document.querySelector('.toast-stack')?.remove();
    vi.unstubAllGlobals();
});

describe('buildHmacCard', () => {
    it('labels the key, its encoding and the message', () => {
        const card = mount();
        const { key, message, encoding } = fields(card);

        expect(card.element.querySelector(`label[for="${key.id}"]`)?.textContent).toBe('Key');
        expect(card.element.querySelector(`label[for="${message.id}"]`)?.textContent).toBe('Message');
        expect(encoding.getAttribute('aria-label')).toBe('Key encoding');
        expect([...encoding.options].map((option) => option.textContent)).toEqual(['Text', 'Hex', 'Base64']);
    });

    it('signs with all four algorithms on Enter in the message', async () => {
        const card = mount();
        const { key, message } = fields(card);
        typeInto(key, 'Jefe');
        typeInto(message, MESSAGE);
        await settleAsync();
        expect(digestOf(card.element, 'HMAC-SHA-256')).toBe('—');

        pressEnter(message);
        await settleAsync();

        for (const [label, expected] of Object.entries(EXPECTED)) {
            expect(digestOf(card.element, label)).toBe(expected);
        }
    });

    it('signs on Enter in the key too', async () => {
        const card = mount();
        const { key, message } = fields(card);
        typeInto(message, MESSAGE);
        typeInto(key, 'Jefe');

        pressEnter(key);
        await settleAsync();

        expect(digestOf(card.element, 'HMAC-SHA-1')).toBe(EXPECTED['HMAC-SHA-1']);
    });

    it('reads the key as hex or Base64 when asked', async () => {
        const card = mount();
        const { key, message, encoding } = fields(card);
        typeInto(message, MESSAGE);
        encoding.value = 'hex';
        encoding.dispatchEvent(new Event('change'));
        typeInto(key, '4a 65 66 65');

        pressEnter(key);
        await settleAsync();
        expect(digestOf(card.element, 'HMAC-SHA-256')).toBe(EXPECTED['HMAC-SHA-256']);

        encoding.value = 'base64';
        encoding.dispatchEvent(new Event('change'));
        typeInto(key, 'SmVmZQ==');
        pressEnter(key);
        await settleAsync();
        expect(digestOf(card.element, 'HMAC-SHA-256')).toBe(EXPECTED['HMAC-SHA-256']);
    });

    it('reports a key that is not valid in its encoding and selects the fault', async () => {
        const card = mount();
        const { key, message, encoding } = fields(card);
        typeInto(message, MESSAGE);
        encoding.value = 'hex';
        encoding.dispatchEvent(new Event('change'));
        typeInto(key, 'abxz');

        pressEnter(key);
        await settleAsync();

        expect(notice(card).textContent).toBe("Key: Invalid hex character 'x' at position 3.");
        expect(notice(card).dataset['tone']).toBe('fail');
        expect([key.selectionStart, key.selectionEnd]).toEqual([2, 3]);
        expect(digestOf(card.element, 'HMAC-SHA-256')).toBe('—');
    });

    it('asks for a key when there is only a message', async () => {
        const card = mount();
        const { message } = fields(card);
        typeInto(message, MESSAGE);

        pressEnter(message);
        await settleAsync();

        expect(notice(card).textContent).toBe('Enter a key to sign the message.');
    });

    it('clears the signatures on Enter with both fields empty', async () => {
        const card = mount();
        const { key, message } = fields(card);
        typeInto(key, 'Jefe');
        typeInto(message, MESSAGE);
        pressEnter(message);
        await settleAsync();

        typeInto(key, '');
        typeInto(message, '');
        pressEnter(message);
        await settleAsync();

        expect(digestOf(card.element, 'HMAC-SHA-256')).toBe('—');
        expect(notice(card).hidden).toBe(true);
    });

    it('formats signatures as HEX or Base64, and copies nothing when a row is clicked', async () => {
        const writeText = stubClipboard();
        const card = mount();
        const { key, message, format } = fields(card);
        typeInto(key, 'Jefe');
        typeInto(message, MESSAGE);
        pressEnter(message);
        await settleAsync();

        format.value = 'HEX';
        format.dispatchEvent(new Event('change'));
        expect(digestOf(card.element, 'HMAC-SHA-1')).toBe(EXPECTED['HMAC-SHA-1'].toUpperCase());

        format.value = 'base64';
        format.dispatchEvent(new Event('change'));
        expect(digestOf(card.element, 'HMAC-SHA-256')).toBe('W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM=');

        card.element.querySelector<HTMLElement>('.digest-row[data-key="HMAC-SHA-256"]')?.click();
        await settleAsync();

        expect(writeText).not.toHaveBeenCalled();
        expect(lastToast()).toBeNull();
    });
});
