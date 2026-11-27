import {
    PAGE_CLIPBOARD_TYPES,
    PAGE_COPY_NEEDS_GESTURE,
    SANDBOX_CHANNEL,
    type PageClipboardContent,
    type PageClipboardType,
    type SandboxMessage,
} from '../common/html/sandboxMessages.js';

// The studio's answer to a copy it made for the page: null once the content is on the clipboard, or why it isn't.
export interface CopyAnswer {
    readonly id: number;
    readonly error: string | null;
}

export interface PageClipboard {
    // Resolves or rejects the page's promise of the copy the studio answered.
    settle(answer: CopyAnswer): void;
}

interface PendingCopy {
    readonly resolve: () => void;
    readonly reject: (error: unknown) => void;
}

// The part of `ClipboardItem` a copy reads, which the page's own items have.
interface PageClipboardItem {
    readonly types: ReadonlyArray<string>;
    getType(type: string): Promise<Blob>;
}

const MULTIPLE_ITEMS_MESSAGE = 'Support for multiple ClipboardItems is not implemented.';
const NOT_AN_ITEM_MESSAGE = 'Failed to execute \'write\' on \'Clipboard\': the value is not a ClipboardItem.';
const PICTURE_TYPE: PageClipboardType = 'image/png';

// Lets the page's script write to the clipboard, which the sandbox frame's permissions policy refuses it:
// `navigator.clipboard.writeText` and `write` hand their content to the studio, which writes it for the page.
// As with links, a copy goes only during a click or key press in the page; the studio checks that again on its side.
// Text, HTML and a PNG picture go; any other type is refused, as Chrome refuses one.
// Reading the clipboard stays refused, and `document.execCommand('copy')` is left as the browser has it.
export function bridgePageClipboard(page: Window, post: (message: SandboxMessage) => void): PageClipboard {
    const pending = new Map<number, PendingCopy>();
    let lastId = 0;

    const isActive = (): boolean => page.navigator?.userActivation?.isActive ?? false;

    const sendAsync = (content: PageClipboardContent): Promise<void> => new Promise((resolve, reject) => {
        lastId += 1;
        pending.set(lastId, { resolve, reject });
        post({ channel: SANDBOX_CHANNEL, type: 'copy', id: lastId, isActive: true, content });
    });

    // The activation is read before the first `await`, while the page's call is still running.
    const writeTextAsync = async (data: unknown): Promise<void> => {
        if (!isActive()) {
            throw notAllowed(PAGE_COPY_NEEDS_GESTURE);
        }

        await sendAsync({ 'text/plain': String(data) });
    };

    const writeAsync = async (items: unknown): Promise<void> => {
        if (!isActive()) {
            throw notAllowed(PAGE_COPY_NEEDS_GESTURE);
        }

        const list = [...(items as Iterable<unknown>)];

        if (list.length > 1) {
            throw notAllowed(MULTIPLE_ITEMS_MESSAGE);
        }

        const content = list.length === 0 ? {} : await contentOfAsync(list[0]);

        if (Object.keys(content).length === 0) {
            return;
        }

        await sendAsync(content);
    };

    const clipboard = page.navigator?.clipboard as Clipboard | undefined;

    if (clipboard != null) {
        for (const [name, value] of [['writeText', writeTextAsync], ['write', writeAsync]] as const) {
            Object.defineProperty(clipboard, name, { configurable: true, enumerable: true, writable: true, value });
        }
    }

    return {
        settle: ({ id, error }) => {
            const waiting = pending.get(id);

            if (waiting == null) {
                return;
            }

            pending.delete(id);

            if (error == null) {
                waiting.resolve();

                return;
            }

            waiting.reject(notAllowed(error));
        },
    };
}

// What an item holds, once its data is ready: text for the text types, the blob itself for a picture.
async function contentOfAsync(value: unknown): Promise<PageClipboardContent> {
    if (!isClipboardItem(value)) {
        throw new TypeError(NOT_AN_ITEM_MESSAGE);
    }

    const unsupported = value.types.find((type) => !isPageClipboardType(type));

    if (unsupported != null) {
        throw notAllowed(`Type ${unsupported} not supported on write.`);
    }

    const content: Partial<Record<PageClipboardType, string | Blob>> = {};

    for (const type of value.types as ReadonlyArray<PageClipboardType>) {
        const blob = await value.getType(type);
        content[type] = type === PICTURE_TYPE ? blob : await blob.text();
    }

    return content;
}

function isClipboardItem(value: unknown): value is PageClipboardItem {
    const item = value as Partial<PageClipboardItem> | null;

    return item != null && Array.isArray(item.types) && typeof item.getType === 'function';
}

function isPageClipboardType(type: string): type is PageClipboardType {
    return (PAGE_CLIPBOARD_TYPES as ReadonlyArray<string>).includes(type);
}

function notAllowed(message: string): DOMException {
    return new DOMException(message, 'NotAllowedError');
}
