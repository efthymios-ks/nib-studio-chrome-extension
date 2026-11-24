// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"handleDisabledFileLoadingAsSuccess":true}}

import { describe, expect, it } from 'vitest';
import { headingSlug, renderMarkdown } from './preview.js';

describe('renderMarkdown', () => {
    it('renders basic markdown to HTML', () => {
        const result = renderMarkdown('# Title\n\nSome **bold** text.');
        expect(result.html).toMatch(/<h1[^>]*>Title<\/h1>/);
        expect(result.html).toContain('<strong>bold</strong>');
    });

    it('extracts mermaid blocks and emits placeholders', () => {
        const source = '# Title\n\n```mermaid\nflowchart LR\n  A --> B\n```\n';
        const result = renderMarkdown(source);
        expect(result.diagrams).toHaveLength(1);
        expect(result.diagrams[0]?.source).toContain('flowchart LR');
        expect(result.html).toContain('md-mermaid');
        expect(result.html).toContain(result.diagrams[0]?.id ?? '');
    });

    it('keeps non-mermaid fenced code as rendered code blocks', () => {
        const result = renderMarkdown('```ts\nconst x = 1;\n```\n');
        expect(result.diagrams).toHaveLength(0);
        expect(result.html).toContain('md-code language-ts');
    });

    it('drops scripts written as raw HTML', () => {
        const result = renderMarkdown('plain <script>alert(1)</script> text');
        expect(result.html).not.toContain('<script');
        expect(result.html).not.toContain('alert(1)');
        expect(result.html).toContain('plain');
    });

    it('wraps fenced code blocks with a copy button and base64 data-code', () => {
        const result = renderMarkdown('```ts\nconst x = 1;\n```\n');
        expect(result.html).toContain('<div class="md-code-wrap">');
        expect(result.html).toContain('class="md-code-copy"');
        const match = result.html.match(/data-code="([^"]+)"/);
        expect(match).not.toBeNull();
        const encoded = match?.[1] ?? '';
        const decoded = typeof atob === 'function'
            ? atob(encoded)
            : Buffer.from(encoded, 'base64').toString('utf8');
        expect(decoded).toBe('const x = 1;');
    });

    it('gives the copy button the code exactly, without the line break that ends the block', () => {
        const decode = (markdown: string): string => {
            const encoded = renderMarkdown(markdown).html.match(/data-code="([^"]+)"/)?.[1] ?? '';

            return new TextDecoder().decode(Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)));
        };

        expect(decode('```\nfirst\nsecond\n```\n')).toBe('first\nsecond');
        expect(decode('```\nkept blank line\n\n```\n')).toBe('kept blank line\n');
        expect(decode('```\nΚαλημέρα\n```\n')).toBe('Καλημέρα');
    });

    it('does not wrap mermaid fences in the copy button container', () => {
        const result = renderMarkdown('```mermaid\nflowchart LR\n  A --> B\n```\n');
        expect(result.html).not.toContain('md-code-wrap');
        expect(result.html).toContain('md-mermaid');
    });

    it('emits id attributes on headings', () => {
        const result = renderMarkdown('# Hello World\n\n## Hello World\n');
        expect(result.html).toContain('<h1 id="hello-world"');
        expect(result.html).toContain('<h2 id="hello-world-1"');
    });

    describe('remote images', () => {
        it('replaces https images with a placeholder that shows the URL, titled with the alt text', () => {
            const result = renderMarkdown('![Logo](https://example.com/logo.png)');

            expect(result.html).not.toContain('<img');
            expect(result.html).toContain('<span class="md-image-blocked" title="Logo">Remote image not loaded (offline): https://example.com/logo.png</span>');
        });

        it('blocks protocol-relative and http images', () => {
            expect(renderMarkdown('![a](//cdn.example.com/a.png)').html).not.toContain('<img');
            expect(renderMarkdown('![a](http://example.com/a.png)').html).not.toContain('<img');
        });

        it('keeps data images and holds relative ones for the workspace', () => {
            expect(renderMarkdown('![dot](data:image/png;base64,iVBORw0KGgo=)').html).toContain('<img src="data:image/png;base64,');

            const relative = renderMarkdown('![pic](images/my%20pic.png)').html;
            expect(relative).toContain('data-local-src="images/my%20pic.png"');
            expect(relative).not.toContain(' src=');
        });

        it('keeps remote images when asked to', () => {
            const result = renderMarkdown('![Logo](https://example.com/logo.png)', { remoteImages: 'keep' });

            expect(result.html).toContain('<img src="https://example.com/logo.png"');
        });

    });

    describe('raw HTML', () => {
        it('renders the HTML READMEs use', () => {
            const html = renderMarkdown([
                '<p align="center"><img src="logo.png" alt="Logo" width="120" height="40" align="center"></p>',
                '',
                '<details open><summary>More</summary>',
                '',
                'Press <kbd>Ctrl</kbd>+<kbd>S</kbd>, H<sub>2</sub>O, x<sup>2</sup>, <mark>marked</mark>, <ins>in</ins> <del>out</del>.<br>',
                '',
                '</details>',
                '',
                '<div align="right"><a href="https://example.com/" title="Site">site</a></div>',
                '',
                '<table><tr><th colspan="2">Head</th></tr><tr><td>a</td><td>b</td></tr></table>',
            ].join('\n')).html;

            expect(html).toContain('<p align="center"><img alt="Logo" width="120" height="40" align="center" data-local-src="logo.png"></p>');
            expect(html).toContain('<details open=""><summary>More</summary>');
            expect(html).toContain('<kbd>Ctrl</kbd>+<kbd>S</kbd>');
            expect(html).toContain('H<sub>2</sub>O, x<sup>2</sup>, <mark>marked</mark>, <ins>in</ins> <del>out</del>.<br>');
            expect(html).toContain('<div align="right"><a href="https://example.com/" title="Site">site</a></div>');
            expect(html).toContain('<th colspan="2">Head</th>');
        });

        it('keeps a picture\'s sources, holding relative ones for the workspace and dropping web ones', () => {
            const html = renderMarkdown([
                '<picture>',
                '<source media="(prefers-color-scheme: dark)" srcset="dark.png 1x, dark@2x.png 2x">',
                '<source media="(min-width: 900px)" srcset="https://example.com/wide.png">',
                '<img src="light.png" alt="Chart">',
                '</picture>',
            ].join('\n')).html;

            expect(html).toContain('<source media="(prefers-color-scheme: dark)" data-local-srcset="dark.png 1x, dark@2x.png 2x">');
            expect(html).not.toContain('wide.png');
            expect(html).toContain('<img alt="Chart" data-local-src="light.png">');
        });

        it('never keeps scripts, handlers, styles, frames, objects, forms or javascript: addresses', () => {
            const html = renderMarkdown([
                '<script>window.ran = 1</script>',
                '<p onclick="window.ran = 1" style="color: red" onmouseover="x">styled</p>',
                '<style>body { display: none }</style>',
                '<object data="x.swf"></object><embed src="x.swf">',
                '<form action="https://example.com/"><input name="q"><button formaction="x">Go</button></form>',
                '<a href="javascript:alert(1)">bad</a> <a href="JaVaScRiPt:alert(1)">bad</a>',
                '<img src="x.png" onerror="window.ran = 1">',
                '<svg><script>window.ran = 1</script><circle r="2"></circle></svg>',
                '<math><mi>x</mi></math>',
                '<base href="https://example.com/"><meta http-equiv="refresh" content="0;url=https://example.com/">',
                '<link rel="stylesheet" href="https://example.com/x.css">',
            ].join('\n')).html;

            for (const forbidden of ['<script', 'onclick', 'onmouseover', 'onerror', 'style=', '<style', 'display: none', '<object', '<embed', '<form', '<input', 'formaction', 'javascript:', 'JaVaScRiPt', '<svg', '<circle', '<math', '<base', '<meta', '<link', 'window.ran']) {
                expect(html).not.toContain(forbidden);
            }

            expect(html).toContain('<p>styled</p>');
            expect(html).toContain('<a>bad</a>');
        });

        it('drops iframes and their content', () => {
            const html = renderMarkdown('before <iframe>inner</iframe> after').html;

            expect(html).not.toContain('iframe');
            expect(html).not.toContain('inner');
        });

        it('keeps only the renderer\'s own classes', () => {
            const html = renderMarkdown('<div class="modal-backdrop md-mermaid">x</div>\n\n```js\nlet a;\n```\n').html;

            expect(html).toContain('<div class="md-mermaid">x</div>');
            expect(html).toContain('<pre class="md-code language-js">');
            expect(html).not.toContain('modal-backdrop');
        });

        it('keeps heading ids, raw HTML anchors and ids that name document properties', () => {
            const html = renderMarkdown('# Title\n\n## Images\n\n<a name="setup"></a><h3 id="cookie">C</h3>').html;

            expect(html).toContain('<h1 id="title">Title</h1>');
            expect(html).toContain('<h2 id="images">Images</h2>');
            expect(html).toContain('<a name="setup"></a>');
            expect(html).not.toContain('data-heading-id');
        });

        it('hides HTML comments', () => {
            expect(renderMarkdown('a <!-- hidden --> b').html).not.toContain('hidden');
        });
    });
});

describe('headingSlug', () => {
    it('makes ids as the preview does', () => {
        expect(headingSlug('Release notes')).toBe('release-notes');
        expect(headingSlug('  Café & Co.  ')).toBe('café-co');
    });

    it('keeps letters and digits of any script, so a Greek heading gets an id', () => {
        expect(headingSlug('Σύμβαση 2026')).toBe('σύμβαση-2026');
        expect(headingSlug('Обзор: часть 1')).toBe('обзор-часть-1');
    });
});
