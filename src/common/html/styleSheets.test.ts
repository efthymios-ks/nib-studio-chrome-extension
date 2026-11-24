import { describe, expect, it } from 'vitest';
import { asRoot, FakeDirectoryHandle } from '../fs/testing/fakeFileSystem.js';
import { createWorkspaceResources } from '../fs/workspaceResources.js';
import { inlineStyleSheetAsync, rewriteUrlsAsync } from './styleSheets.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function contextFor(basePath: string, files: Record<string, string | Uint8Array>) {
    const folder = new FakeDirectoryHandle('workspace');

    for (const [path, data] of Object.entries(files)) {
        folder.addFile(path, data);
    }

    return { basePath, resources: createWorkspaceResources(asRoot(folder)), paths: new Set<string>() };
}

describe('inlineStyleSheetAsync', () => {
    it('turns workspace url()s into data: URLs, relative to the sheet', async () => {
        const context = contextFor('site/css/page.css', { 'site/img/bg.png': PNG });

        const css = await inlineStyleSheetAsync('body { background: url("../img/bg.png") no-repeat; }', context);

        expect(css).toBe('body { background: url("data:image/png;base64,iVBORw0KGgo=") no-repeat; }');
        expect([...context.paths]).toEqual(['site/img/bg.png']);
    });

    it('drops web, outside and missing addresses, and keeps data: and #id ones', async () => {
        const context = contextFor('page.css', {});

        const css = await inlineStyleSheetAsync([
            'a { background: url(https://example.com/a.png); }',
            'b { background: url(//cdn.example.com/b.png); }',
            'c { background: url(\'../../c.png\'); }',
            'd { background: url(missing.png); }',
            'e { background: url(data:image/png;base64,AA); }',
            'f { filter: url(#blur); }',
            '@font-face { font-family: X; src: url(https://fonts.example.com/x.woff2) format("woff2"); }',
        ].join('\n'), context);

        expect(css).toBe([
            'a { background: none; }',
            'b { background: none; }',
            'c { background: none; }',
            'd { background: none; }',
            'e { background: url(data:image/png;base64,AA); }',
            'f { filter: url(#blur); }',
            '@font-face { font-family: X; src: none format("woff2"); }',
        ].join('\n'));
    });

    it('reads workspace @imports in, with their media, and drops web ones', async () => {
        const context = contextFor('site/page.css', {
            'site/base.css': 'p { color: red; }',
            'site/print/print.css': 'p { background: url(dot.png); }',
            'site/print/dot.png': PNG,
        });

        const css = await inlineStyleSheetAsync([
            '@import url("base.css");',
            '@import \'print/print.css\' print;',
            '@import url(https://example.com/web.css);',
            'h1 { color: blue; }',
        ].join('\n'), context);

        expect(css).toBe([
            'p { color: red; }',
            '@media print {\np { background: url("data:image/png;base64,iVBORw0KGgo="); }\n}',
            '',
            'h1 { color: blue; }',
        ].join('\n'));
        expect([...context.paths].sort()).toEqual(['site/base.css', 'site/print/dot.png', 'site/print/print.css']);
    });

    it('stops an @import loop', async () => {
        const context = contextFor('a.css', {
            'a.css': '@import "b.css"; a { color: red; }',
            'b.css': '@import "a.css"; b { color: blue; }',
        });

        const css = await inlineStyleSheetAsync('@import "b.css"; a { color: red; }', context);

        expect(css).toBe(' b { color: blue; } a { color: red; }');
    });

    it('reads nothing without a workspace', async () => {
        const css = await inlineStyleSheetAsync('@import "a.css"; p { background: url(a.png); }', {
            basePath: '',
            resources: null,
            paths: new Set(),
        });

        expect(css).toBe(' p { background: none; }');
    });
});

describe('rewriteUrlsAsync', () => {
    it('reads the addresses of an image-set(), written as strings or url()s', async () => {
        const context = contextFor('docs/page.html', { 'media/dot.png': PNG });

        expect(await rewriteUrlsAsync('background: image-set("../media/dot.png" 1x, url(https://example.com/2x.png) 2x)', 'docs/page.html', context))
            .toBe('background: image-set(url("data:image/png;base64,iVBORw0KGgo=") 1x, none 2x)');
        expect(await rewriteUrlsAsync('background: -webkit-image-set(\'https://example.com/a.png\' 1x)', 'docs/page.html', context))
            .toBe('background: -webkit-image-set(none 1x)');
    });

    it('rewrites a style attribute against the page\'s folder', async () => {
        const context = contextFor('docs/page.html', { 'media/dot.png': PNG });

        expect(await rewriteUrlsAsync('background-image: url(../media/dot.png)', 'docs/page.html', context))
            .toBe('background-image: url("data:image/png;base64,iVBORw0KGgo=")');
    });
});
