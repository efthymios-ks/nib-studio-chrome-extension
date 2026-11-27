// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"handleDisabledFileLoadingAsSuccess":true}}

import { describe, expect, it, vi } from 'vitest';
import type { DrawDiagramAsync } from './documentDiagrams.js';
import { markdownToHtmlDocumentAsync } from './markdownToHtml.js';

const PICTURE = 'data:image/png;base64,AAAA';

const drawDiagramAsync: DrawDiagramAsync = async () => ({ url: PICTURE, width: 40, height: 20 });

async function convertAsync(markdown: string, fileName = 'notes.md', draw: DrawDiagramAsync | null = drawDiagramAsync): Promise<string> {
    return await markdownToHtmlDocumentAsync(markdown, { fileName, drawDiagramAsync: draw ?? undefined });
}

// The page's body, between its tags.
function bodyOf(html: string): string {
    return /<body>\n([^]*)\n<\/body>/.exec(html)?.[1] ?? '';
}

describe('markdownToHtmlDocumentAsync', () => {
    it('writes a standalone HTML5 page with a language, character set, viewport, generator, title and style sheet', async () => {
        const html = await convertAsync('# Field *notes*\n\nText\n');

        expect(html.startsWith('<!doctype html>\n<html lang="en">\n<head>\n    <meta charset="utf-8">\n')).toBe(true);
        expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
        expect(html).toContain('<meta name="generator" content="Nib Studio">');
        expect(html).toContain('<title>Field notes</title>');
        expect(html).toMatch(/<style>[^]*font: 15px\/1\.6[^]*<\/style>/);
        expect(bodyOf(html)).toBe('<h1 id="field-notes">Field <em>notes</em></h1>\n<p>Text</p>');
        expect(html.endsWith('</body>\n</html>\n')).toBe(true);
    });

    it('titles a page without a heading after the file name', async () => {
        expect(await convertAsync('Just text\n', 'meeting notes.md')).toContain('<title>meeting notes</title>');
        expect(await convertAsync('Just text\n', '.md')).toContain('<title>.md</title>');
        expect(await convertAsync('Intro\n\n### Third level\n')).toContain('<title>Third level</title>');
    });

    it.each([
        ['emphasis, strike and inline code', 'A *b* **c** ~~d~~ `e`', '<p>A <em>b</em> <strong>c</strong> <s>d</s> <code>e</code></p>'],
        ['lists', '1. one\n2. two\n\n- [x] done', '<ol>\n<li>one</li>\n<li>two</li>\n</ol>\n<ul>\n<li>[x] done</li>\n</ul>'],
        [
            'tables with their alignment',
            '| City | Total |\n| :---: | ---: |\n| Patras | 12 |',
            '<table>\n<thead>\n<tr>\n<th align="center">City</th>\n<th align="right">Total</th>\n</tr>\n</thead>\n'
                + '<tbody>\n<tr>\n<td align="center">Patras</td>\n<td align="right">12</td>\n</tr>\n</tbody>\n</table>',
        ],
        ['quotes and rules', '> wise\n\n---', '<blockquote>\n<p>wise</p>\n</blockquote>\n<hr>'],
        ['code blocks, without the preview\'s Copy button', '```js\nconst a = 1;\n```', '<pre class="md-code language-js"><code>const a = 1;\n</code></pre>'],
    ])('renders %s', async (_name, markdown, body) => {
        expect(bodyOf(await convertAsync(markdown))).toBe(body);
    });

    it('keeps links and image addresses as written, relative ones included, and web images', async () => {
        const markdown = '[Guide](docs/guide.md) [Usage](#usage) ![Logo](../images/logo.png) ![Web](https://example.com/w.png)\n\n'
            + '<picture><source srcset="images/wide.png 2x"><img src="images/narrow.png" alt="Narrow"></picture>';
        const body = bodyOf(await convertAsync(markdown));

        expect(body).toContain('<a href="docs/guide.md">Guide</a>');
        expect(body).toContain('<a href="#usage">Usage</a>');
        expect(body).toContain('<img src="../images/logo.png" alt="Logo">');
        expect(body).toContain('<img src="https://example.com/w.png" alt="Web">');
        expect(body).toContain('<source srcset="images/wide.png 2x"><img src="images/narrow.png" alt="Narrow">');
        expect(body).not.toMatch(/data-local|md-image-blocked|blob:/);
    });

    it('drops scripts, handlers and the preview\'s controls from the page', async () => {
        const html = await convertAsync('<script>alert(1)</script>\n\n<p onclick="alert(2)">Hi</p>\n\n```sh\nls\n```\n');

        expect(html).not.toMatch(/<script|onclick|alert|md-code-copy|md-code-wrap|data-code|<button/);
    });

    it('draws a Mermaid diagram as its picture, with its source beside it, and no script', async () => {
        const draw = vi.fn(drawDiagramAsync);
        const html = await convertAsync('```mermaid\nflowchart LR\n    A --> B["Café"]\n```\n', 'notes.md', draw);

        expect(draw).toHaveBeenCalledWith('flowchart LR\n    A --> B["Café"]\n');
        expect(bodyOf(html)).toBe(
            '<div class="md-mermaid" data-mermaid-source="flowchart LR\n    A --&gt; B[&quot;Café&quot;]">'
            + `<img src="${PICTURE}" alt="Mermaid diagram" width="40" height="20"></div>`,
        );
        expect(html).not.toContain('<script');
    });

    it('keeps a diagram that can\'t be drawn as its code block', async () => {
        const failing: DrawDiagramAsync = async () => {
            throw new Error('Parse error on line 1');
        };
        const expected = '<pre class="md-code language-mermaid"><code>flowchart &lt;&lt;\n</code></pre>';

        expect(bodyOf(await convertAsync('```mermaid\nflowchart <<\n```\n', 'notes.md', failing))).toBe(expected);
        expect(bodyOf(await convertAsync('```mermaid\nflowchart <<\n```\n', 'notes.md', null))).toBe(expected);
    });
});
