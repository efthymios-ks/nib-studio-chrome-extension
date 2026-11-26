// A clipboard for tests that records what each copy wrote, which happy-dom keeps to itself.
import { vi, type Mock } from 'vitest';

export interface FakeClipboard {
    readonly writeText: Mock<(text: string) => Promise<void>>;
    readonly write: Mock<(items: ReadonlyArray<FakeClipboardItem>) => Promise<void>>;
    // What each copy wrote so far, by type, once its content was ready.
    readonly writes: ReadonlyArray<ReadonlyMap<string, string>>;
    // What the last copy wrote, by type; empty before any.
    last(): ReadonlyMap<string, string>;
    // Puts back the browser's own clipboard.
    restore(): void;
}

export interface FakeClipboardItem {
    readonly data: Readonly<Record<string, unknown>>;
}

// Replaces `navigator.clipboard` and `ClipboardItem`; a write waits for its content as the browser does,
// and `failWith` makes every write fail.
export function stubClipboard(options: { readonly failWith?: Error } = {}): FakeClipboard {
    const writes: Array<ReadonlyMap<string, string>> = [];
    const writeText = vi.fn(async (text: string) => {
        if (options.failWith != null) {
            throw options.failWith;
        }

        writes.push(new Map([['text/plain', text]]));
    });
    const write = vi.fn(async (items: ReadonlyArray<FakeClipboardItem>) => {
        const written = new Map<string, string>();

        for (const [type, value] of Object.entries(items[0]?.data ?? {})) {
            const resolved = await value;
            written.set(type, typeof resolved === 'string' ? resolved : await (resolved as Blob).text());
        }

        if (options.failWith != null) {
            throw options.failWith;
        }

        writes.push(written);
    });

    const originalItem = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
    Object.defineProperty(globalThis, 'ClipboardItem', {
        configurable: true,
        writable: true,
        value: class {
            constructor(readonly data: Readonly<Record<string, unknown>>) {}
        },
    });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => ({ writeText, write }) });

    return {
        writeText,
        write,
        writes,
        last: () => writes.at(-1) ?? new Map(),
        restore: () => {
            Reflect.deleteProperty(navigator, 'clipboard');

            if (originalItem == null) {
                Reflect.deleteProperty(globalThis, 'ClipboardItem');
            }
            else {
                Object.defineProperty(globalThis, 'ClipboardItem', originalItem);
            }
        },
    };
}
