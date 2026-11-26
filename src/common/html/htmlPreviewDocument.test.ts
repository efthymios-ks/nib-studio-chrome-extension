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

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

async function buildAsync(
    html: string,
    documentPath: string | null = 'site/page.html',
    unsavedText: (path: string) => string | null = () => null,
) {
    const resources = createWorkspaceResources(asRoot(folder), { unsavedText });
    const preview = await buildHtmlPreviewAsync(html, { documentPath, resources: documentPath == null ? null : resources });
    const page = new DOMParser().parseFromString(preview.html, 'text/html');

    return { ...preview, page };
}

describe('buildHtmlPreviewAsync', () => {
    it('reads linked workspace style sheets in, with their images as data: URLs', async () => {
        const { page, paths } = await buildAsync('<html><head><link rel="stylesheet" href="page.css" media="screen"></head><body><p>Hi</p></body></html>');
        const style = page.querySelector('style[data-href="site/page.css"]');

        expect(page.querySelector('link')).toBeNull();
        expect(style?.textContent).toBe('@media screen {\nbody { color: #123456; background: url("data:image/png;base64,iVBORw0KGgo="); }\n}');
        expect([...paths].sort()).toEqual(['site/img/bg.png', 'site/page.css']);
    });

    it('drops web style sheets and every other link', async () => {
        const { page, html } = await buildAsync([
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
        const { page, html } = await buildAsync([
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

    it('shows workspace images from data: URLs and puts placeholders for web and missing ones', async () => {
        const { page, paths } = await buildAsync([
            '<img src="img/logo.png" alt="Logo">',
            '<img src="https://example.com/a.png" alt="Web">',
            '<img src="img/missing.png" alt="">',
            '<img src="data:image/png;base64,AA" srcset="img/logo.png 2x">',
        ].join(''));
        const images = page.querySelectorAll('img');
        const placeholders = [...page.querySelectorAll('.nib-image-placeholder')].map((placeholder) => placeholder.textContent);

        expect(images[0]?.getAttribute('src')).toBe(PNG_DATA_URL);
        expect(images[1]?.hasAttribute('hidden')).toBe(true);
        expect(images[3]?.getAttribute('src')).toBe('data:image/png;base64,AA');
        expect(images[3]?.hasAttribute('srcset')).toBe(false);
        expect(placeholders).toEqual(['Remote image not loaded (offline): https://example.com/a.png', 'Image not found: img/missing.png']);
        expect(page.querySelector('style')?.textContent).toContain('.nib-image-placeholder');
        expect([...paths].sort()).toEqual(['site/img/logo.png', 'site/img/missing.png']);
    });

    it('reads other files the page loads from the workspace, and drops web ones', async () => {
        const { page } = await buildAsync([
            '<video src="../media/clip.mp4" poster="https://example.com/poster.png"></video>',
            '<table background="img/bg.png"><tr><td>x</td></tr></table>',
            '<svg><image href="img/logo.png"></image><image href="https://example.com/a.png"></image></svg>',
        ].join(''));

        expect(page.querySelector('video')?.getAttribute('src')).toBe('data:application/octet-stream;base64,AAAAGA==');
        expect(page.querySelector('video')?.hasAttribute('poster')).toBe(false);
        expect(page.querySelector('table')?.getAttribute('background')).toBe(PNG_DATA_URL);
        expect(page.querySelector('image')?.getAttribute('href')).toBe(PNG_DATA_URL);
        expect(page.querySelectorAll('image')[1]?.hasAttribute('href')).toBe(false);
    });

    it('keeps the page\'s own scripts, handlers and forms as written, for the sandbox page to run', async () => {
        const { html, page } = await buildAsync([
            '<html><head><meta charset="utf-8"><script>window.ran = 1;</script></head>',
            '<body onload="window.loaded = 1"><button onclick="window.clicked = 1">a</button>',
            '<script type="module">window.module = 1;</script>',
            '<form onsubmit="return false"><input name="q"></form>',
            '<a href="javascript:void(0)" target="_blank">run</a>',
            '</body></html>',
        ].join(''));

        for (const kept of [
            '<script>window.ran = 1;</script>',
            'onload="window.loaded = 1"',
            'onclick="window.clicked = 1"',
            '<script type="module">window.module = 1;</script>',
            '<form onsubmit="return false">',
            'href="javascript:void(0)"',
            '<meta charset="utf-8">',
        ]) {
            expect(html).toContain(kept);
        }

        expect(page.querySelectorAll('script')).toHaveLength(2);
    });

    it('leaves out frames and embedded objects, in templates too, keeping an object\'s fallback content', async () => {
        const { html, page, paths } = await buildAsync([
            '<iframe srcdoc="<script>new RTCPeerConnection()</script>"></iframe>',
            '<embed src="img/logo.png">',
            '<object data="img/logo.png"><p id="fallback">Logo</p></object>',
            '<div><template shadowrootmode="closed"><iframe srcdoc="<p>shadow</p>"></iframe><template><embed src="x.png"></template></template></div>',
            '<p id="after">after</p>',
        ].join(''));

        expect(html).not.toMatch(/<(iframe|embed|object|frame)\b/);
        expect(html).not.toContain('srcdoc');
        expect(html.match(/<!-- frame left out -->/g)).toHaveLength(5);
        expect(page.getElementById('fallback')?.textContent).toBe('Logo');
        expect(page.getElementById('after')?.textContent).toBe('after');
        expect([...paths]).toEqual([]);
    });

    it('drops what would send the page elsewhere: <base> and a refresh <meta>', async () => {
        const { html } = await buildAsync([
            '<html><head><base href="https://example.com/"><meta http-equiv="Refresh" content="0;url=https://example.com/">',
            '<meta name="viewport" content="width=device-width"></head><body><p>x</p></body></html>',
        ].join(''));

        expect(html).not.toContain('<base');
        expect(html).not.toContain('Refresh');
        expect(html).not.toContain('example.com');
        expect(html).toContain('<meta name="viewport" content="width=device-width">');
    });

    it('reads a workspace script in as a data: URL of its text, keeping its attributes and place', async () => {
        folder.addFile('site/js/app.js', 'document.title = "café";');
        const { page, paths } = await buildAsync([
            '<html><head><script src="js/app.js" defer data-role="app"></script></head>',
            '<body><script>window.inline = 1;</script><script src="/site/js/app.js" type="module"></script></body></html>',
        ].join(''));
        const scripts = [...page.querySelectorAll('script')];
        const [first, , last] = scripts;
        const source = first?.getAttribute('src') ?? '';

        expect(source.startsWith('data:text/javascript;charset=utf-8;base64,')).toBe(true);
        expect(decodeDataUrl(source)).toBe('document.title = "café";\n//# sourceURL=site/js/app.js\n');
        expect(first?.hasAttribute('defer')).toBe(true);
        expect(first?.getAttribute('data-role')).toBe('app');
        expect(scripts.map((script) => script.parentElement?.localName)).toEqual(['head', 'body', 'body']);
        expect(last?.getAttribute('type')).toBe('module');
        expect(last?.getAttribute('src')).toBe(source);
        expect([...paths]).toContain('site/js/app.js');
    });

    it('reads a workspace script from its tab\'s unsaved text', async () => {
        folder.addFile('site/app.js', 'window.saved = 1;');
        const { page } = await buildAsync('<script src="app.js"></script>', 'site/page.html', (path) => path === 'site/app.js' ? 'window.unsaved = 1;' : null);

        expect(decodeDataUrl(page.querySelector('script')?.getAttribute('src') ?? '')).toBe('window.unsaved = 1;\n//# sourceURL=site/app.js\n');
    });

    it('leaves out web scripts and scripts outside the workspace, and says when one is missing', async () => {
        const { html, page, paths } = await buildAsync([
            '<script src="https://example.com/lib.js"></script>',
            '<script src="//cdn.example.com/lib.js"></script>',
            '<script src="../../outside.js"></script>',
            '<script src="C:\\scripts\\disk.js"></script>',
            '<script src="missing.js"></script>',
            '<script src="data:text/javascript,window.data%20%3D%201"></script>',
        ].join(''));

        expect(html).not.toContain('example.com');
        expect(html).not.toContain('outside.js');
        expect(html).not.toContain('disk.js');
        expect(html.match(/<!-- script left out -->/g)).toHaveLength(4);
        expect(html).toContain('<!-- script not found -->');
        expect([...page.querySelectorAll('script')].map((script) => script.getAttribute('src'))).toEqual(['data:text/javascript,window.data%20%3D%201']);
        expect([...paths]).toEqual(['site/missing.js']);
    });

    it('reads no script for a file from outside the workspace', async () => {
        folder.addFile('site/app.js', 'window.saved = 1;');
        const { html, paths } = await buildAsync('<script src="app.js"></script><script>window.inline = 1;</script>', null);

        expect(html).toContain('<!-- script left out -->');
        expect(html).toContain('<script>window.inline = 1;</script>');
        expect(paths.size).toBe(0);
    });

    it('titles workspace links with their path, after any title of their own, and leaves other links alone', async () => {
        const { page } = await buildAsync('<a href="../docs/guide.md#setup">guide</a><a href="https://example.com/">web</a><a href="a.html" title="Own">own</a>');
        const links = page.querySelectorAll('a');

        expect(links[0]?.getAttribute('title')).toBe('docs/guide.md#setup');
        expect(links[1]?.hasAttribute('title')).toBe(false);
        expect(links[2]?.getAttribute('title')).toBe('Own\nsite/a.html');
    });

    it('turns an SVG link\'s xlink:href into href, so the studio follows it', async () => {
        const { page } = await buildAsync('<svg><a xlink:href="guide.md"><text>guide</text></a></svg>');
        const link = page.querySelector('a');

        expect(link?.getAttribute('href')).toBe('guide.md');
        expect(link?.hasAttribute('xlink:href')).toBe(false);
        expect(link?.getAttribute('title')).toBe('site/guide.md');
    });

    it('reads nothing for a file from outside the workspace', async () => {
        const { page, paths } = await buildAsync('<link rel="stylesheet" href="page.css"><img src="img/logo.png"><p style="background: url(img/bg.png)">x</p>', null);

        expect(paths.size).toBe(0);
        expect(page.querySelector('[data-href]')).toBeNull();
        expect(page.querySelector('.nib-image-placeholder')?.textContent).toBe('Image not shown (file outside the workspace): img/logo.png');
        expect(page.querySelector('p')?.getAttribute('style')).toBe('background: none');
    });

    it('makes a whole document, with the page\'s own doctype or none, so a page without one draws in quirks mode', async () => {
        const fragment = await buildAsync('<p>Just a paragraph</p>');
        const standard = await buildAsync('<!DOCTYPE html><p>Standard</p>');

        expect(fragment.html.startsWith('<html><head>')).toBe(true);
        expect(fragment.page.body.textContent).toBe('Just a paragraph');
        expect(standard.html.startsWith('<!DOCTYPE html>\n<html>')).toBe(true);
    });
});

// The text a base64 data: URL carries.
function decodeDataUrl(url: string): string {
    const base64 = url.slice(url.indexOf(',') + 1);

    return new TextDecoder().decode(Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)));
}
