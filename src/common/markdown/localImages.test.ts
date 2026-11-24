// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import type { DocumentResources } from '../fs/workspaceResources.js';
import {
    dataUrlByteLength,
    embedLocalImagesAsync,
    formatSrcset,
    imageSourceKind,
    localImageTarget,
    parseSrcset,
    peekLocalImage,
    resolveLocalImagesAsync,
    tooLargeToEmbedLabel,
    type LocalImageContext,
} from './localImages.js';

// Images in a map of workspace paths; a path missing from it is a missing file, and one in `problems` is found but can't show.
function fakeResources(
    files: Record<string, string>,
    problems: Record<string, string> = {},
): DocumentResources & { reads: string[]; files: Record<string, string> } {
    const settled = new Map<string, string | null>();
    const reads: string[] = [];

    return {
        files,
        reads,
        imageUrlAsync: async (path) => {
            reads.push(path);
            const url = files[path] == null ? null : `blob:${files[path]}`;
            settled.set(path, url);

            return url;
        },
        peekImageUrl: (path) => settled.get(path),
        imageProblem: (path) => problems[path] ?? null,
        dataUrlAsync: async (path) => (files[path] == null ? null : `data:image/png;base64,${files[path]}`),
        textAsync: async () => null,
    };
}

// A data: URL whose Base64 holds this many bytes.
function base64Of(byteCount: number): string {
    return btoa('x'.repeat(byteCount));
}

function contextFor(resources: DocumentResources | null, documentPath: string | null = 'docs/links.md'): LocalImageContext {
    return { documentPath, resources };
}

function fragmentOf(html: string): HTMLElement {
    const container = document.createElement('div');
    container.innerHTML = html;

    return container;
}

describe('imageSourceKind', () => {
    it('tells web, inline and local addresses apart', () => {
        expect(imageSourceKind('https://example.com/a.png')).toBe('web');
        expect(imageSourceKind('//cdn.example.com/a.png')).toBe('web');
        expect(imageSourceKind('data:image/png;base64,AA')).toBe('inline');
        expect(imageSourceKind('blob:chrome-extension://id/x')).toBe('inline');
        expect(imageSourceKind('../media/a.png')).toBe('local');
        expect(imageSourceKind('/media/a.png')).toBe('local');
        expect(imageSourceKind('C:\\media\\a.png')).toBe('local');
        expect(imageSourceKind('')).toBe('local');
    });
});

describe('localImageTarget', () => {
    const resources = fakeResources({});

    it('reads workspace images by their resolved path', () => {
        expect(localImageTarget('../media/a%20b.png?v=1', '', contextFor(resources))).toEqual({ kind: 'read', path: 'media/a b.png', resources });
        expect(localImageTarget('/media/a.png', '', contextFor(resources))).toEqual({ kind: 'read', path: 'media/a.png', resources });
    });

    it('labels images that can\'t be read', () => {
        expect(localImageTarget('', 'Logo', contextFor(resources))).toEqual({ kind: 'placeholder', label: 'Image not shown: Logo' });
        expect(localImageTarget('https://example.com/a.png', '', contextFor(resources))).toEqual({
            kind: 'placeholder',
            label: 'Remote image not loaded (offline): https://example.com/a.png',
        });
        expect(localImageTarget('../../../a.png', '', contextFor(resources))).toEqual({ kind: 'placeholder', label: 'Image outside the workspace: ../../../a.png' });
        expect(localImageTarget('#top', '', contextFor(resources))).toEqual({ kind: 'placeholder', label: 'Image not found: #top' });
    });

    it('says why a file from outside the workspace shows no relative images', () => {
        expect(localImageTarget('images/a.png', '', contextFor(null, null))).toEqual({
            kind: 'placeholder',
            label: 'Image not shown (file outside the workspace): images/a.png',
        });
        expect(localImageTarget('images/a.png', '', contextFor(resources, null)).kind).toBe('placeholder');
    });

    it('loads inline images as they are', () => {
        expect(localImageTarget('data:image/png;base64,AA', '', contextFor(null, null))).toEqual({ kind: 'url', url: 'data:image/png;base64,AA' });
    });
});

describe('peekLocalImage', () => {
    it('knows an image once it was read, and nothing before', async () => {
        const resources = fakeResources({ 'docs/a.png': 'a' });
        const context = contextFor(resources);

        expect(peekLocalImage('a.png', '', context)).toBeNull();

        await resources.imageUrlAsync('docs/a.png');
        await resources.imageUrlAsync('docs/gone.png');

        expect(peekLocalImage('a.png', '', context)).toEqual({ kind: 'image', url: 'blob:a' });
        expect(peekLocalImage('gone.png', '', context)).toEqual({ kind: 'placeholder', label: 'Image not found: gone.png' });
        expect(peekLocalImage('https://x.test/a.png', '', context)?.kind).toBe('placeholder');
    });
});

describe('resolveLocalImagesAsync', () => {
    const options = { format: 'blob', placeholderClass: 'md-image-blocked' } as const;

    it('shows found images and puts a placeholder after missing ones', async () => {
        const resources = fakeResources({ 'media/chart.png': 'chart' });
        const root = fragmentOf('<img alt="Chart" data-local-src="../media/chart.png"><img alt="" data-local-src="images/missing.png">');

        const paths = await resolveLocalImagesAsync(root, contextFor(resources), options);

        expect([...paths]).toEqual(['media/chart.png', 'docs/images/missing.png']);
        expect(root.innerHTML).toBe([
            '<img alt="Chart" data-local-src="../media/chart.png" src="blob:chart">',
            '<img alt="" data-local-src="images/missing.png" hidden="">',
            '<span class="md-image-blocked" data-image-placeholder="" title="images/missing.png">Image not found: images/missing.png</span>',
        ].join(''));
    });

    it('brings an image back when it appears, and hides it again when it goes', async () => {
        const resources = fakeResources({});
        const root = fragmentOf('<p><img alt="Chart" data-local-src="chart.png"></p>');
        const context = contextFor(resources);

        await resolveLocalImagesAsync(root, context, options);
        expect(root.querySelector('[data-image-placeholder]')?.getAttribute('title')).toBe('Chart');

        resources.files['docs/chart.png'] = 'new';
        const fresh = { ...context, resources: fakeResources(resources.files) };
        await resolveLocalImagesAsync(root, fresh, options);

        expect(root.innerHTML).toBe('<p><img alt="Chart" data-local-src="chart.png" src="blob:new"></p>');

        await resolveLocalImagesAsync(root, { ...context, resources: fakeResources({}) }, options);

        expect(root.querySelectorAll('[data-image-placeholder]')).toHaveLength(1);
        expect(root.querySelector('img')?.hasAttribute('hidden')).toBe(true);
    });

    it('fills images read before without waiting, so a re-render doesn\'t flicker', async () => {
        const resources = fakeResources({ 'docs/a.png': 'a' });
        await resources.imageUrlAsync('docs/a.png');
        resources.reads.length = 0;
        const root = fragmentOf('<img data-local-src="a.png">');

        const done = resolveLocalImagesAsync(root, contextFor(resources), options);

        expect(root.querySelector('img')?.getAttribute('src')).toBe('blob:a');
        await done;
        expect(resources.reads).toEqual([]);
    });

    it('embeds data: URLs for pages that leave the studio', async () => {
        const resources = fakeResources({ 'docs/a.png': 'QUJD' });
        const root = fragmentOf('<img data-local-src="a.png">');

        await resolveLocalImagesAsync(root, contextFor(resources), { format: 'data', placeholderClass: 'x' });

        expect(root.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,QUJD');
    });

    it('says why a found image can\'t show, such as a HEIC picture, which is never decoded', async () => {
        const resources = fakeResources({}, { 'docs/photo.heic': 'Nib Studio doesn\'t decode HEIC pictures.' });
        const root = fragmentOf('<img alt="Photo" data-local-src="photo.heic"><img alt="Gone" data-local-src="gone.tif">');

        await resolveLocalImagesAsync(root, contextFor(resources), options);

        expect([...root.querySelectorAll('[data-image-placeholder]')].map((placeholder) => placeholder.textContent)).toEqual([
            'Nib Studio doesn\'t decode HEIC pictures.',
            'Image not found: gone.tif',
        ]);
        expect(peekLocalImage('photo.heic', 'Photo', contextFor(resources))).toEqual({
            kind: 'placeholder',
            label: 'Nib Studio doesn\'t decode HEIC pictures.',
        });
    });

    it('embeds images in document order up to the byte limit, and puts a placeholder for each that goes past it', async () => {
        const resources = fakeResources({
            'docs/first.png': base64Of(600),
            'docs/second.png': base64Of(600),
            'docs/small.png': base64Of(300),
        });
        const root = fragmentOf([
            '<img alt="" data-local-src="first.png">',
            '<picture><source data-local-srcset="second.png"><img alt="" data-local-src="small.png"></picture>',
            '<img alt="" data-local-src="data:image/png;base64,QUJD">',
        ].join(''));

        await resolveLocalImagesAsync(root, contextFor(resources), { format: 'data', placeholderClass: 'x', maxEmbeddedBytes: 1000 });
        const images = root.querySelectorAll('img');

        expect(images[0]?.getAttribute('src')).toBe(`data:image/png;base64,${base64Of(600)}`);
        expect(root.querySelector('source')?.hasAttribute('srcset')).toBe(false);
        expect(images[1]?.getAttribute('src')).toBe(`data:image/png;base64,${base64Of(300)}`);
        expect(images[2]?.getAttribute('src')).toBe('data:image/png;base64,QUJD');
    });

    it('shows the placeholder of an image too large to embed', async () => {
        const resources = fakeResources({ 'docs/big.png': base64Of(1200), 'docs/fits.png': base64Of(100) });
        const html = '<img alt="Big" src="" data-local-src="big.png"><img alt="Fits" data-local-src="fits.png">';

        const embedded = await embedLocalImagesAsync(html, contextFor(resources), { placeholderClass: 'x', maxEmbeddedBytes: 1000 });
        const page = fragmentOf(embedded);

        expect(page.querySelector('.x')?.textContent).toBe(tooLargeToEmbedLabel('big.png', 1000));
        expect(page.querySelectorAll('img')).toHaveLength(1);
        expect(page.querySelector('img')?.getAttribute('alt')).toBe('Fits');
    });

    it('shows placeholders for every relative image of a file from outside the workspace', async () => {
        const root = fragmentOf('<img data-local-src="a.png"><img src="data:image/png;base64,AA">');

        const paths = await resolveLocalImagesAsync(root, contextFor(null, null), options);

        expect(paths.size).toBe(0);
        expect(root.querySelector('[data-image-placeholder]')?.textContent).toBe('Image not shown (file outside the workspace): a.png');
        expect(root.querySelectorAll('img')[1]?.getAttribute('src')).toBe('data:image/png;base64,AA');
    });

    it('resolves picture sources, and drops a source with a missing candidate', async () => {
        const resources = fakeResources({ 'docs/dark.png': 'dark', 'docs/dark@2x.png': 'dark2' });
        const root = fragmentOf([
            '<picture>',
            '<source data-local-srcset="dark.png 1x, dark@2x.png 2x">',
            '<source data-local-srcset="wide.png">',
            '<img data-local-src="dark.png">',
            '</picture>',
        ].join(''));

        await resolveLocalImagesAsync(root, contextFor(resources), options);
        const sources = root.querySelectorAll('source');

        expect(sources[0]?.getAttribute('srcset')).toBe('blob:dark 1x, blob:dark2 2x');
        expect(sources[1]?.hasAttribute('srcset')).toBe(false);
    });
});

describe('tooLargeToEmbedLabel', () => {
    it('names the image and the limit in megabytes', () => {
        expect(tooLargeToEmbedLabel('../media/scan.png', 25 * 1024 * 1024)).toBe('Image too large to embed: the page holds at most 25 MB of images (../media/scan.png)');
    });
});

describe('dataUrlByteLength', () => {
    it('counts the bytes the Base64 of a data: URL holds, padding taken off', () => {
        expect(dataUrlByteLength('data:image/png;base64,QUJD')).toBe(3);
        expect(dataUrlByteLength('data:image/png;base64,QUI=')).toBe(2);
        expect(dataUrlByteLength('data:image/png;base64,QQ==')).toBe(1);
        expect(dataUrlByteLength(`data:image/png;base64,${base64Of(25 * 1024 * 1024)}`)).toBe(25 * 1024 * 1024);
    });
});

describe('parseSrcset', () => {
    it('splits candidates and descriptors, keeping commas inside addresses', () => {
        expect(parseSrcset('a.png 1x, b.png 2x')).toEqual([{ url: 'a.png', descriptor: '1x' }, { url: 'b.png', descriptor: '2x' }]);
        expect(parseSrcset('a.png 1x,b.png 640w')).toEqual([{ url: 'a.png', descriptor: '1x' }, { url: 'b.png', descriptor: '640w' }]);
        expect(parseSrcset('a.png, b.png')).toEqual([{ url: 'a.png', descriptor: '' }, { url: 'b.png', descriptor: '' }]);
        expect(parseSrcset('data:image/png;base64,AA 1x')).toEqual([{ url: 'data:image/png;base64,AA', descriptor: '1x' }]);
        expect(parseSrcset('  ')).toEqual([]);
    });

    it('joins candidates back', () => {
        expect(formatSrcset([{ url: 'a.png', descriptor: '1x' }, { url: 'b.png', descriptor: '' }])).toBe('a.png 1x, b.png');
    });
});
