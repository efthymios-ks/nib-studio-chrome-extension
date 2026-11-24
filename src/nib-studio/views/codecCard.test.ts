import { afterEach, describe, expect, it, vi } from 'vitest';
import { settleAsync } from '../testing/testHelpers.js';
import { lastToast, mountCard, pressEnter, stubClipboard, typeInto, type MountedCard } from '../testing/toolCardHarness.js';
import { buildCodecCard } from './codecCard.js';

const mounted: MountedCard[] = [];

interface CodecParts {
    readonly plain: HTMLTextAreaElement;
    readonly encoded: HTMLTextAreaElement;
    readonly codec: HTMLSelectElement;
    readonly urlSafe: HTMLInputElement;
    readonly padding: HTMLInputElement;
    readonly message: (side: 'plain' | 'encoded') => HTMLElement;
    readonly encodedLabel: () => string;
}

function mount(): MountedCard & CodecParts {
    const card = mountCard(buildCodecCard);
    mounted.push(card);
    const pane = (side: string): HTMLElement => card.element.querySelector(`.codec-pane[data-side="${side}"]`) as HTMLElement;
    const checks = [...card.element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];

    return {
        ...card,
        plain: pane('plain').querySelector('textarea') as HTMLTextAreaElement,
        encoded: pane('encoded').querySelector('textarea') as HTMLTextAreaElement,
        codec: card.element.querySelector('select') as HTMLSelectElement,
        urlSafe: checks[0] as HTMLInputElement,
        padding: checks[1] as HTMLInputElement,
        message: (side) => pane(side).querySelector('.tool-message') as HTMLElement,
        encodedLabel: () => pane('encoded').querySelector('label')?.textContent ?? '',
    };
}

function pickCodec(card: CodecParts, id: string): void {
    card.codec.value = id;
    card.codec.dispatchEvent(new Event('change'));
}

function enter(field: HTMLTextAreaElement, text: string): void {
    typeInto(field, text);
    pressEnter(field);
}

afterEach(() => {
    for (const card of mounted.splice(0)) {
        card.unmount();
    }

    document.querySelector('.toast-stack')?.remove();
    vi.unstubAllGlobals();
});

describe('buildCodecCard', () => {
    it('opens on Base64 with the sample and its encoding filled in', () => {
        const card = mount();

        expect(card.plain.value).toBe('Nib Studio works fully offline.');
        expect(card.encoded.value).toBe(btoa('Nib Studio works fully offline.'));
        expect(card.encodedLabel()).toBe('Base64');
        expect([...card.codec.options].map((option) => option.textContent)).toEqual(['Base64', 'URL', 'Hex', 'HTML entities']);
    });

    it('labels both panes and points them at one hint', () => {
        const card = mount();
        const hint = document.getElementById(card.plain.getAttribute('aria-describedby') ?? '');

        expect(card.element.querySelector(`label[for="${card.plain.id}"]`)?.textContent).toBe('Text');
        expect(card.element.querySelector(`label[for="${card.encoded.id}"]`)?.textContent).toBe('Base64');
        expect(card.encoded.getAttribute('aria-describedby')).toBe(hint?.id);
        expect(hint?.textContent).toBe('Enter in Text encodes · Enter in Base64 decodes · Shift+Enter for a new line');
    });

    it('encodes on Enter in the text, not while typing', () => {
        const card = mount();
        typeInto(card.plain, 'hello');

        expect(card.encoded.value).toBe(btoa('Nib Studio works fully offline.'));

        pressEnter(card.plain);

        expect(card.encoded.value).toBe('aGVsbG8=');
        expect(card.encoded.dataset['output']).toBe('true');
        expect(card.plain.dataset['output']).toBe('false');
    });

    it('decodes on Enter in the encoded side', () => {
        const card = mount();

        enter(card.encoded, 'zrHPgCDwn5iA');

        expect(card.plain.value).toBe('απ 😀');
        expect(card.plain.dataset['output']).toBe('true');
    });

    it('keeps Shift+Enter for a new line', () => {
        const card = mount();
        typeInto(card.plain, 'one');

        const event = pressEnter(card.plain, { shiftKey: true });

        expect(event.defaultPrevented).toBe(false);
        expect(card.encoded.value).toBe(btoa('Nib Studio works fully offline.'));
    });

    it('clears the other side on Enter in an empty pane', () => {
        const card = mount();

        enter(card.plain, '');

        expect(card.encoded.value).toBe('');
        expect(card.encoded.dataset['output']).toBe('false');
    });

    it('applies URL-safe and Padding to the encoding', () => {
        const card = mount();
        enter(card.plain, '??>');

        card.urlSafe.checked = true;
        card.urlSafe.dispatchEvent(new Event('change'));
        expect(card.encoded.value).toBe('Pz8-');

        enter(card.plain, 'hello');
        card.padding.checked = false;
        card.padding.dispatchEvent(new Event('change'));
        expect(card.encoded.value).toBe('aGVsbG8');
    });

    it('reports invalid Base64 under the encoded pane, with its position, and selects it', () => {
        const card = mount();
        const before = card.plain.value;

        enter(card.encoded, 'aGV*bG8=');

        expect(card.message('encoded').textContent).toBe("Invalid Base64 character '*' at position 4.");
        expect(card.message('encoded').dataset['tone']).toBe('fail');
        expect(card.message('plain').hidden).toBe(true);
        expect([card.encoded.selectionStart, card.encoded.selectionEnd]).toEqual([3, 4]);
        expect(card.plain.value).toBe(before);
    });

    it('gives a line and column for errors in several lines', () => {
        const card = mount();

        enter(card.encoded, 'aGVs\nbG*8=');

        expect(card.message('encoded').textContent).toBe("Invalid Base64 character '*' at line 2, column 3.");
    });

    it('warns when decoded bytes are not UTF-8 text', () => {
        const card = mount();
        pickCodec(card, 'hex');

        enter(card.encoded, '61ff');

        expect(card.plain.value).toBe('a�');
        expect(card.message('encoded').dataset['tone']).toBe('warn');
        expect(card.message('encoded').textContent).toContain('Byte 2 of 2 is not valid UTF-8');
    });

    it('converts URL components and reports a malformed % sequence', () => {
        const card = mount();
        pickCodec(card, 'url');
        expect(card.encodedLabel()).toBe('URL-encoded');

        enter(card.plain, 'a b&c=d/é');
        expect(card.encoded.value).toBe('a%20b%26c%3Dd%2F%C3%A9');

        enter(card.encoded, 'a%2Gb');
        expect(card.message('encoded').textContent).toBe("Malformed % sequence: '%' must be followed by two hex digits at position 2.");
    });

    it('converts to and from hex and HTML entities', () => {
        const card = mount();
        pickCodec(card, 'hex');
        enter(card.plain, 'Hi');
        expect(card.encoded.value).toBe('4869');

        pickCodec(card, 'html');
        enter(card.plain, '<b>"x" & \'y\'</b>');
        expect(card.encoded.value).toBe('&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');

        enter(card.encoded, '&copy; &#x1F600; &bogus;');
        expect(card.message('encoded').textContent).toBe("Unknown entity '&bogus;' at position 18.");
    });

    it('converts again from the side last worked in when the codec changes', () => {
        const card = mount();
        enter(card.plain, 'Hi');

        pickCodec(card, 'hex');
        expect(card.encoded.value).toBe('4869');

        typeInto(card.encoded, 'Hi%21');
        pickCodec(card, 'url');
        expect(card.plain.value).toBe('Hi!');
    });

    it('copies nothing when the converted pane is clicked', async () => {
        const writeText = stubClipboard();
        const card = mount();
        enter(card.plain, 'hello');

        card.encoded.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        card.encoded.click();
        await settleAsync();

        expect(card.encoded.dataset['output']).toBe('true');
        expect(card.encoded.hasAttribute('title')).toBe(false);
        expect(writeText).not.toHaveBeenCalled();
        expect(lastToast()).toBeNull();
    });

    it('hides the Base64 options for other codecs', () => {
        const card = mount();
        const options = card.element.querySelector<HTMLElement>('.codec-options') as HTMLElement;

        expect(options.hidden).toBe(false);
        pickCodec(card, 'url');
        expect(options.hidden).toBe(true);
    });

    it('keeps the panes after the card is built again', () => {
        const card = mount();
        enter(card.plain, 'kept');
        const rebuilt = mountCard(buildCodecCard, (state) => Object.assign(state.codec, card.state.codec));
        mounted.push(rebuilt);

        expect(rebuilt.element.querySelectorAll('textarea')[1]?.value).toBe('a2VwdA==');
    });
});
