import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dragEvent, fakeDataTransfer } from '../testing/fakeDataTransfer.js';
import { settleAsync } from '../testing/testHelpers.js';
import { digestOf, lastToast, pressEnter, stubClipboard, typeInto } from '../testing/toolCardHarness.js';

const SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const SHA256_NIB_STUDIO = '8968b4e11f24eaf2946f3ff70b6bca77332491f7bb39fe86be1c1104a547e980';

type Render = (container: HTMLElement) => void;

// The surface keeps its inputs in module state, so each test loads a fresh copy.
async function loadFreshAsync(): Promise<Render> {
    vi.resetModules();
    const { renderHashSurface } = await import('./hashSurface.js');

    return renderHashSurface;
}

function card(container: HTMLElement, id: string): HTMLElement {
    return container.querySelector(`.tool-card[data-card="${id}"]`) as HTMLElement;
}

describe('renderHashSurface', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
    });

    afterEach(() => {
        container.remove();
        document.querySelector('.toast-stack')?.remove();
        vi.unstubAllGlobals();
    });

    it('lays out the five cards in reading order', async () => {
        (await loadFreshAsync())(container);

        const cards = [...container.querySelectorAll<HTMLElement>('.hash-surface > .tool-card')];

        expect(cards.map((element) => element.dataset['card'])).toEqual(['hash', 'verify', 'hmac', 'codec', 'jwt']);
        expect(cards.map((element) => element.querySelector('h2')?.textContent)).toEqual(['Hash', 'Verify', 'HMAC', 'Encode / Decode', 'JWT decode']);
    });

    it('labels every field and uses no inline styles', async () => {
        (await loadFreshAsync())(container);

        const fields = [...container.querySelectorAll<HTMLElement>('input:not([type="file"]), textarea, select')];
        const unlabelled = fields.filter((field) => container.querySelector(`label[for="${field.id}"]`) == null && !field.hasAttribute('aria-label'));

        expect(fields.length).toBeGreaterThan(8);
        expect(unlabelled).toEqual([]);
        expect(container.querySelectorAll('[style]')).toHaveLength(0);
    });

    it('hashes the sample text on first view', async () => {
        (await loadFreshAsync())(container);
        await settleAsync();

        expect(digestOf(card(container, 'hash'), 'SHA-256')).toBe(SHA256_NIB_STUDIO);
        expect(digestOf(card(container, 'hash'), 'MD5')).toMatch(/^[0-9a-f]{32}$/);
    });

    it('keeps inputs and results when the surface is drawn again after another one', async () => {
        const render = await loadFreshAsync();
        render(container);
        await settleAsync();
        const hashText = card(container, 'hash').querySelector('textarea') as HTMLTextAreaElement;
        typeInto(hashText, 'abc');
        pressEnter(hashText);
        await settleAsync();
        typeInto(card(container, 'jwt').querySelector('textarea') as HTMLTextAreaElement, 'draft token');

        container.replaceChildren(document.createElement('div'));
        render(container);

        expect(card(container, 'hash').querySelector('textarea')).not.toBe(hashText);
        expect((card(container, 'hash').querySelector('textarea') as HTMLTextAreaElement).value).toBe('abc');
        expect(digestOf(card(container, 'hash'), 'SHA-256')).toBe(SHA256_ABC);
        expect((card(container, 'jwt').querySelector('textarea') as HTMLTextAreaElement).value).toBe('draft token');
        expect(container.querySelectorAll('.tool-card')).toHaveLength(5);
    });

    it('stays as it is, with focus and caret, when the app draws it while it is on screen', async () => {
        const render = await loadFreshAsync();
        render(container);
        const jwtText = card(container, 'jwt').querySelector('textarea') as HTMLTextAreaElement;
        jwtText.focus();
        typeInto(jwtText, 'draft token');
        jwtText.setSelectionRange(5, 5);

        render(container);

        expect(card(container, 'jwt').querySelector('textarea')).toBe(jwtText);
        expect(document.activeElement).toBe(jwtText);
        expect(jwtText.selectionStart).toBe(5);
        expect(container.querySelectorAll('.tool-card')).toHaveLength(5);
    });

    it('marks the row that Verify matches in the Hash card', async () => {
        (await loadFreshAsync())(container);
        await settleAsync();
        const hashText = card(container, 'hash').querySelector('textarea') as HTMLTextAreaElement;
        typeInto(hashText, 'abc');
        pressEnter(hashText);
        await settleAsync();

        const expected = card(container, 'verify').querySelector('input') as HTMLInputElement;
        typeInto(expected, SHA256_ABC.toUpperCase());
        pressEnter(expected);

        expect(card(container, 'verify').querySelector('.verify-verdict')?.textContent).toBe('Matches SHA-256');
        expect(card(container, 'hash').querySelector<HTMLElement>('.digest-row[data-key="SHA-256"]')?.dataset['match']).toBe('true');
        expect(card(container, 'hash').querySelector<HTMLElement>('.digest-row[data-key="MD5"]')?.dataset['match']).toBe('false');
    });

    it('checks Verify again when a file is dropped on the Hash card', async () => {
        (await loadFreshAsync())(container);
        await settleAsync();
        const expected = card(container, 'verify').querySelector('input') as HTMLInputElement;
        typeInto(expected, SHA256_ABC);
        pressEnter(expected);
        expect(card(container, 'verify').querySelector('.verify-verdict')?.textContent).toBe('No match');

        const { transfer } = fakeDataTransfer([new File(['abc'], 'abc.txt')]);
        card(container, 'hash').dispatchEvent(dragEvent('drop', transfer));
        await settleAsync();

        expect(card(container, 'verify').querySelector('.verify-verdict')?.textContent).toBe('Matches SHA-256');
    });

    it('shows the sample digest as text, and copies nothing when it is clicked', async () => {
        const writeText = stubClipboard();
        (await loadFreshAsync())(container);
        await settleAsync();

        card(container, 'hash').querySelector<HTMLElement>('.digest-row[data-key="SHA-256"]')?.click();
        await settleAsync();

        expect(digestOf(card(container, 'hash'), 'SHA-256')).toBe(SHA256_NIB_STUDIO);
        expect(writeText).not.toHaveBeenCalled();
        expect(lastToast()).toBeNull();
    });
});
