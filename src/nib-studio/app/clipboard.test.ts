import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toastTexts } from '../testing/testHelpers.js';
import {
    copyFailureMessage,
    copyRichTextAsync,
    copyTextAsync,
    copyTextLaterAsync,
    copyTextWithToastAsync,
    copyTypesAsync,
    writeClipboardAsync,
} from './clipboard.js';

interface WrittenItem {
    readonly data: Readonly<Record<string, Promise<Blob>>>;
}

describe('clipboard', () => {
    let items: WrittenItem[];
    let write: ReturnType<typeof vi.fn>;
    let writeText: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        items = [];
        write = vi.fn(async (written: WrittenItem[]) => {
            items.push(...written);
            await Promise.all(Object.values(written[0]?.data ?? {}));
        });
        writeText = vi.fn(async () => {});
        vi.stubGlobal('ClipboardItem', class {
            constructor(readonly data: Readonly<Record<string, Promise<Blob>>>) {}
        });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => ({ write, writeText }) });
    });

    afterEach(() => {
        Reflect.deleteProperty(navigator, 'clipboard');
        vi.unstubAllGlobals();
        document.body.replaceChildren();
    });

    it('puts plain text on the clipboard', async () => {
        await copyTextAsync('hello');

        expect(writeText).toHaveBeenCalledWith('hello');
    });

    it('names every type at once and gives each a blob of that very type once the content is ready', async () => {
        let finish: (value: { html: string; text: string }) => void = () => undefined;
        const content = new Promise<{ html: string; text: string }>((resolve) => {
            finish = resolve;
        });

        const copied = copyRichTextAsync(content);

        expect(write).toHaveBeenCalledTimes(1);
        expect(Object.keys(items[0]?.data ?? {})).toEqual(['text/html', 'text/plain']);

        finish({ html: '<b>Hi</b>', text: 'Hi' });
        await copied;
        const html = await items[0]?.data['text/html'];
        const text = await items[0]?.data['text/plain'];

        expect([html?.type, await html?.text()]).toEqual(['text/html', '<b>Hi</b>']);
        expect([text?.type, await text?.text()]).toEqual(['text/plain', 'Hi']);
    });

    it('puts text still being made on the clipboard as plain text', async () => {
        await copyTextLaterAsync(Promise.resolve('a\tb'));

        expect(Object.keys(items[0]?.data ?? {})).toEqual(['text/plain']);
        expect(await (await items[0]?.data['text/plain'])?.text()).toBe('a\tb');
    });

    it('throws the content\'s own failure rather than the clipboard\'s', async () => {
        write.mockImplementation(async (written: WrittenItem[]) => {
            await Promise.all(Object.values(written[0]?.data ?? {}));
        });

        await expect(writeClipboardAsync(Promise.reject(new Error('Rows could not be read.')), { 'text/plain': String })).rejects.toThrow('Rows could not be read.');
    });

    it('puts content of several types on the clipboard as one item, each a blob of its type, and text alone as plain text', async () => {
        const picture = new Blob(['png'], { type: 'image/png' });

        await copyTypesAsync({ 'text/plain': 'Hi' });
        await copyTypesAsync({ 'text/plain': 'Hi', 'text/html': '<b>Hi</b>', 'image/png': picture });
        const html = await items[0]?.data['text/html'];

        expect(writeText).toHaveBeenCalledWith('Hi');
        expect(write).toHaveBeenCalledTimes(1);
        expect(Object.keys(items[0]?.data ?? {})).toEqual(['text/plain', 'text/html', 'image/png']);
        expect([html?.type, await html?.text()]).toEqual(['text/html', '<b>Hi</b>']);
        expect(await items[0]?.data['image/png']).toBe(picture);
    });

    it('says so when the browser has no clipboard to write items to', async () => {
        vi.stubGlobal('ClipboardItem', undefined);

        await expect(copyTextLaterAsync(Promise.resolve('x'))).rejects.toThrow('This browser cannot copy to the clipboard.');
    });

    it('confirms a copy in a toast, and says why one failed', async () => {
        await copyTextWithToastAsync('docs/a.md', 'Path copied.');
        writeText.mockRejectedValueOnce(new DOMException('Document is not focused.', 'NotAllowedError'));
        await copyTextWithToastAsync('a.md', 'Name copied.');

        expect(writeText).toHaveBeenCalledWith('docs/a.md');
        expect(toastTexts()).toEqual(['Path copied.', 'Could not copy: Document is not focused.']);
    });

    it('says in its own words that a file read for a copy is gone from disk', () => {
        const gone = new DOMException('A requested file or directory could not be found.', 'NotFoundError');

        expect(copyFailureMessage(gone)).toBe('Could not copy: the file is no longer on disk.');
        expect(copyFailureMessage(new Error('Rows could not be read.'))).toBe('Could not copy: Rows could not be read.');
    });
});
