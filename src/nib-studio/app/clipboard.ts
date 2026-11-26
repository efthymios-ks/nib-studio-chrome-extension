import type { RichText } from '../../common/clipboard/clipboardHtml.js';
import { errorMessage } from '../../common/errorMessage.js';
import { toast } from './toast.js';

const NO_CLIPBOARD = 'This browser cannot copy to the clipboard.';

// Puts text on the clipboard.
export async function copyTextAsync(text: string): Promise<void> {
    if (navigator.clipboard?.writeText == null) {
        throw new Error(NO_CLIPBOARD);
    }

    await navigator.clipboard.writeText(text);
}

// Puts text on the clipboard and says so in a toast, such as `Name copied.`; a failure's toast says why.
export async function copyTextWithToastAsync(text: string, confirmation: string): Promise<void> {
    try {
        await copyTextAsync(text);
        toast(confirmation, 'ok');
    }
    catch (error) {
        toast(copyFailureMessage(error), 'fail');
    }
}

// What the toast of a copy that failed says, such as `Could not copy: Document is not focused.`.
// A file read from disk for the copy that is gone from there says so.
export function copyFailureMessage(error: unknown): string {
    if (error instanceof DOMException && error.name === 'NotFoundError') {
        return 'Could not copy: the file is no longer on disk.';
    }

    return `Could not copy: ${errorMessage(error)}`;
}

// Puts text that is still being made on the clipboard, such as rows still being read from disk.
export async function copyTextLaterAsync(text: Promise<string>): Promise<void> {
    await writeClipboardAsync(text, { 'text/plain': (value) => value });
}

// Puts formatted content on the clipboard: its HTML for a paste that keeps the formatting, and its text for one that can't.
export async function copyRichTextAsync(content: Promise<RichText>): Promise<void> {
    await writeClipboardAsync(content, {
        'text/html': (value) => value.html,
        'text/plain': (value) => value.text,
    });
}

// Puts one item on the clipboard whose content may still be being made: its types are named at once, and each type's
// data follows once the content is ready. The ClipboardItem takes the promises themselves, so the click that asked for
// the copy still counts however long the content takes. When making the content fails, that failure is thrown,
// as it says more than the clipboard's own.
export async function writeClipboardAsync<T>(
    content: Promise<T>,
    types: Readonly<Record<string, (value: T) => Blob | string>>,
): Promise<void> {
    if (typeof ClipboardItem !== 'function' || navigator.clipboard?.write == null) {
        // The content's own failure, if any, has nowhere to go.
        content.catch(() => undefined);

        throw new Error(NO_CLIPBOARD);
    }

    const data: Record<string, Promise<Blob>> = {};

    for (const [type, pick] of Object.entries(types)) {
        const blob = blobOfAsync(content, pick, type);
        // The failure reaches the caller through `content`.
        blob.catch(() => undefined);
        data[type] = blob;
    }

    try {
        await navigator.clipboard.write([new ClipboardItem(data)]);
    }
    catch (error) {
        await content;

        throw error;
    }
}

// One type's data, once the content is ready. The browser takes it only as a blob of that very type.
async function blobOfAsync<T>(content: Promise<T>, pick: (value: T) => Blob | string, type: string): Promise<Blob> {
    const value = pick(await content);

    if (typeof value !== 'string' && value.type === type) {
        return value;
    }

    return new Blob([value], { type });
}
