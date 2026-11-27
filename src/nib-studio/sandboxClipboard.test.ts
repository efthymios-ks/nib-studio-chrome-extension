import { describe, expect, it, vi, type Mock } from 'vitest';
import {
    PAGE_COPY_NEEDS_GESTURE,
    SANDBOX_CHANNEL,
    type SandboxMessage,
} from '../common/html/sandboxMessages.js';
import { bridgePageClipboard, type PageClipboard } from './sandboxClipboard.js';

interface FakePage {
    readonly page: Window;
    readonly clipboard: Clipboard;
    readonly activation: { isActive: boolean };
    readonly post: Mock<(message: SandboxMessage) => void>;
    readonly bridge: PageClipboard;
}

// An item as the page makes one with `new ClipboardItem(...)`, whose data may still be on its way.
class FakeClipboardItem {
    readonly types: ReadonlyArray<string>;

    constructor(private readonly data: Readonly<Record<string, string | Blob | Promise<string | Blob>>>) {
        this.types = Object.freeze(Object.keys(data));
    }

    async getType(type: string): Promise<Blob> {
        const value = await this.data[type];

        return typeof value === 'string' ? new Blob([value], { type }) : value!;
    }
}

const readText = vi.fn(async () => 'kept to the page');

// A page whose window has a clipboard, with a click or key press behind its calls unless told otherwise.
function bridgedPage(isActive = true): FakePage {
    const clipboard = { writeText: vi.fn(), write: vi.fn(), readText } as unknown as Clipboard;
    const activation = { isActive };
    const page = { navigator: { clipboard, userActivation: activation } } as unknown as Window;
    const post = vi.fn<(message: SandboxMessage) => void>();
    const bridge = bridgePageClipboard(page, post);

    return { page, clipboard, activation, post, bridge };
}

function copies(post: FakePage['post']): SandboxMessage[] {
    return post.mock.calls.map(([message]) => message).filter((message) => message.type === 'copy');
}

async function settledAsync(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;

        return 'resolved';
    }
    catch (error) {
        return error instanceof DOMException ? `${error.name}: ${error.message}` : `${String(error)}`;
    }
}

describe('bridgePageClipboard', () => {
    it('hands text the page writes during a click to the studio, and resolves once the studio has written it', async () => {
        const { clipboard, post, bridge } = bridgedPage();

        const written = clipboard.writeText('flowchart LR\n    A --> B');
        await Promise.resolve();

        expect(copies(post)).toEqual([{
            channel: SANDBOX_CHANNEL,
            type: 'copy',
            id: 1,
            isActive: true,
            content: { 'text/plain': 'flowchart LR\n    A --> B' },
        }]);

        bridge.settle({ id: 1, error: null });

        expect(await settledAsync(written)).toBe('resolved');
    });

    it('refuses a write with no click or key press behind it, as Chrome would, without asking the studio', async () => {
        const { clipboard, post } = bridgedPage(false);

        expect(await settledAsync(clipboard.writeText('sneaky'))).toBe(`NotAllowedError: ${PAGE_COPY_NEEDS_GESTURE}`);
        expect(await settledAsync(clipboard.write([new FakeClipboardItem({ 'text/plain': 'sneaky' })] as never))).toBe(`NotAllowedError: ${PAGE_COPY_NEEDS_GESTURE}`);
        expect(post).not.toHaveBeenCalled();
    });

    it('reads the click or key press as the page calls, not once the item\'s data is ready', async () => {
        const { activation, clipboard, post } = bridgedPage(false);
        let finish: (text: string) => void = () => undefined;
        const later = new Promise<string>((resolve) => {
            finish = resolve;
        });

        const refused = clipboard.write([new FakeClipboardItem({ 'text/plain': later })] as never);
        activation.isActive = true;
        finish('too late');

        expect(await settledAsync(refused)).toBe(`NotAllowedError: ${PAGE_COPY_NEEDS_GESTURE}`);
        expect(post).not.toHaveBeenCalled();

        let finishAgain: (text: string) => void = () => undefined;
        const ready = new Promise<string>((resolve) => {
            finishAgain = resolve;
        });
        void clipboard.write([new FakeClipboardItem({ 'text/plain': ready })] as never);
        activation.isActive = false;
        finishAgain('made in time');
        await vi.waitFor(() => expect(copies(post)).toHaveLength(1));

        expect(copies(post)[0]).toMatchObject({ isActive: true, content: { 'text/plain': 'made in time' } });
    });

    it('rejects the page\'s promise with the studio\'s reason when the studio could not write', async () => {
        const { clipboard, bridge } = bridgedPage();

        const written = clipboard.writeText('text');
        await Promise.resolve();
        bridge.settle({ id: 1, error: 'Document is not focused.' });

        expect(await settledAsync(written)).toBe('NotAllowedError: Document is not focused.');
    });

    it('hands rich content to the studio: an item\'s text, HTML and PNG picture, the picture as its blob', async () => {
        const { clipboard, post, bridge } = bridgedPage();
        const picture = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });

        const written = clipboard.write([new FakeClipboardItem({
            'text/plain': 'Region\tTotal',
            'text/html': Promise.resolve('<table><tr><td>Region</td></tr></table>'),
            'image/png': picture,
        })] as never);
        await vi.waitFor(() => expect(copies(post)).toHaveLength(1));
        const [message] = copies(post);
        bridge.settle({ id: 1, error: null });

        expect(message).toMatchObject({
            type: 'copy',
            isActive: true,
            content: { 'text/plain': 'Region\tTotal', 'text/html': '<table><tr><td>Region</td></tr></table>' },
        });
        expect(message?.type === 'copy' ? message.content['image/png'] : null).toBe(picture);
        expect(await settledAsync(written)).toBe('resolved');
    });

    it('refuses other types, more than one item and things that are no item, as Chrome does, and writes nothing for no item', async () => {
        const { clipboard, post } = bridgedPage();

        expect(await settledAsync(clipboard.write([new FakeClipboardItem({ 'text/plain': 'a', 'text/uri-list': 'https://example.com/' })] as never)))
            .toBe('NotAllowedError: Type text/uri-list not supported on write.');
        expect(await settledAsync(clipboard.write([new FakeClipboardItem({ 'text/plain': 'a' }), new FakeClipboardItem({ 'text/plain': 'b' })] as never)))
            .toBe('NotAllowedError: Support for multiple ClipboardItems is not implemented.');
        expect(await settledAsync(clipboard.write([{ 'text/plain': 'a' }] as never))).toMatch(/^TypeError/);
        expect(await settledAsync(clipboard.write([]))).toBe('resolved');
        expect(post).not.toHaveBeenCalled();
    });

    it('leaves reading the clipboard to the browser, which refuses it, and settles only the copies it asked for', async () => {
        const { clipboard, bridge } = bridgedPage();

        expect(clipboard.readText).toBe(readText);

        const first = clipboard.writeText('one');
        const second = clipboard.writeText('two');
        await Promise.resolve();
        bridge.settle({ id: 7, error: null });
        bridge.settle({ id: 2, error: 'Refused.' });
        bridge.settle({ id: 2, error: null });
        bridge.settle({ id: 1, error: null });

        expect([await settledAsync(first), await settledAsync(second)]).toEqual(['resolved', 'NotAllowedError: Refused.']);
    });

    it('leaves a window with no clipboard as it is', () => {
        const page = { navigator: {} } as unknown as Window;

        bridgePageClipboard(page, vi.fn());

        expect(page.navigator).toEqual({});
    });
});
