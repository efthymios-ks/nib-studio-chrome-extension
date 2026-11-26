import { errorMessage } from '../../common/errorMessage.js';
import { isNameTaken } from '../../common/fs/nextFreeName.js';
import { IMAGE_HEADER_BYTES, sniffImageFormat } from '../../common/image/imageFormat.js';
import { detectTextFormat, TEXT_FORMAT_EXTENSIONS } from '../../common/text/textFormat.js';
import { externalTabPath, textFromDisk, type ExternalFile, type OpenFile } from './store.js';
import { toast, type ToastMessage } from './toast.js';

// What Paste from clipboard reads: the text, or else a picture, on the clipboard, or why there is nothing to open.
export type ClipboardPaste =
    | { readonly kind: 'text'; readonly text: string }
    | { readonly kind: 'picture'; readonly picture: Blob; readonly extension: string }
    | { readonly kind: 'empty' }
    | { readonly kind: 'unsupported' }
    | { readonly kind: 'refused' }
    | { readonly kind: 'failed'; readonly message: string };

export type OpenablePaste = Extract<ClipboardPaste, { kind: 'text' | 'picture' }>;

// The part of the browser's clipboard a paste reads; `read` is missing where only text can be read.
export interface ClipboardSource {
    readonly read?: () => Promise<ClipboardItems>;
    readonly readText: () => Promise<string>;
}

const TEXT_TYPE = 'text/plain';

// The picture formats' extensions where they differ from the format's name.
const PICTURE_EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
    jpeg: 'jpg',
});

// Whether the browser lets a page read the clipboard at all, for the menu items that do.
export function canReadClipboard(): boolean {
    return navigator.clipboard?.readText != null;
}

// Text wins over a picture, since Excel and Word put a picture of copied cells or text beside the text itself.
// The HTML a copy from a page or an editor also carries is styling, so it is never read.
export async function readClipboardPasteAsync(clipboard: ClipboardSource | undefined): Promise<ClipboardPaste> {
    return await readGuardedAsync(clipboard, async (source) => {
        if (source.read == null) {
            return textPaste(await source.readText()) ?? { kind: 'empty' };
        }

        return await pasteOfItemsAsync(await source.read());
    });
}

const NO_TEXT_TO_COMPARE: ToastMessage = Object.freeze({ message: 'The clipboard holds no text.', tone: 'warn' });

// The clipboard's text for a side of a compare, which has no use for a picture;
// null, after a toast that says why, when the clipboard can't be read or holds no text.
export async function readClipboardTextAsync(clipboard: ClipboardSource | undefined): Promise<string | null> {
    const paste = await readGuardedAsync(clipboard, async (source) => ({ kind: 'text', text: await source.readText() }));

    if (paste.kind === 'text' && paste.text !== '') {
        return paste.text;
    }

    const problem = paste.kind === 'text' ? NO_TEXT_TO_COMPARE : pasteProblem(paste);

    if (problem != null) {
        toast(problem.message, problem.tone);
    }

    return null;
}

// Reads the clipboard the way `readAsync` does; a browser without a clipboard, a refusal and any other failure
// come back as the paste that says so.
async function readGuardedAsync(
    clipboard: ClipboardSource | undefined,
    readAsync: (source: ClipboardSource) => Promise<ClipboardPaste>,
): Promise<ClipboardPaste> {
    if (clipboard == null) {
        return { kind: 'failed', message: 'This browser cannot read the clipboard.' };
    }

    try {
        return await readAsync(clipboard);
    }
    catch (error) {
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
            return { kind: 'refused' };
        }

        return { kind: 'failed', message: errorMessage(error, 'Could not read the clipboard.') };
    }
}

function textPaste(text: string): ClipboardPaste | null {
    return text.trim() === '' ? null : { kind: 'text', text };
}

async function pasteOfItemsAsync(items: ReadonlyArray<ClipboardItem>): Promise<ClipboardPaste> {
    const textItem = items.find((candidate) => candidate.types.includes(TEXT_TYPE));
    const text = textItem == null ? null : textPaste(await (await textItem.getType(TEXT_TYPE)).text());

    if (text != null) {
        return text;
    }

    for (const candidate of items) {
        for (const type of candidate.types.filter((name) => name.startsWith('image/'))) {
            const picture = await picturePasteAsync(await candidate.getType(type));

            if (picture != null) {
                return picture;
            }
        }
    }

    const holdsMore = items.some((candidate) => candidate.types.some((type) => type !== TEXT_TYPE));

    return holdsMore ? { kind: 'unsupported' } : { kind: 'empty' };
}

// A picture the image preview can show, known by its first bytes; null for bytes no picture format starts with.
async function picturePasteAsync(picture: Blob): Promise<ClipboardPaste | null> {
    const header = new Uint8Array(await picture.slice(0, IMAGE_HEADER_BYTES).arrayBuffer());
    const format = sniffImageFormat(header, '');

    if (format.id === 'unknown') {
        return null;
    }

    return { kind: 'picture', picture, extension: PICTURE_EXTENSIONS[format.id] ?? format.id };
}

const PASTE_PROBLEMS: Readonly<Partial<Record<ClipboardPaste['kind'], ToastMessage>>> = Object.freeze({
    empty: { message: 'The clipboard is empty.', tone: 'warn' },
    refused: { message: 'Nib Studio was not allowed to read the clipboard.', tone: 'warn' },
    unsupported: { message: 'The clipboard holds no text or picture to paste.', tone: 'warn' },
});

// The toast for a paste that opens no tab; null for text or a picture.
export function pasteProblem(paste: ClipboardPaste): ToastMessage | null {
    if (paste.kind === 'failed') {
        return { message: paste.message, tone: 'fail' };
    }

    return PASTE_PROBLEMS[paste.kind] ?? null;
}

export function isOpenablePaste(paste: ClipboardPaste): paste is OpenablePaste {
    return paste.kind === 'text' || paste.kind === 'picture';
}

const CLIPBOARD_BASE = 'Clipboard';

// `Clipboard.json` is 1 and `Clipboard 2.md` is 2; null for any other name.
function clipboardNumber(name: string): number | null {
    const match = /^Clipboard(?: (\d+))?\.[^.]+$/.exec(name);

    if (match == null) {
        return null;
    }

    return match[1] == null ? 1 : Number(match[1]);
}

function numberedName(number: number, extension: string): string {
    return number === 1 ? `${CLIPBOARD_BASE}.${extension}` : `${CLIPBOARD_BASE} ${number}.${extension}`;
}

// `Clipboard.json` for the first pasted tab, then `Clipboard 2.md`, `Clipboard 3.txt`…
// after the highest number among the open tabs named so, saved pastes included, so no two tabs share a name.
export function clipboardTabName(openNames: Iterable<string>, extension: string): string {
    const numbers = [...openNames]
        .map(clipboardNumber)
        .filter((number) => number != null);

    return numberedName(numbers.length === 0 ? 1 : Math.max(...numbers) + 1, extension);
}

// The name a pasted tab suggests when it is saved: its own, or the next number on that no entry of the folder takes.
export function freeClipboardName(name: string, takenNames: Iterable<string>): string {
    const taken = [...takenNames];
    const dot = name.lastIndexOf('.');
    const extension = name.slice(dot + 1);
    let number = clipboardNumber(name) ?? 1;
    let candidate = name;

    while (isNameTaken(candidate, taken)) {
        number += 1;
        candidate = numberedName(number, extension);
    }

    return candidate;
}

// The tab of a paste that isn't saved yet.
export type PastedFile = OpenFile & { readonly external: ExternalFile };

export function isPastedTab(file: OpenFile): file is PastedFile {
    return file.external?.pasted === true;
}

// An unsaved tab of its own for a paste, outside any folder until it is saved.
// Text keeps the line endings it was copied with, for saving; a picture is a file for the image preview.
export function pastedTab(
    paste: OpenablePaste,
    options: { readonly id: number; readonly openNames: Iterable<string> },
): OpenFile {
    const extension = paste.kind === 'text' ? TEXT_FORMAT_EXTENSIONS[detectTextFormat(paste.text)] : paste.extension;
    const name = clipboardTabName(options.openNames, extension);
    const shared = {
        path: externalTabPath(options.id, name),
        dirty: true,
        view: 'editor',
        preview: false,
        external: { handle: null, pasted: true },
    } as const;

    if (paste.kind === 'picture') {
        return {
            ...shared,
            text: '',
            originalText: '',
            lineEnding: '\n',
            file: new File([paste.picture], name, { type: paste.picture.type }),
        };
    }

    return { ...shared, ...textFromDisk(paste.text), originalText: '', file: null };
}
