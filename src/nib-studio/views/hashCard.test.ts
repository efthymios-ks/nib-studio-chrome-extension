import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeDirectoryHandle } from '../../common/fs/testing/fakeFileSystem.js';
import { dragEvent, dropFixtures, fakeDataTransfer } from '../testing/fakeDataTransfer.js';
import { settleAsync } from '../testing/testHelpers.js';
import { digestOf, lastToast, mountCard, pressEnter, stubClipboard, typeInto, type MountedCard } from '../testing/toolCardHarness.js';
import { buildHashCard, hashFileAsync, hashTextAsync } from './hashCard.js';

const SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const MD5_ABC = '900150983cd24fb0d6963f7d28e17f72';
const SHA256_ABC_BASE64 = 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=';

const mounted: MountedCard[] = [];

function mount(): MountedCard {
    const card = mountCard(buildHashCard);
    mounted.push(card);

    return card;
}

function textArea(card: MountedCard): HTMLTextAreaElement {
    return card.element.querySelector('textarea') as HTMLTextAreaElement;
}

function sourceLine(card: MountedCard): string {
    return card.element.querySelector<HTMLElement>('.tool-message')?.textContent ?? '';
}

async function enterTextAsync(card: MountedCard, text: string): Promise<void> {
    typeInto(textArea(card), text);
    pressEnter(textArea(card));
    await settleAsync();
}

afterEach(() => {
    for (const card of mounted.splice(0)) {
        card.unmount();
    }

    document.querySelector('.toast-stack')?.remove();
    vi.unstubAllGlobals();
});

describe('buildHashCard', () => {
    it('labels the text area, points it at the hint and offers a file link', () => {
        const card = mount();
        const textarea = textArea(card);

        expect(card.element.querySelector(`label[for="${textarea.id}"]`)?.textContent).toBe('Text');
        expect(document.getElementById(textarea.getAttribute('aria-describedby') ?? '')?.textContent).toContain('Enter to hash');
        expect(card.element.querySelector('.link-button')?.textContent).toBe('Choose file…');
        expect(textarea.value).toBe('Nib Studio');
    });

    it('lists the five algorithms with no digests until something is hashed', () => {
        const card = mount();
        const rows = [...card.element.querySelectorAll<HTMLElement>('.digest-row')];

        expect(rows.map((row) => row.dataset['key'])).toEqual(['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']);
        expect(rows.every((row) => row.dataset['empty'] === 'true')).toBe(true);
    });

    it('hashes the text on Enter, not while typing', async () => {
        const card = mount();

        typeInto(textArea(card), 'abc');
        await settleAsync();
        expect(digestOf(card.element, 'SHA-256')).toBe('—');

        pressEnter(textArea(card));
        await settleAsync();

        expect(digestOf(card.element, 'SHA-256')).toBe(SHA256_ABC);
        expect(digestOf(card.element, 'MD5')).toBe(MD5_ABC);
        expect(sourceLine(card)).toBe('Digests of the text · 3 bytes as UTF-8');
    });

    it('keeps Shift+Enter for a new line', async () => {
        const card = mount();
        typeInto(textArea(card), 'abc');

        const event = pressEnter(textArea(card), { shiftKey: true });
        await settleAsync();

        expect(event.defaultPrevented).toBe(false);
        expect(digestOf(card.element, 'SHA-256')).toBe('—');
    });

    it('marks the digests stale once the text is edited after Enter', async () => {
        const card = mount();
        await enterTextAsync(card, 'abc');

        typeInto(textArea(card), 'abcd');

        expect(card.element.querySelector<HTMLElement>('.digest-list')?.dataset['stale']).toBe('true');
        expect(sourceLine(card)).toContain('edited, press Enter to hash again');
    });

    it('switches the output format to upper-case hex and Base64', async () => {
        const card = mount();
        await enterTextAsync(card, 'abc');
        const select = card.element.querySelector('select') as HTMLSelectElement;

        select.value = 'HEX';
        select.dispatchEvent(new Event('change'));
        expect(digestOf(card.element, 'SHA-256')).toBe(SHA256_ABC.toUpperCase());

        select.value = 'base64';
        select.dispatchEvent(new Event('change'));
        expect(digestOf(card.element, 'SHA-256')).toBe(SHA256_ABC_BASE64);
        expect(card.state.hash.format).toBe('base64');
    });

    it('clears the digests when Enter is pressed on empty text', async () => {
        const card = mount();
        await enterTextAsync(card, 'abc');

        await enterTextAsync(card, '');

        expect(digestOf(card.element, 'SHA-256')).toBe('—');
        expect(card.element.querySelector<HTMLElement>('.tool-message')?.hidden).toBe(true);
    });

    it('shows digests as text to select, and copies nothing when a row is clicked', async () => {
        const writeText = stubClipboard();
        const card = mount();
        await enterTextAsync(card, 'abc');

        card.element.querySelector<HTMLElement>('.digest-row[data-key="SHA-256"] .digest-value')?.click();
        await settleAsync();

        expect(card.element.querySelector('.digest-list button')).toBeNull();
        expect(writeText).not.toHaveBeenCalled();
        expect(lastToast()).toBeNull();
    });

    it('hashes a file chosen through the link', async () => {
        const card = mount();
        const input = card.element.querySelector('input[type="file"]') as HTMLInputElement;
        const click = vi.spyOn(input, 'click').mockImplementation(() => {});

        card.element.querySelector<HTMLButtonElement>('.link-button')?.click();
        expect(click).toHaveBeenCalled();

        Object.defineProperty(input, 'files', { value: [new File(['abc'], 'abc.txt')], configurable: true });
        input.dispatchEvent(new Event('change'));
        await settleAsync();

        expect(digestOf(card.element, 'SHA-256')).toBe(SHA256_ABC);
        expect(sourceLine(card)).toBe('Digests of abc.txt · 3 bytes');
    });

    it('hashes a file dropped on the card, and keeps the drop from reaching the window', async () => {
        const card = mount();
        const reachedWindow = vi.fn();
        window.addEventListener('drop', reachedWindow);
        const { transfer } = fakeDataTransfer([new File(['abc'], 'dropped.txt')]);

        card.element.dispatchEvent(dragEvent('dragover', transfer));
        expect(card.element.dataset['dragOver']).toBe('true');

        const drop = dragEvent('drop', transfer);
        card.element.dispatchEvent(drop);
        await settleAsync();
        window.removeEventListener('drop', reachedWindow);

        expect(drop.defaultPrevented).toBe(true);
        expect(reachedWindow).not.toHaveBeenCalled();
        expect(card.element.dataset['dragOver']).toBeUndefined();
        expect(digestOf(card.element, 'MD5')).toBe(MD5_ABC);
        expect(sourceLine(card)).toBe('Digests of dropped.txt · 3 bytes');
    });

    it('says a dropped folder can\'t be read, as Chrome hands it over as an empty file', async () => {
        const card = mount();
        const folder = new FakeDirectoryHandle('logs');
        folder.addFile('app.log', 'line\n');

        dropFixtures(card.element, [folder]);
        await settleAsync();

        expect(sourceLine(card)).toBe('Could not read logs: it is a folder, not a file.');
        expect(card.element.querySelector<HTMLElement>('.tool-message')?.dataset['tone']).toBe('fail');
        expect(digestOf(card.element, 'MD5')).toBe('—');
    });

    it('says a dropped folder can\'t be read when the drop tells only its empty file', async () => {
        const card = mount();
        const folderFile = new File([], 'logs');
        vi.spyOn(folderFile, 'arrayBuffer').mockRejectedValue(new DOMException('A requested file or directory could not be found.', 'NotFoundError'));

        dropFixtures(card.element, [folderFile], { entries: false, handles: false });
        await settleAsync();

        expect(sourceLine(card)).toBe('Could not read logs: A requested file or directory could not be found.');
    });

    it('hashes an empty file as empty', async () => {
        const card = mount();

        dropFixtures(card.element, [new File([], 'empty.txt')]);
        await settleAsync();

        expect(sourceLine(card)).toBe('Digests of empty.txt · 0 bytes');
    });

    it('clears the drag highlight when the drag leaves the card', () => {
        const card = mount();
        const { transfer } = fakeDataTransfer([new File(['abc'], 'a.txt')]);
        card.element.dispatchEvent(dragEvent('dragenter', transfer));

        card.element.dispatchEvent(dragEvent('dragleave', transfer, { relatedTarget: document.body }));

        expect(card.element.dataset['dragOver']).toBeUndefined();
    });

    it('shows progress while a file is hashed', async () => {
        const card = mount();
        const progressSeen: Array<{ hidden: boolean; text: string }> = [];
        const progress = card.element.querySelector('progress') as HTMLProgressElement;
        const refresh = card.context.refresh;
        Object.assign(card.context, {
            refresh: () => {
                refresh();
                progressSeen.push({ hidden: progress.hidden === true, text: sourceLine(card) });
            },
        });

        await hashFileAsync(card.context, new File([new Uint8Array(1024)], 'big.bin'));

        expect(progressSeen[0]).toEqual({ hidden: false, text: 'Hashing big.bin · 1 KB… 0%' });
        expect(progressSeen.some((seen) => seen.text.endsWith('80%'))).toBe(true);
        expect(progressSeen.at(-1)).toEqual({ hidden: true, text: 'Digests of big.bin · 1 KB' });
    });

    it('reports a file that cannot be read', async () => {
        const card = mount();
        const unreadable = new File(['abc'], 'folder');
        vi.spyOn(unreadable, 'slice').mockImplementation(() => ({ arrayBuffer: async () => Promise.reject(new Error('Not found')) }) as unknown as Blob);

        await hashFileAsync(card.context, unreadable);

        expect(sourceLine(card)).toBe('Could not read folder: Not found');
        expect(card.element.querySelector<HTMLElement>('.tool-message')?.dataset['tone']).toBe('fail');
        expect(digestOf(card.element, 'MD5')).toBe('—');
    });

    it('lets a later text hash win over a file still being read', async () => {
        const card = mount();
        const pendingFile = hashFileAsync(card.context, new File([new Uint8Array(64)], 'slow.bin'));
        card.state.hash.text = 'abc';

        await hashTextAsync(card.context);
        await pendingFile;

        expect(digestOf(card.element, 'SHA-256')).toBe(SHA256_ABC);
        expect(card.state.hash.source?.kind).toBe('text');
    });
});
