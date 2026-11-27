import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGE_COPY_NEEDS_GESTURE, SANDBOX_CHANNEL } from '../../common/html/sandboxMessages.js';
import { asRoot, FakeDirectoryHandle, type FakeFileHandle } from '../../common/fs/testing/fakeFileSystem.js';
import { stubClipboard, type FakeClipboard } from '../testing/fakeClipboard.js';
import { drawSandboxPage, fakeSandboxPage, type FakeSandboxPage } from '../testing/sandboxFrames.js';
import { settleAsync } from '../testing/testHelpers.js';
import { mountHtmlPreview, type HtmlPreviewHandle, type HtmlPreviewOptions } from './htmlPreview.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PAGE = [
    '<!doctype html><html><head><title>Page</title><link rel="stylesheet" href="page.css"><script src="app.js"></script></head>',
    '<body><h1 id="top">Hello</h1><img src="../media/dot.png" alt="Dot"><a href="links.md#diffs">links</a>',
    '<button onclick="window.clicked = true">Go</button><script>window.ran = true</script></body></html>',
].join('');

let folder: FakeDirectoryHandle;
let pane: HTMLElement;
let handle: HtmlPreviewHandle | null;

beforeEach(() => {
    folder = new FakeDirectoryHandle('workspace');
    folder.addFile('docs/page.css', 'h1 { color: rgb(1, 2, 3); }');
    folder.addFile('docs/app.js', 'window.app = true;');
    folder.addFile('media/dot.png', PNG);
    pane = document.createElement('div');
    document.body.append(pane);
    handle = null;
});

afterEach(() => {
    handle?.dispose();
    pane.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.querySelectorAll('.toast-stack').forEach((stack) => stack.remove());
});

function mount(text: string, overrides: Partial<HtmlPreviewOptions> = {}): HtmlPreviewHandle {
    handle = mountHtmlPreview(pane, text, {
        fileName: 'page.html',
        documentPath: 'docs/page.html',
        root: asRoot(folder),
        onOpenLink: vi.fn(),
        delayMs: 10,
        prefersReducedMotion: () => false,
        ...overrides,
    });

    return handle;
}

function frames(): HTMLIFrameElement[] {
    return [...pane.querySelectorAll<HTMLIFrameElement>('iframe.html-preview-frame')];
}

function parse(html: string | null): Document {
    return new DOMParser().parseFromString(html ?? '', 'text/html');
}

function toastTexts(): string[] {
    return [...document.querySelectorAll('.toast')].map((toast) => toast.textContent ?? '');
}

// A page drawn and shown, as the first drawing of a mounted preview.
async function shownAsync(text: string, overrides: Partial<HtmlPreviewOptions> = {}): Promise<FakeSandboxPage> {
    mount(text, overrides);
    await settleAsync();

    return drawSandboxPage(pane);
}

describe('mountHtmlPreview', () => {
    it('loads the extension\'s sandbox page in a frame that allows scripts, dialogs and forms but no same origin, popups or navigation of the studio', async () => {
        mount(PAGE);
        await settleAsync();
        const [frame] = frames();

        expect(frame?.getAttribute('src')).toBe('sandbox.html');
        expect(frame?.getAttribute('sandbox')).toBe('allow-scripts allow-modals allow-forms');
        expect(frame?.getAttribute('title')).toBe('Preview of page.html');
        expect(frame?.parentElement?.className).toBe('html-preview-host');
        expect(frame?.hasAttribute('srcdoc')).toBe(false);
    });

    it('sends the page once the sandbox page is ready, with its scripts and handlers, and its workspace files read in', async () => {
        const sandbox = await shownAsync(PAGE);
        const page = parse(sandbox.page());
        const scripts = [...page.querySelectorAll('script')];

        expect(sandbox.received[0]).toMatchObject({ channel: SANDBOX_CHANNEL, type: 'render', scroll: { left: 0, top: 0 }, fragment: null, isSmooth: true });
        expect(scripts.map((script) => script.textContent)).toEqual(['', 'window.ran = true']);
        expect(scripts[0]?.getAttribute('src')).toMatch(/^data:text\/javascript;charset=utf-8;base64,/);
        expect(page.querySelector('button')?.getAttribute('onclick')).toBe('window.clicked = true');
        expect(page.querySelector('style[data-href="docs/page.css"]')?.textContent).toBe('h1 { color: rgb(1, 2, 3); }');
        expect(page.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
        expect(page.querySelector('a')?.getAttribute('title')).toBe('docs/links.md#diffs');
    });

    it('shows a new drawing beneath the shown one until its page has loaded, then puts it in its place', async () => {
        const first = await shownAsync('<p>one</p>');

        expect(first.frame.hasAttribute('inert')).toBe(false);

        handle!.update('<p>two</p>');
        handle!.update('<p>three</p>');
        await settleAsync();
        const [next, shown] = frames();

        expect(shown).toBe(first.frame);
        expect(next?.hasAttribute('inert')).toBe(true);

        const second = drawSandboxPage(pane);

        expect(second.page()).toContain('three');
        expect(second.page()).not.toContain('two');
        expect(frames()).toEqual([second.frame]);
        expect(second.frame.hasAttribute('inert')).toBe(false);
        expect(first.frame.isConnected).toBe(false);
    });

    it('shows a new drawing after a while even when its page never finishes loading', async () => {
        await shownAsync('<p>one</p>');
        handle!.update('<p>two</p>');
        await settleAsync();
        vi.useFakeTimers();
        const next = fakeSandboxPage(frames()[0]!);
        next.post({ channel: SANDBOX_CHANNEL, type: 'ready' });

        expect(frames()).toHaveLength(2);

        vi.advanceTimersByTime(1500);

        expect(frames()).toEqual([next.frame]);
    });

    it('keeps the scroll the page reports for the next drawing', async () => {
        const first = await shownAsync('<p>one</p>');
        first.post({ channel: SANDBOX_CHANNEL, type: 'scroll', left: 0, top: 480 });

        handle!.update('<p>two</p>');
        await settleAsync();
        const second = drawSandboxPage(pane);

        expect(second.received[0]).toMatchObject({ type: 'render', scroll: { left: 0, top: 480 } });
    });

    it('ignores messages from other windows, other origins and of other shapes', async () => {
        const onSave = vi.fn();
        const sandbox = await shownAsync('<p>one</p>', { onSave });
        const stranger = { postMessage: vi.fn() } as unknown as Window;

        window.dispatchEvent(new MessageEvent('message', { data: { channel: SANDBOX_CHANNEL, type: 'save' }, origin: 'null', source: stranger }));
        window.dispatchEvent(new MessageEvent('message', { data: { channel: SANDBOX_CHANNEL, type: 'save' }, origin: 'null', source: null }));
        sandbox.post({ channel: SANDBOX_CHANNEL, type: 'save' }, 'chrome-extension://abc');
        sandbox.post({ channel: 'other', type: 'save' });
        sandbox.post({ type: 'save' });
        sandbox.post('save');

        expect(onSave).not.toHaveBeenCalled();

        sandbox.post({ channel: SANDBOX_CHANNEL, type: 'save' });

        expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('follows the page\'s links as the Markdown preview does: workspace files, web pages and missing files', async () => {
        const onOpenLink = vi.fn();
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        const sandbox = await shownAsync(PAGE, { onOpenLink });
        const link = (href: string): void => sandbox.post({ channel: SANDBOX_CHANNEL, type: 'link', href });

        link('links.md#diffs');
        link('../data/');
        link('https://example.com/');
        link('mailto:team@example.com');
        link('../../outside.md');
        link('');

        expect(onOpenLink.mock.calls).toEqual([
            [{ path: 'docs/links.md', fragment: 'diffs' }],
            [{ path: 'data', fragment: null }],
        ]);
        expect(open.mock.calls).toEqual([
            ['https://example.com/', '_blank', 'noopener,noreferrer'],
            ['mailto:team@example.com', '_blank', 'noopener,noreferrer'],
        ]);
        expect(toastTexts()).toContain('../../outside.md is outside the workspace.');
    });

    it('scrolls within the page for an in-page link the page sends', async () => {
        const sandbox = await shownAsync(PAGE);

        sandbox.post({ channel: SANDBOX_CHANNEL, type: 'link', href: '#top' });

        expect(sandbox.received.at(-1)).toEqual({ channel: SANDBOX_CHANNEL, type: 'reveal', fragment: 'top', isSmooth: true });
    });

    it('follows no link without a click or key press behind it, and never a javascript: address', async () => {
        const onOpenLink = vi.fn();
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        const sandbox = await shownAsync(PAGE, { onOpenLink });
        Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: false } });

        try {
            sandbox.post({ channel: SANDBOX_CHANNEL, type: 'link', href: 'links.md' });
        }
        finally {
            Reflect.deleteProperty(navigator, 'userActivation');
        }

        sandbox.post({ channel: SANDBOX_CHANNEL, type: 'link', href: 'javascript:alert(1)' });
        sandbox.post({ channel: SANDBOX_CHANNEL, type: 'link', href: ' java\tscript:alert(1)' });

        expect(onOpenLink).not.toHaveBeenCalled();
        expect(open).not.toHaveBeenCalled();
    });

    it('takes links, Ctrl+S and scrolls only from the shown page, not from the one still loading', async () => {
        const onOpenLink = vi.fn();
        const onSave = vi.fn();
        await shownAsync('<p>one</p>', { onOpenLink, onSave });
        handle!.update('<p>two</p>');
        await settleAsync();
        const next = fakeSandboxPage(frames()[0]!);

        next.post({ channel: SANDBOX_CHANNEL, type: 'link', href: 'links.md' });
        next.post({ channel: SANDBOX_CHANNEL, type: 'save' });

        expect(onOpenLink).not.toHaveBeenCalled();
        expect(onSave).not.toHaveBeenCalled();
    });

    it('reveals a heading in the next page drawn, or in the shown one once it has its page', async () => {
        mount(PAGE);
        handle!.reveal('top');
        await settleAsync();
        const sandbox = drawSandboxPage(pane);

        expect(sandbox.received[0]).toMatchObject({ type: 'render', fragment: 'top', isSmooth: true });

        handle!.reveal('diffs');

        expect(sandbox.received.at(-1)).toEqual({ channel: SANDBOX_CHANNEL, type: 'reveal', fragment: 'diffs', isSmooth: true });
    });

    it('reveals without smooth scrolling when the system asks for reduced motion', async () => {
        const sandbox = await shownAsync(PAGE, { prefersReducedMotion: () => true });

        handle!.reveal('top');

        expect(sandbox.received.at(-1)).toMatchObject({ type: 'reveal', isSmooth: false });
    });

    it('sends the page again when the shown frame reloads its sandbox page', async () => {
        const sandbox = await shownAsync('<p>one</p>');

        sandbox.post({ channel: SANDBOX_CHANNEL, type: 'ready' });

        expect(sandbox.received.filter((message) => message.type === 'render')).toHaveLength(2);
        expect(frames()).toEqual([sandbox.frame]);
    });

    it('draws the page again, once, when its frame goes from the sandbox page to another address', async () => {
        const sandbox = await shownAsync('<p>one</p>');
        vi.useFakeTimers();
        // A frame loads twice, its sandbox page and the page written over it, answered by ready and rendered;
        // happy-dom loads it once by itself, so one more load makes the pair.
        sandbox.frame.dispatchEvent(new Event('load'));
        vi.advanceTimersByTime(1000);

        expect(frames()).toHaveLength(1);

        // A third load, the error page, gets no answer.
        sandbox.frame.dispatchEvent(new Event('load'));
        vi.advanceTimersByTime(1000);
        const [again] = frames();

        expect(frames()).toHaveLength(2);
        expect(toastTexts()).toContain('The page tried to go to another address, which the preview never follows, so it was drawn again.');

        const redrawn = fakeSandboxPage(again!);
        redrawn.post({ channel: SANDBOX_CHANNEL, type: 'ready' });
        redrawn.post({ channel: SANDBOX_CHANNEL, type: 'rendered' });
        redrawn.frame.dispatchEvent(new Event('load'));
        redrawn.frame.dispatchEvent(new Event('load'));
        redrawn.frame.dispatchEvent(new Event('load'));
        vi.advanceTimersByTime(1000);

        expect(frames()).toEqual([redrawn.frame]);
        expect(redrawn.page()).toContain('<p>one</p>');
    });

    it('draws the page again when a style sheet, script or image it uses changes on disk, and not for other files', async () => {
        const first = await shownAsync(PAGE);

        handle!.refresh(['docs/other.md']);
        await settleAsync();

        expect(frames()).toEqual([first.frame]);

        (folder.find('docs/app.js') as FakeFileHandle).data = new TextEncoder().encode('window.changed = true;');
        handle!.refresh(['docs/app.js']);
        await settleAsync();
        const second = drawSandboxPage(pane);
        const source = parse(second.page()).querySelector('script')?.getAttribute('src') ?? '';

        expect(atob(source.slice(source.indexOf(',') + 1))).toContain('window.changed = true;');
    });

    it('draws a style sheet or script from its tab\'s unsaved text', async () => {
        const sandbox = await shownAsync(PAGE, {
            unsavedText: (path) => path === 'docs/page.css' ? 'h1 { color: rgb(4, 5, 6); }' : path === 'docs/app.js' ? 'window.unsaved = true;' : null,
        });
        const page = parse(sandbox.page());
        const source = page.querySelector('script')?.getAttribute('src') ?? '';

        expect(page.querySelector('style[data-href]')?.textContent).toBe('h1 { color: rgb(4, 5, 6); }');
        expect(atob(source.slice(source.indexOf(',') + 1))).toContain('window.unsaved = true;');
    });

    it('reads nothing for a file from outside the workspace', async () => {
        const sandbox = await shownAsync(PAGE, { documentPath: null });
        const page = parse(sandbox.page());

        expect(page.querySelector('style[data-href]')).toBeNull();
        expect(page.querySelectorAll('script')).toHaveLength(1);
        expect(page.querySelector('.nib-image-placeholder')?.textContent).toBe('Image not shown (file outside the workspace): ../media/dot.png');
    });

    it('shows a HEIC picture\'s placeholder, since HEIC is never decoded', async () => {
        folder.addFile('docs/photo.heic', new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]));
        const sandbox = await shownAsync('<p><img src="photo.heic" alt="Photo"></p>');

        expect(parse(sandbox.page()).querySelector('.nib-image-placeholder')?.textContent).toBe('Nib Studio doesn\'t decode HEIC pictures.');
    });

    describe('copies the page asks for', () => {
        let clipboard: FakeClipboard | null = null;

        afterEach(() => {
            clipboard?.restore();
            clipboard = null;
            Reflect.deleteProperty(navigator, 'userActivation');
        });

        const copy = (sandbox: FakeSandboxPage, id: number, content: Readonly<Record<string, unknown>>, isActive = true): void => {
            sandbox.post({ channel: SANDBOX_CHANNEL, type: 'copy', id, isActive, content });
        };

        const answers = (sandbox: FakeSandboxPage): unknown[] => sandbox.received.filter((message) => message.type === 'copied');

        it('puts text the shown page copies on a click on the clipboard, says so, and tells the page it is done', async () => {
            clipboard = stubClipboard();
            const sandbox = await shownAsync('<p>one</p>');

            copy(sandbox, 1, { 'text/plain': 'flowchart LR\n    A --> B' });
            await settleAsync();

            expect(clipboard.writeText).toHaveBeenCalledWith('flowchart LR\n    A --> B');
            expect(toastTexts()).toContain('Copied from the page.');
            expect(answers(sandbox)).toEqual([{ channel: SANDBOX_CHANNEL, type: 'copied', id: 1, error: null }]);
        });

        it('puts a rich copy\'s text, HTML and PNG picture on the clipboard as one item', async () => {
            clipboard = stubClipboard();
            const sandbox = await shownAsync('<p>one</p>');
            const picture = new Blob(['png bytes'], { type: 'image/png' });

            copy(sandbox, 2, { 'text/plain': 'Hi', 'text/html': '<b>Hi</b>', 'image/png': picture });
            await settleAsync();

            expect(clipboard.writeText).not.toHaveBeenCalled();
            expect([...clipboard.last()]).toEqual([['text/plain', 'Hi'], ['text/html', '<b>Hi</b>'], ['image/png', 'png bytes']]);
            expect(answers(sandbox)).toEqual([{ channel: SANDBOX_CHANNEL, type: 'copied', id: 2, error: null }]);
        });

        it('writes nothing without a click or key press, in the page or reaching the studio, nor for a page still loading', async () => {
            clipboard = stubClipboard();
            const sandbox = await shownAsync('<p>one</p>');

            copy(sandbox, 1, { 'text/plain': 'page alone' }, false);
            Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: false } });
            copy(sandbox, 2, { 'text/plain': 'studio not active' });
            Reflect.deleteProperty(navigator, 'userActivation');
            handle!.update('<p>two</p>');
            await settleAsync();
            const next = fakeSandboxPage(frames()[0]!);
            copy(next, 3, { 'text/plain': 'still loading' });
            await settleAsync();

            expect(clipboard.writes).toEqual([]);
            expect(toastTexts()).not.toContain('Copied from the page.');
            expect(answers(sandbox)).toEqual([
                { channel: SANDBOX_CHANNEL, type: 'copied', id: 1, error: PAGE_COPY_NEEDS_GESTURE },
                { channel: SANDBOX_CHANNEL, type: 'copied', id: 2, error: PAGE_COPY_NEEDS_GESTURE },
            ]);
            expect(answers(next)).toEqual([{ channel: SANDBOX_CHANNEL, type: 'copied', id: 3, error: PAGE_COPY_NEEDS_GESTURE }]);
        });

        it('takes a copy only from its own frame, from the opaque origin, in a known shape', async () => {
            clipboard = stubClipboard();
            const sandbox = await shownAsync('<p>one</p>');
            const stranger = { postMessage: vi.fn() } as unknown as Window;
            const data = { channel: SANDBOX_CHANNEL, type: 'copy', id: 1, isActive: true, content: { 'text/plain': 'x' } };

            window.dispatchEvent(new MessageEvent('message', { data, origin: 'null', source: stranger }));
            sandbox.post(data, 'chrome-extension://abc');
            sandbox.post({ ...data, content: { 'text/uri-list': 'https://example.com/' } });
            await settleAsync();

            expect(clipboard.writes).toEqual([]);
            expect(answers(sandbox)).toEqual([]);
        });

        it('tells the page why its copy failed, and says so in a toast', async () => {
            clipboard = stubClipboard({ failWith: new DOMException('Document is not focused.', 'NotAllowedError') });
            const sandbox = await shownAsync('<p>one</p>');

            copy(sandbox, 1, { 'text/plain': 'text' });
            await settleAsync();

            expect(toastTexts()).toContain('Could not copy: Document is not focused.');
            expect(answers(sandbox)).toEqual([{ channel: SANDBOX_CHANNEL, type: 'copied', id: 1, error: 'Document is not focused.' }]);
        });
    });

    it('stops listening to the page once let go', async () => {
        const onSave = vi.fn();
        const sandbox = await shownAsync('<p>one</p>', { onSave });

        handle!.dispose();
        handle = null;
        sandbox.post({ channel: SANDBOX_CHANNEL, type: 'save' });

        expect(onSave).not.toHaveBeenCalled();
    });
});
