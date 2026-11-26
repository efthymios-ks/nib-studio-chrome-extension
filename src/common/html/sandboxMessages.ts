// The messages between an HTML preview and the sandbox page that draws it, `nib-studio/sandbox.html`.
// Each carries the channel, and each side reads only the shapes below, so anything else posted to either window
// is ignored.
export const SANDBOX_CHANNEL = 'nib-studio-sandbox';

export interface ScrollPosition {
    readonly left: number;
    readonly top: number;
}

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
    | { readonly channel: typeof SANDBOX_CHANNEL; readonly type: 'scroll'; readonly left: number; readonly top: number };

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
