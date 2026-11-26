import { afterEach, describe, expect, it } from 'vitest';
import { toastTexts } from '../testing/testHelpers.js';
import {
    clipboardTabName,
    freeClipboardName,
    isPastedTab,
    pastedTab,
    pasteProblem,
    readClipboardPasteAsync,
    readClipboardTextAsync,
    type ClipboardSource,
} from './clipboardPaste.js';
import { externalTabPath, type OpenFile } from './store.js';

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

interface FakeItem {
    readonly types: ReadonlyArray<string>;
    readonly getType: (type: string) => Promise<Blob>;
}

function item(parts: Readonly<Record<string, Blob | string>>): FakeItem {
    return {
        types: Object.keys(parts),
        getType: async (type) => {
            const part = parts[type];

            if (part == null) {
                throw new DOMException('No such type', 'NotFoundError');
            }

            return typeof part === 'string' ? new Blob([part], { type }) : part;
        },
    };
}

function clipboardOf(...items: ReadonlyArray<FakeItem>): ClipboardSource {
    return {
        read: async () => items as unknown as ClipboardItems,
        readText: async () => '',
    };
}

function refusing(error: unknown): ClipboardSource {
    return {
        read: async () => {
            throw error;
        },
        readText: async () => {
            throw error;
        },
    };
}

function png(): Blob {
    return new Blob([PNG_BYTES], { type: 'image/png' });
}

describe('readClipboardPasteAsync', () => {
    it('reads the text on the clipboard', async () => {
        expect(await readClipboardPasteAsync(clipboardOf(item({ 'text/plain': '{"a":1}' })))).toEqual({ kind: 'text', text: '{"a":1}' });
    });

    it('takes the text over a picture of it, as Excel puts both on the clipboard for copied cells', async () => {
        const paste = await readClipboardPasteAsync(clipboardOf(item({ 'text/plain': 'a\tb\n1\t2\n', 'image/png': png() })));

        expect(paste).toEqual({ kind: 'text', text: 'a\tb\n1\t2\n' });
    });

    it('reads a picture, named by what its bytes say it is', async () => {
        const paste = await readClipboardPasteAsync(clipboardOf(item({ 'text/html': '<img src="x.png">', 'image/png': png() })));

        expect(paste.kind).toBe('picture');
        expect(paste.kind === 'picture' ? paste.extension : null).toBe('png');
        expect(paste.kind === 'picture' ? paste.picture.size : null).toBe(PNG_BYTES.length);
    });

    it('says the clipboard is empty when it holds nothing, or only blank text', async () => {
        expect(await readClipboardPasteAsync(clipboardOf())).toEqual({ kind: 'empty' });
        expect(await readClipboardPasteAsync(clipboardOf(item({ 'text/plain': ' \n\t ' })))).toEqual({ kind: 'empty' });
    });

    it('says what is on the clipboard can\'t be pasted when it is no text or picture it can show', async () => {
        expect(await readClipboardPasteAsync(clipboardOf(item({ 'text/html': '<b>bold</b>' })))).toEqual({ kind: 'unsupported' });
        expect(await readClipboardPasteAsync(clipboardOf(item({ 'image/png': new Blob(['not a picture']) })))).toEqual({ kind: 'unsupported' });
    });

    it('tells a refusal to read the clipboard from another failure', async () => {
        expect(await readClipboardPasteAsync(refusing(new DOMException('Read permission denied.', 'NotAllowedError'))))
            .toEqual({ kind: 'refused' });
        expect(await readClipboardPasteAsync(refusing(new Error('Clipboard is busy.'))))
            .toEqual({ kind: 'failed', message: 'Clipboard is busy.' });
        expect(await readClipboardPasteAsync(refusing('odd'))).toEqual({ kind: 'failed', message: 'Could not read the clipboard.' });
    });

    it('reads the text alone where the browser can\'t read the whole clipboard', async () => {
        expect(await readClipboardPasteAsync({ readText: async () => 'plain' })).toEqual({ kind: 'text', text: 'plain' });
        expect(await readClipboardPasteAsync({ readText: async () => '' })).toEqual({ kind: 'empty' });
    });

    it('fails without a clipboard to read', async () => {
        expect(await readClipboardPasteAsync(undefined)).toEqual({ kind: 'failed', message: 'This browser cannot read the clipboard.' });
    });
});

describe('readClipboardTextAsync', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('reads the text alone, blank text included, without a toast', async () => {
        expect(await readClipboardTextAsync({ read: async () => [], readText: async () => ' x\n' })).toBe(' x\n');
        expect(toastTexts()).toEqual([]);
    });

    it('says why there is no text to compare, as the paste does', async () => {
        expect(await readClipboardTextAsync({ readText: async () => '' })).toBeNull();
        expect(await readClipboardTextAsync(refusing(new DOMException('Read permission denied.', 'NotAllowedError')))).toBeNull();
        expect(await readClipboardTextAsync(refusing('odd'))).toBeNull();
        expect(await readClipboardTextAsync(undefined)).toBeNull();

        expect(toastTexts()).toEqual([
            'The clipboard holds no text.',
            'Nib Studio was not allowed to read the clipboard.',
            'Could not read the clipboard.',
            'This browser cannot read the clipboard.',
        ]);
    });
});

describe('pasteProblem', () => {
    it('words a toast for each paste that opens no tab', () => {
        expect(pasteProblem({ kind: 'empty' })).toEqual({ message: 'The clipboard is empty.', tone: 'warn' });
        expect(pasteProblem({ kind: 'refused' })).toEqual({ message: 'Nib Studio was not allowed to read the clipboard.', tone: 'warn' });
        expect(pasteProblem({ kind: 'unsupported' })).toEqual({ message: 'The clipboard holds no text or picture to paste.', tone: 'warn' });
        expect(pasteProblem({ kind: 'failed', message: 'Could not read the clipboard.' })).toEqual({ message: 'Could not read the clipboard.', tone: 'fail' });
    });

    it('has nothing to say about text or a picture', () => {
        expect(pasteProblem({ kind: 'text', text: 'a' })).toBeNull();
        expect(pasteProblem({ kind: 'picture', picture: png(), extension: 'png' })).toBeNull();
    });
});

describe('clipboardTabName', () => {
    it('names the first pasted tab Clipboard, and numbers the next ones after the highest open tab named so', () => {
        expect(clipboardTabName([], 'json')).toBe('Clipboard.json');
        expect(clipboardTabName(['Clipboard.json'], 'md')).toBe('Clipboard 2.md');
        expect(clipboardTabName(['Clipboard.json', 'Clipboard 3.txt'], 'csv')).toBe('Clipboard 4.csv');
    });

    it('starts again at Clipboard once no tab named so is open, whatever other tabs are called', () => {
        expect(clipboardTabName(['notes.md', 'Clipboard copy.txt'], 'txt')).toBe('Clipboard.txt');
    });
});

describe('freeClipboardName', () => {
    it('keeps the name when the folder has no entry of that name', () => {
        expect(freeClipboardName('Clipboard.json', ['data.json'])).toBe('Clipboard.json');
    });

    it('numbers on past the names the folder already has, whatever their case', () => {
        expect(freeClipboardName('Clipboard.json', ['clipboard.json'])).toBe('Clipboard 2.json');
        expect(freeClipboardName('Clipboard 2.md', ['Clipboard 2.md', 'Clipboard 3.md'])).toBe('Clipboard 4.md');
    });
});

describe('pastedTab', () => {
    it('holds pasted text in an unsaved tab named by its format, keeping its line endings for saving', () => {
        const tab = pastedTab({ kind: 'text', text: 'name,age\r\nAnn,31\r\nBob,42\r\n' }, { id: 4, openNames: [] });

        expect(tab).toEqual({
            path: externalTabPath(4, 'Clipboard.csv'),
            text: 'name,age\nAnn,31\nBob,42\n',
            originalText: '',
            lineEnding: '\r\n',
            encoding: 'utf-8',
            dirty: true,
            view: 'editor',
            file: null,
            preview: false,
            external: { handle: null, pasted: true },
        });
        expect(isPastedTab(tab)).toBe(true);
    });

    it('numbers the tab after the tabs named so already open', () => {
        const tab = pastedTab({ kind: 'text', text: '# Notes\n\n- one\n- two\n' }, { id: 5, openNames: ['Clipboard.json'] });

        expect(tab.path).toBe(externalTabPath(5, 'Clipboard 2.md'));
    });

    it('holds a pasted picture as a file of its own, for the image preview', async () => {
        const tab = pastedTab({ kind: 'picture', picture: png(), extension: 'png' }, { id: 6, openNames: [] });

        expect(tab.path).toBe(externalTabPath(6, 'Clipboard.png'));
        expect(tab.text).toBe('');
        expect(tab.dirty).toBe(true);
        expect(tab.file?.name).toBe('Clipboard.png');
        expect(tab.file?.type).toBe('image/png');
        expect(new Uint8Array(await tab.file!.arrayBuffer())).toEqual(PNG_BYTES);
    });

    it('tells a pasted tab from the tab of a file from outside the workspace', () => {
        const dropped: OpenFile = {
            path: externalTabPath(1, 'notes.txt'),
            text: '',
            originalText: '',
            lineEnding: '\n',
            dirty: false,
            view: 'editor',
            file: null,
            preview: false,
            external: { handle: null },
        };

        expect(isPastedTab(dropped)).toBe(false);
        expect(isPastedTab({ ...dropped, path: 'notes.txt', external: undefined })).toBe(false);
    });
});
