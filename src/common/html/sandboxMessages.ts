// The messages between an HTML preview and the sandbox page that draws it, `nib-studio/sandbox.html`.
// Each carries the channel, and each side reads only the shapes below, so anything else posted to either window
// is ignored.
export const SANDBOX_CHANNEL = 'nib-studio-sandbox';

export interface ScrollPosition {
    readonly left: number;
    readonly top: number;
}

// The types a page may put on the clipboard: text, and for a rich copy its HTML and a PNG picture.
export const PAGE_CLIPBOARD_TYPES = Object.freeze(['text/plain', 'text/html', 'image/png'] as const);

export type PageClipboardType = typeof PAGE_CLIPBOARD_TYPES[number];

// What a page asks to put on the clipboard, by type: text for the text types, a blob for the picture.
export type PageClipboardContent = Readonly<Partial<Record<PageClipboardType, string | Blob>>>;

// Why a copy with no click or key press in the page behind it is refused.
export const PAGE_COPY_NEEDS_GESTURE = 'The page can write to the clipboard only on a click or key press.';

// From the studio to the sandbox page.
export type StudioMessage =
    // The page to draw, the scroll to restore once it has loaded, and a place to reveal then.
    | {
        readonly channel: typeof SANDBOX_CHANNEL;
        readonly type: 'render';
        readonly html: string;
        readonly scroll: ScrollPosition;
        readonly fragment: string | null;
        readonly isSmooth: boolean;
    }
    // Scrolls to the element with this id or name.
    | {
        readonly channel: typeof SANDBOX_CHANNEL;
        readonly type: 'reveal';
        readonly fragment: string;
        readonly isSmooth: boolean;
    }
    // How the page's copy with this id went: null once it is on the clipboard, or why it isn't.
    | {
        readonly channel: typeof SANDBOX_CHANNEL;
        readonly type: 'copied';
        readonly id: number;
        readonly error: string | null;
    };

// From the sandbox page to the studio.
export type SandboxMessage =
    // The sandbox page has loaded and waits for its page. Each load of the frame's window posts this or `rendered`.
    | { readonly channel: typeof SANDBOX_CHANNEL; readonly type: 'ready' }
    // The page has loaded, with its scroll restored.
    | { readonly channel: typeof SANDBOX_CHANNEL; readonly type: 'rendered' }
    // A link the studio follows, as a click on it in a preview does.
    | { readonly channel: typeof SANDBOX_CHANNEL; readonly type: 'link'; readonly href: string }
    // Ctrl+S in the page.
    | { readonly channel: typeof SANDBOX_CHANNEL; readonly type: 'save' }
    | { readonly channel: typeof SANDBOX_CHANNEL; readonly type: 'scroll'; readonly left: number; readonly top: number }
    // Content the page's script asks to put on the clipboard, and whether a click or key press in the page was behind it.
    | {
        readonly channel: typeof SANDBOX_CHANNEL;
        readonly type: 'copy';
        readonly id: number;
        readonly isActive: boolean;
        readonly content: PageClipboardContent;
    };

type MessageRecord = Readonly<Record<string, unknown>>;

type Reader<T> = (record: MessageRecord) => T | null;

const STUDIO_MESSAGE_READERS: Readonly<Record<StudioMessage['type'], Reader<StudioMessage>>> = {
    render: (record) => {
        const scroll = readScroll(record.scroll);

        if (
            typeof record.html !== 'string'
            || scroll == null
            || !isFragmentOrNull(record.fragment)
            || typeof record.isSmooth !== 'boolean'
        ) {
            return null;
        }

        return {
            channel: SANDBOX_CHANNEL,
            type: 'render',
            html: record.html,
            scroll,
            fragment: record.fragment,
            isSmooth: record.isSmooth,
        };
    },
    reveal: (record) => {
        if (typeof record.fragment !== 'string' || typeof record.isSmooth !== 'boolean') {
            return null;
        }

        return { channel: SANDBOX_CHANNEL, type: 'reveal', fragment: record.fragment, isSmooth: record.isSmooth };
    },
    copied: (record) => {
        const { id, error } = record;

        if (!isCopyId(id) || (error !== null && typeof error !== 'string')) {
            return null;
        }

        return { channel: SANDBOX_CHANNEL, type: 'copied', id, error };
    },
};

const SANDBOX_MESSAGE_READERS: Readonly<Record<SandboxMessage['type'], Reader<SandboxMessage>>> = {
    ready: () => ({ channel: SANDBOX_CHANNEL, type: 'ready' }),
    rendered: () => ({ channel: SANDBOX_CHANNEL, type: 'rendered' }),
    link: (record) => typeof record.href === 'string' ? { channel: SANDBOX_CHANNEL, type: 'link', href: record.href } : null,
    save: () => ({ channel: SANDBOX_CHANNEL, type: 'save' }),
    scroll: (record) => {
        const scroll = readScroll(record);

        return scroll == null ? null : { channel: SANDBOX_CHANNEL, type: 'scroll', left: scroll.left, top: scroll.top };
    },
    copy: (record) => {
        const { id, isActive } = record;
        const content = readClipboardContent(record.content);

        if (!isCopyId(id) || typeof isActive !== 'boolean' || content == null) {
            return null;
        }

        return { channel: SANDBOX_CHANNEL, type: 'copy', id, isActive, content };
    },
};

// A message the sandbox page takes from the studio, rebuilt from its known fields; null for anything else.
export function readStudioMessage(data: unknown): StudioMessage | null {
    return readMessage(data, STUDIO_MESSAGE_READERS);
}

// A message the studio takes from the sandbox page, rebuilt from its known fields; null for anything else.
export function readSandboxMessage(data: unknown): SandboxMessage | null {
    return readMessage(data, SANDBOX_MESSAGE_READERS);
}

function readMessage<T>(data: unknown, readers: Readonly<Record<string, Reader<T>>>): T | null {
    if (data == null || typeof data !== 'object' || Array.isArray(data)) {
        return null;
    }

    const record = data as MessageRecord;

    if (
        record.channel !== SANDBOX_CHANNEL
        || typeof record.type !== 'string'
        || !Object.hasOwn(readers, record.type)
    ) {
        return null;
    }

    return readers[record.type]?.(record) ?? null;
}

function readScroll(value: unknown): ScrollPosition | null {
    if (value == null || typeof value !== 'object') {
        return null;
    }

    const { left, top } = value as MessageRecord;

    if (typeof left !== 'number' || typeof top !== 'number' || !Number.isFinite(left) || !Number.isFinite(top)) {
        return null;
    }

    return { left, top };
}

function isFragmentOrNull(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
}

function isCopyId(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value);
}

// The content of a copy, with each known type's data of its kind; null when it holds none, or a type of the wrong kind.
function readClipboardContent(value: unknown): PageClipboardContent | null {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const record = value as MessageRecord;
    const content: Partial<Record<PageClipboardType, string | Blob>> = {};

    for (const type of PAGE_CLIPBOARD_TYPES) {
        const data = record[type];

        if (data === undefined) {
            continue;
        }

        if (!isClipboardData(type, data)) {
            return null;
        }

        content[type] = data;
    }

    return Object.keys(content).length === 0 ? null : content;
}

function isClipboardData(type: PageClipboardType, data: unknown): data is string | Blob {
    return type === 'image/png' ? data instanceof Blob : typeof data === 'string';
}
