// @vitest-environment-options {"settings":{"handleDisabledFileLoadingAsSuccess":true}}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asRoot, FakeDirectoryHandle, type FakeFileHandle } from '../../common/fs/testing/fakeFileSystem.js';
import { settleAsync } from '../testing/testHelpers.js';
import { attachToFrame, mountHtmlPreview, type HtmlPreviewHandle, type HtmlPreviewOptions } from './htmlPreview.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PAGE = [
    '<!doctype html><html><head><title>Page</title><link rel="stylesheet" href="page.css"></head>',
    '<body><h1 id="top">Hello</h1><img src="../media/dot.png" alt="Dot"><a href="links.md#diffs">links</a>',
    '<script>window.ran = true</script></body></html>',
].join('');

let folder: FakeDirectoryHandle;
let pane: HTMLElement;
let handle: HtmlPreviewHandle | null;
let revoked: string[];

beforeEach(() => {
    folder = new FakeDirectoryHandle('workspace');
    folder.addFile('docs/page.css', 'h1 { color: rgb(1, 2, 3); }');
    folder.addFile('media/dot.png', PNG);
    pane = document.createElement('div');
    document.body.append(pane);
    handle = null;
    revoked = [];
    let counter = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
        counter += 1;

        return `blob:test/${counter}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
        revoked.push(url);
    });
});

afterEach(() => {
    handle?.dispose();
    pane.remove();
    vi.restoreAllMocks();
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

// The frame's srcdoc as a document, since happy-dom doesn't load frame pages.
function shownPage(frame: HTMLIFrameElement): Document {
    return new DOMParser().parseFromString(frame.srcdoc, 'text/html');
}

describe('mountHtmlPreview', () => {
    it('shows the page in a sandboxed frame that allows no scripts', async () => {
        const { frame } = mount(PAGE);
        await settleAsync();

        expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
        expect(frame.getAttribute('title')).toBe('Preview of page.html');
        expect(frame.className).toBe('html-preview-frame');
        expect(frame.srcdoc).not.toContain('<script');
        expect(frame.srcdoc).not.toContain('window.ran');
    });

    it('inlines the linked workspace style sheet and shows workspace images from blob URLs', async () => {
        const { frame } = mount(PAGE);
        await settleAsync();
        const page = shownPage(frame);

        expect(page.querySelector('style[data-href="docs/page.css"]')?.textContent).toBe('h1 { color: rgb(1, 2, 3); }');
        expect(page.querySelector('link')).toBeNull();
        expect(page.querySelector('img')?.getAttribute('src')).toBe('blob:test/1');
        expect(page.querySelector('a')?.getAttribute('title')).toBe('docs/links.md#diffs');
    });

    it('draws the page again once edits pause', async () => {
        const { frame } = mount('<p>one</p>');
        await settleAsync();

        handle!.update('<p>two</p>');
        handle!.update('<p>three</p>');
        expect(frame.srcdoc).toContain('one');

        await settleAsync();

        expect(frame.srcdoc).toContain('three');
        expect(frame.srcdoc).not.toContain('two');
    });

    it('draws the page again when a style sheet or image it uses changes on disk, and not for other files', async () => {
        const { frame } = mount(PAGE);
        await settleAsync();
        const first = frame.srcdoc;

        handle!.refresh(['docs/other.md']);
        await settleAsync();
        expect(frame.srcdoc).toBe(first);

        (folder.find('docs/page.css') as FakeFileHandle).data = new TextEncoder().encode('h1 { color: rgb(4, 5, 6); }');
        handle!.refresh(['docs/page.css']);
        await settleAsync();

        expect(shownPage(frame).querySelector('style[data-href]')?.textContent).toBe('h1 { color: rgb(4, 5, 6); }');
    });

    it('revokes its image URLs when let go', async () => {
        mount(PAGE);
        await settleAsync();

        handle!.dispose();
        handle = null;

        expect(revoked).toEqual(['blob:test/1']);
    });

    it('takes link clicks in the page once it loads, keeps the scroll, and scrolls to a pending heading', async () => {
        const onOpenLink = vi.fn();
        const { frame } = mount(PAGE, { onOpenLink });
        await settleAsync();
        const page = document.implementation.createHTMLDocument('page');
        page.body.innerHTML = '<h1 id="top">Hello</h1><a href="links.md#diffs">links</a>';
        const scrollTo = vi.fn();
        const heading = page.getElementById('top')!;
        heading.scrollIntoView = vi.fn();
        Object.defineProperty(frame, 'contentDocument', { configurable: true, get: () => page });
        Object.defineProperty(frame, 'contentWindow', { configurable: true, get: () => ({ scrollTo, scrollX: 0, scrollY: 40 }) });

        handle!.reveal('top');
        frame.dispatchEvent(new Event('load'));
        page.querySelector('a')!.click();

        expect(onOpenLink).toHaveBeenCalledWith({ path: 'docs/links.md', fragment: 'diffs' });
        expect(scrollTo).toHaveBeenCalledWith(0, 0);
        expect(heading.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    });

    it('reads nothing for a file from outside the workspace', async () => {
        const { frame } = mount(PAGE, { documentPath: null });
        await settleAsync();
        const page = shownPage(frame);

        expect(page.querySelector('style[data-href]')).toBeNull();
        expect(page.querySelector('.nib-image-placeholder')?.textContent).toBe('Image not shown (file outside the workspace): ../media/dot.png');
    });
});

describe('attachToFrame', () => {
    function pageWith(html: string): Document {
        const page = document.implementation.createHTMLDocument('page');
        page.body.innerHTML = html;

        return page;
    }

    function dispatch(target: EventTarget, event: Event): Event {
        target.dispatchEvent(event);

        return event;
    }

    it('opens workspace links, hands web links to the studio, and scrolls in-page links', () => {
        const page = pageWith('<a id="w" href="../data/users.csv">users</a><a id="web" href="https://example.com/">web</a><a id="in" href="#top">top</a><a id="out" href="../../x.md">x</a>');
        const onOpen = vi.fn();
        const onFollow = vi.fn();
        const onFragment = vi.fn();
        const detach = attachToFrame(page, { documentPath: 'docs/page.html', onOpen, onFollow, onFragment });
        const click = (id: string): Event => dispatch(page.getElementById(id)!, new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(click('w').defaultPrevented).toBe(true);
        expect(click('web').defaultPrevented).toBe(true);
        expect(click('in').defaultPrevented).toBe(true);
        expect(click('out').defaultPrevented).toBe(true);

        expect(onOpen).toHaveBeenCalledWith({ path: 'data/users.csv', fragment: null });
        expect(onFollow).toHaveBeenCalledWith('https://example.com/');
        expect(onFragment).toHaveBeenCalledWith('top');
        expect([...document.querySelectorAll('.toast')].map((toast) => toast.textContent)).toContain('../../x.md is outside the workspace.');

        detach();
        click('w');
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('shows a HEIC picture\'s placeholder, since HEIC is never decoded', async () => {
        folder.addFile('docs/photo.heic', new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]));
        const { frame } = mount('<p><img src="photo.heic" alt="Photo"></p>');
        await settleAsync();

        expect(shownPage(frame).querySelector('.nib-image-placeholder')?.textContent).toBe('Nib Studio doesn\'t decode HEIC pictures.');
    });

    it('draws a style sheet from its tab\'s unsaved text', async () => {
        const { frame } = mount(PAGE, {
            unsavedText: (path) => path === 'docs/page.css' ? 'h1 { color: rgb(4, 5, 6); }' : null,
        });
        await settleAsync();

        expect(frame.srcdoc).toContain('h1 { color: rgb(4, 5, 6); }');
        expect(frame.srcdoc).not.toContain('rgb(1, 2, 3)');
    });

    it('opens web links in a new browser tab on a click or a middle click when the studio takes none', () => {
        const page = pageWith('<a id="web" href="https://example.com/">web</a><a id="mail" href="mailto:team@example.com">mail</a><a id="w" href="users.csv">users</a>');
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        const onOpen = vi.fn();
        attachToFrame(page, { documentPath: 'docs/page.html', onOpen });
        const press = (id: string, type: string, button = 0): Event => dispatch(page.getElementById(id)!, new MouseEvent(type, { bubbles: true, cancelable: true, button }));

        expect(press('web', 'click').defaultPrevented).toBe(true);
        expect(press('mail', 'click').defaultPrevented).toBe(true);
        expect(press('web', 'auxclick', 1).defaultPrevented).toBe(true);
        expect(press('w', 'auxclick', 1).defaultPrevented).toBe(true);

        expect(open.mock.calls).toEqual([
            ['https://example.com/', '_blank', 'noopener,noreferrer'],
            ['mailto:team@example.com', '_blank', 'noopener,noreferrer'],
            ['https://example.com/', '_blank', 'noopener,noreferrer'],
        ]);
        expect(onOpen).toHaveBeenCalledWith({ path: 'docs/users.csv', fragment: null });
    });

    it('keeps middle clicks and dropped files from leaving the page, and saves on Ctrl+S', () => {
        const page = pageWith('<a id="web" href="https://example.com/">web</a>');
        const onSave = vi.fn();
        attachToFrame(page, { documentPath: 'docs/page.html', onOpen: vi.fn(), onFollow: vi.fn() }, onSave);

        expect(dispatch(page.getElementById('web')!, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })).defaultPrevented).toBe(true);
        expect(dispatch(page.body, new Event('drop', { bubbles: true, cancelable: true })).defaultPrevented).toBe(true);
        expect(dispatch(page, new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })).defaultPrevented).toBe(true);
        expect(onSave).toHaveBeenCalledTimes(1);
    });
});
