// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"handleDisabledFileLoadingAsSuccess":true}}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asRoot, FakeDirectoryHandle } from '../fs/testing/fakeFileSystem.js';
import { createWorkspaceResources } from '../fs/workspaceResources.js';
import { buildHtmlPreviewAsync } from './htmlPreviewDocument.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let folder: FakeDirectoryHandle;

beforeEach(() => {
    folder = new FakeDirectoryHandle('workspace');
    folder.addFile('site/page.css', 'body { color: #123456; background: url(img/bg.png); }');
    folder.addFile('site/img/bg.png', PNG);
    folder.addFile('site/img/logo.png', PNG);
    folder.addFile('media/clip.mp4', new Uint8Array([0, 0, 0, 24]));
    let counter = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
        counter += 1;

        return `blob:test/${counter}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

async function build(html: string, documentPath: string | null = 'site/page.html') {
    const resources = createWorkspaceResources(asRoot(folder));
    const preview = await buildHtmlPreviewAsync(html, { documentPath, resources: documentPath == null ? null : resources });
    const page = new DOMParser().parseFromString(preview.html, 'text/html');

    return { ...preview, page };
}

describe('buildHtmlPreviewAsync', () => {
    it('reads linked workspace style sheets in, with their images as data: URLs', async () => {
        const { page, paths } = await build('<html><head><link rel="stylesheet" href="page.css" media="screen"></head><body><p>Hi</p></body></html>');
        const style = page.querySelector('style[data-href="site/page.css"]');

        expect(page.querySelector('link')).toBeNull();
        expect(style?.textContent).toBe('@media screen {\nbody { color: #123456; background: url("data:image/png;base64,iVBORw0KGgo="); }\n}');
        expect([...paths].sort()).toEqual(['site/img/bg.png', 'site/page.css']);
    });

    it('drops web style sheets and every other link', async () => {
        const { page, html } = await build([
            '<link rel="stylesheet" href="https://example.com/a.css">',
            '<link rel="icon" href="img/logo.png">',
            '<link rel="preload" href="page.css">',
            '<link rel="stylesheet" href="missing.css">',
            '<p>x</p>',
        ].join(''));

        expect(page.querySelector('link')).toBeNull();
        expect(html).not.toContain('example.com');
        expect(page.querySelectorAll('style')).toHaveLength(1);
    });

    it('keeps the page\'s own styles and style attributes, rewriting their addresses', async () => {
        const { page, html } = await build([
            '<style>h1 { color: red; background: url(https://example.com/x.png); }</style>',
            '<style data-href="site/page.css">@import url(https://example.com/web.css); p { color: blue; }</style>',
            '<h1 style="background: url(img/logo.png)">T</h1>',
        ].join(''));
        const styles = [...page.querySelectorAll('style')].map((style) => style.textContent);

        expect(styles).toContain('h1 { color: red; background: none; }');
        expect(styles).toContain(' p { color: blue; }');
        expect(html).not.toContain('example.com');
        expect(page.querySelector('h1')?.getAttribute('style')).toBe('background: url("data:image/png;base64,iVBORw0KGgo=")');
    });

    it('shows workspace images from blob URLs and puts placeholders for web and missing ones', async () => {
        const { page, paths } = await build([
            '<img src="img/logo.png" alt="Logo">',
            '<img src="https://example.com/a.png" alt="Web">',
            '<img src="img/missing.png" alt="">',
            '<img src="data:image/png;base64,AA" srcset="img/logo.png 2x">',
        ].join(''));
        const images = page.querySelectorAll('img');
        const placeholders = [...page.querySelectorAll('.nib-image-placeholder')].map((placeholder) => placeholder.textContent);

        expect(images[0]?.getAttribute('src')).toBe('blob:test/1');
        expect(images[1]?.hasAttribute('hidden')).toBe(true);
        expect(images[3]?.getAttribute('src')).toBe('data:image/png;base64,AA');
        expect(images[3]?.hasAttribute('srcset')).toBe(false);
        expect(placeholders).toEqual(['Remote image not loaded (offline): https://example.com/a.png', 'Image not found: img/missing.png']);
        expect(page.querySelector('style')?.textContent).toContain('.nib-image-placeholder');
        expect([...paths].sort()).toEqual(['site/img/logo.png', 'site/img/missing.png']);
    });

    it('reads other files the page loads from the workspace, and drops web ones', async () => {
        const { page } = await build([
            '<video src="../media/clip.mp4" poster="https://example.com/poster.png"></video>',
            '<table background="img/bg.png"><tr><td>x</td></tr></table>',
            '<svg><image href="img/logo.png"></image><image href="https://example.com/a.png"></image></svg>',
        ].join(''));

        expect(page.querySelector('video')?.getAttribute('src')).toMatch(/^blob:test\//);
        expect(page.querySelector('video')?.hasAttribute('poster')).toBe(false);
        expect(page.querySelector('table')?.getAttribute('background')).toMatch(/^blob:test\//);
        expect(page.querySelector('image')?.getAttribute('href')).toMatch(/^blob:test\//);
        expect(page.querySelectorAll('image')[1]?.hasAttribute('href')).toBe(false);
    });

    it('never keeps scripts, handlers, frames, objects, forms, base or meta', async () => {
        const { html } = await build([
            '<html><head><base href="https://example.com/"><meta http-equiv="refresh" content="0;url=https://example.com/">',
            '<script src="main.js"></script></head>',
            '<body onload="window.ran = 1"><p onclick="window.ran = 1">a</p><script>window.ran = 1</script>',
            '<iframe srcdoc="<p>framed</p>"></iframe><object data="x.swf"></object><embed src="x.swf">',
            '<form action="https://example.com/"><input name="q"><button formaction="https://example.com/">Go</button></form>',
            '<a href="javascript:alert(1)" target="_blank" ping="https://example.com/">bad</a>',
            '<noscript><p>no script</p></noscript></body></html>',
        ].join(''));

        for (const forbidden of ['<script', 'main.js', 'framed', 'onload', 'onclick', 'window.ran', '<iframe', '<object', '<embed', '<form', 'formaction', '<base', '<meta', 'javascript:', 'target=', 'ping=', '<noscript']) {
            expect(html).not.toContain(forbidden);
        }

        expect(html).toContain('<input name="q">');
        expect(html).toContain('<a>bad</a>');
    });

    it('titles workspace links with their path, after any title of their own, and leaves other links alone', async () => {
        const { page } = await build('<a href="../docs/guide.md#setup">guide</a><a href="https://example.com/">web</a><a href="a.html" title="Own">own</a>');
        const links = page.querySelectorAll('a');

        expect(links[0]?.getAttribute('title')).toBe('docs/guide.md#setup');
        expect(links[1]?.hasAttribute('title')).toBe(false);
        expect(links[2]?.getAttribute('title')).toBe('Own\nsite/a.html');
    });

    it('turns an SVG link\'s xlink:href into href, so the studio follows it', async () => {
        const { page } = await build('<svg><a xlink:href="guide.md"><text>guide</text></a></svg>');
        const link = page.querySelector('a');

        expect(link?.getAttribute('href')).toBe('guide.md');
        expect(link?.hasAttribute('xlink:href')).toBe(false);
        expect(link?.getAttribute('title')).toBe('site/guide.md');
    });

    it('reads nothing for a file from outside the workspace', async () => {
        const { page, paths } = await build('<link rel="stylesheet" href="page.css"><img src="img/logo.png"><p style="background: url(img/bg.png)">x</p>', null);

        expect(paths.size).toBe(0);
        expect(page.querySelector('[data-href]')).toBeNull();
        expect(page.querySelector('.nib-image-placeholder')?.textContent).toBe('Image not shown (file outside the workspace): img/logo.png');
        expect(page.querySelector('p')?.getAttribute('style')).toBe('background: none');
    });

    it('makes a whole document with a doctype', async () => {
        const { html, page } = await build('<p>Just a paragraph</p>');

        expect(html.startsWith('<!doctype html>\n<html>')).toBe(true);
        expect(page.body.textContent).toBe('Just a paragraph');
    });
});
