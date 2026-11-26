// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"handleDisabledFileLoadingAsSuccess":true}}

import { describe, expect, it } from 'vitest';
import type { DocumentResources } from '../fs/workspaceResources.js';
import { COPY_IMAGE_LIMIT_BYTES, htmlPageRichTextAsync, markdownRichTextAsync } from './documentCopy.js';

// Pictures in a map of workspace paths to their Base64; a path missing from it is a missing file.
function fakeResources(files: Record<string, string>): DocumentResources {
    return {
        imageUrlAsync: async (path) => (files[path] == null ? null : `blob:${path}`),
        peekImageUrl: () => undefined,
        imageProblem: () => null,
        dataUrlAsync: async (path) => (files[path] == null ? null : `data:image/png;base64,${files[path]}`),
        textAsync: async () => null,
    };
}

const MARKDOWN = [
    '# Report',
    '',
    'Some **bold** text and a [link](https://example.com/).',
    '',
    '- One',
    '- Two',
    '',
    '| Name | Age |',
    '| --- | --- |',
    '| Ada | 36 |',
    '',
    '![Logo](logo.png)',
    '',
    '```js',
    'run();',
    '```',
    '',
    '<script>alert(1)</script>',
].join('\n');

describe('markdownRichTextAsync', () => {
    it('copies the rendered document with headings, lists, tables, links and workspace pictures inside it', async () => {
        const rich = await markdownRichTextAsync(MARKDOWN, { documentPath: 'docs/report.md', resources: fakeResources({ 'docs/logo.png': 'AAAA' }) });

        expect(rich.html).toContain('<h1 id="report">Report</h1>');
        expect(rich.html).toContain('<strong>bold</strong>');
        expect(rich.html).toContain('<a href="https://example.com/">link</a>');
        expect(rich.html).toContain('<li>One</li>');
        expect(rich.html).toMatch(/<table border="1"[^>]*>/);
        expect(rich.html).toContain('<td>Ada</td>');
        expect(rich.html).toContain('src="data:image/png;base64,AAAA"');
        expect(rich.html).not.toContain('data-local-src');
        expect(rich.text).toContain('Report\n\nSome bold text and a link.\n\n- One\n- Two\n\nName\tAge\nAda\t36');
        expect(rich.text).toContain('run();');
    });

    it('never puts a script or the code blocks\' copy buttons in the copy', async () => {
        const rich = await markdownRichTextAsync(MARKDOWN, { documentPath: null, resources: null });

        expect(rich.html).toContain('<pre class="md-code language-js"><code>run();\n</code></pre>');
        expect(rich.html).not.toMatch(/<script|<button|md-code-copy|md-code-wrap|data-code/);
        expect(rich.text).not.toContain('alert');
    });

    it('draws Mermaid diagrams as pictures, or keeps their source when they cannot be drawn', async () => {
        const text = '```mermaid\ngraph TD; A-->B\n```\n\n```mermaid\nbroken\n```';
        const drawn = await markdownRichTextAsync(text, {
            documentPath: null,
            resources: null,
            drawDiagramAsync: async (source) => (source.includes('A-->B') ? { url: 'data:image/png;base64,QUJD', width: 120, height: 80 } : null),
        });

        expect(drawn.html).toContain('<img src="data:image/png;base64,QUJD" alt="Mermaid diagram" width="120" height="80">');
        expect(drawn.html).toContain('<pre><code>broken\n</code></pre>');
    });

    it('puts a placeholder in place of a picture past the limit', async () => {
        const huge = 'A'.repeat(Math.ceil((COPY_IMAGE_LIMIT_BYTES + 3) / 3) * 4);
        const rich = await markdownRichTextAsync('![Big](big.png)', { documentPath: 'docs/a.md', resources: fakeResources({ 'docs/big.png': huge }) });

        expect(rich.html).not.toContain('<img');
        expect(rich.text).toContain('Image too large to embed');
    });
});

describe('htmlPageRichTextAsync', () => {
    it('copies the page body without its scripts, handlers, styles or forms', async () => {
        const page = [
            '<!doctype html><html><head><title>T</title><style>h1 { color: red; }</style><script src="app.js"></script></head>',
            '<body><h1 onclick="go()">Heading</h1><p style="color: green">Para</p>',
            '<script>document.write("x")</script><form><input value="q"><button>Send</button></form>',
            '<img src="media/pic.png" alt="Pic"><a href="javascript:alert(1)">Bad</a></body></html>',
        ].join('');
        const rich = await htmlPageRichTextAsync(page, { documentPath: 'docs/page.html', resources: fakeResources({ 'docs/media/pic.png': 'QUJD' }) });

        expect(rich.html).not.toMatch(/<script|onclick|<style|<form|<input|<button|javascript:/);
        expect(rich.html).toContain('<h1>Heading</h1>');
        expect(rich.html).toContain('<p style="color: green">Para</p>');
        expect(rich.html).toMatch(/<img (?=[^>]*alt="Pic")(?=[^>]*src="data:image\/png;base64,QUJD")[^>]*>/);
        expect(rich.text).toBe('Heading\n\nPara\n\nBad');
    });
});
