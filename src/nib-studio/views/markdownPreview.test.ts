import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asRoot, FakeDirectoryHandle, type FakeFileHandle } from '../../common/fs/testing/fakeFileSystem.js';
import { settleAsync } from '../testing/testHelpers.js';
import { mountMarkdownPreview, type MarkdownPreviewHandle } from './markdownPreview.js';

vi.mock('./mermaidBridge.js', () => ({ renderMermaidIntoAsync: vi.fn(async () => {}) }));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let folder: FakeDirectoryHandle;
let article: HTMLElement;
let preview: MarkdownPreviewHandle | null;
let created: string[];
let revoked: string[];

beforeEach(() => {
    folder = new FakeDirectoryHandle('workspace');
    folder.addFile('media/transparent.png', PNG);
    folder.addFile('media/drawing.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    folder.addFile('docs/architecture.md', '# Architecture');
    article = document.createElement('article');
    document.body.append(article);
    preview = null;
    created = [];
    revoked = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
        const url = `blob:test/${created.length + 1}`;
        created.push(url);

        return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
        revoked.push(url);
    });
});

afterEach(() => {
    preview?.dispose();
    article.remove();
    vi.restoreAllMocks();
    document.querySelectorAll('.toast-stack').forEach((stack) => stack.remove());
});

function mount(documentPath: string | null = 'docs/links.md', onOpenLink = vi.fn()): MarkdownPreviewHandle {
    preview = mountMarkdownPreview(article, { documentPath, root: asRoot(folder), onOpenLink, prefersReducedMotion: () => false });

    return preview;
}

function imageSources(): Array<string | null> {
    return [...article.querySelectorAll('img')].map((image) => image.getAttribute('src'));
}

function placeholders(): string[] {
    return [...article.querySelectorAll('.md-image-blocked')].map((placeholder) => placeholder.textContent ?? '');
}

describe('mountMarkdownPreview', () => {
    it('shows relative, /-rooted and SVG images from blob URLs, one per file, and placeholders for missing and web ones', async () => {
        mount().render([
            '![Transparent](../media/transparent.png)',
            '![Root](/media/transparent.png)',
            '![Drawing](../media/drawing.svg)',
            '![Missing](images/chart.png)',
            '![Web](https://example.com/a.png)',
        ].join('\n\n'));
        await settleAsync();

        expect(imageSources()).toEqual(['blob:test/1', 'blob:test/1', 'blob:test/2', null]);
        expect(placeholders()).toEqual(['Image not found: images/chart.png', 'Remote image not loaded (offline): https://example.com/a.png']);
    });

    it('reads each image once and revokes the URLs of images a new render no longer shows', async () => {
        const handle = mount();
        handle.render('![a](../media/transparent.png) ![b](../media/drawing.svg)');
        await settleAsync();

        handle.render('![a](../media/transparent.png) and more text');
        await settleAsync();

        expect(created).toEqual(['blob:test/1', 'blob:test/2']);
        expect(imageSources()).toEqual(['blob:test/1']);
        expect(revoked).toEqual(['blob:test/2']);
    });

    it('revokes every URL when it is let go', async () => {
        const handle = mount();
        handle.render('![a](../media/transparent.png)');
        await settleAsync();

        handle.dispose();
        preview = null;

        expect(revoked).toEqual(['blob:test/1']);
    });

    it('draws an image again when its file changes on disk, and brings back one that appears', async () => {
        const handle = mount();
        handle.render('![a](../media/transparent.png) ![b](../media/new.png)');
        await settleAsync();

        (folder.find('media/transparent.png') as FakeFileHandle).data = new Uint8Array([...PNG, 1]);
        folder.addFile('media/new.png', PNG);
        handle.refresh(['media/transparent.png', 'media/new.png']);
        await settleAsync();

        expect(imageSources()).toEqual(['blob:test/2', 'blob:test/3']);
        expect(placeholders()).toEqual([]);
        expect(revoked).toEqual(['blob:test/1']);
    });

    it('ignores changes to files it doesn\'t show', async () => {
        const handle = mount();
        handle.render('![a](../media/transparent.png)');
        await settleAsync();

        handle.refresh(['docs/other.md']);
        await settleAsync();

        expect(created).toEqual(['blob:test/1']);
    });

    it('says a file from outside the workspace shows no relative images', async () => {
        mount(null).render('![a](../media/transparent.png)');
        await settleAsync();

        expect(placeholders()).toEqual(['Image not shown (file outside the workspace): ../media/transparent.png']);
        expect(created).toEqual([]);
    });

    it('opens workspace links and titles them with their path', () => {
        const onOpenLink = vi.fn();
        mount('docs/links.md', onOpenLink).render('[Diffs](architecture.md#diffs) [Users](../data/users.csv) [Web](https://example.com/)');
        const links = article.querySelectorAll('a');

        links[0]?.click();
        links[1]?.click();

        expect(onOpenLink.mock.calls).toEqual([
            [{ path: 'docs/architecture.md', fragment: 'diffs' }],
            [{ path: 'data/users.csv', fragment: null }],
        ]);
        expect([...links].map((link) => link.getAttribute('title'))).toEqual(['docs/architecture.md#diffs', 'data/users.csv', null]);
    });

    it('shows a HEIC picture\'s placeholder, since HEIC is never decoded', async () => {
        folder.addFile('media/photo.heic', new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]));
        mount().render('![Photo](../media/photo.heic)');
        await settleAsync();

        expect(placeholders()).toEqual(['Nib Studio doesn\'t decode HEIC pictures.']);
        expect(created).toEqual([]);
    });

    it('opens web, mailto and tel links in a new browser tab', () => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        mount().render('[Web](https://example.com/) [Mail](mailto:team@example.com) [Call](tel:+302100000000)');
        const events = [...article.querySelectorAll('a')].map((link) => {
            const event = new MouseEvent('click', { bubbles: true, cancelable: true });
            link.dispatchEvent(event);

            return event;
        });

        expect(events.map((event) => event.defaultPrevented)).toEqual([true, true, true]);
        expect(open.mock.calls.map((call) => call[0])).toEqual(['https://example.com/', 'mailto:team@example.com', 'tel:+302100000000']);
        expect(open.mock.calls.every((call) => call[1] === '_blank' && call[2] === 'noopener,noreferrer')).toBe(true);
    });

    it('renders README HTML and never runs a script', async () => {
        mount().render('<p align="center"><img src="../media/transparent.png" width="40"></p>\n\n<details><summary>More</summary>Hidden</details>\n\n<script>window.ran = true</script>');
        await settleAsync();

        expect(article.querySelector('p[align="center"] img')?.getAttribute('src')).toBe('blob:test/1');
        expect(article.querySelector('details summary')?.textContent).toBe('More');
        expect(article.querySelector('script')).toBeNull();
        expect((window as unknown as { ran?: boolean }).ran).toBeUndefined();
    });

    it('scrolls smoothly to a heading once the images above it have loaded', async () => {
        const handle = mount();
        handle.render('![a](../media/transparent.png)\n\n## Set up\n\nText');
        const heading = article.querySelector('h2')!;
        const scrollIntoView = vi.fn();
        heading.scrollIntoView = scrollIntoView;

        expect(await handle.revealAsync('set-up')).toBe(true);
        expect(imageSources()).toEqual(['blob:test/1']);
        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
        expect(await handle.revealAsync('nowhere')).toBe(false);
    });
});
