import { describe, expect, it } from 'vitest';
import { markdownToHtmlDocumentAsync } from '../../common/markdown/markdownToHtml.js';
import { renderMarkdown } from '../../common/markdown/preview.js';
import { htmlDocumentToMarkdown, htmlToMarkdown } from './htmlToMarkdown.js';

describe('htmlToMarkdown', () => {
    it.each([
        ['headings', '<h1>Title</h1><h3>Part <em>one</em></h3>', '# Title\n\n### Part *one*'],
        ['bold and italic', '<p>Make it <strong>loud</strong> and <i>soft</i></p>', 'Make it **loud** and *soft*'],
        ['strikethrough', '<p><del>old</del> and <s>gone</s></p>', '~~old~~ and ~~gone~~'],
        ['links', '<p>See <a href="https://example.com/a b">the docs</a></p>', 'See [the docs](<https://example.com/a b>)'],
        ['inline code', '<p>Run <code>npm test</code> or <code>a`b</code></p>', 'Run `npm test` or ``a`b``'],
        ['bulleted lists', '<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>', '- one\n- two\n  - nested'],
        ['numbered lists', '<ol start="3"><li>three</li><li>four</li></ol>', '3. three\n4. four'],
        ['quotes', '<blockquote><p>wise</p><p>words</p></blockquote>', '> wise\n>\n> words'],
        ['rules', '<p>above</p><hr><p>below</p>', 'above\n\n---\n\nbelow'],
    ])('converts %s', (_name, html, expected) => {
        expect(htmlToMarkdown(html)).toBe(expected);
    });

    it('turns the no-break spaces Chrome writes beside formatting, and in runs of spaces, into plain spaces', () => {
        const copied = '<p>Text with&nbsp;<strong>bold</strong>,&nbsp;<em>italic</em>&nbsp;and&nbsp; &nbsp;more&nbsp;</p>';

        expect(htmlToMarkdown(copied)).toBe('Text with **bold**, *italic* and more');
    });

    it('keeps a no-break space meant between two words, as &nbsp;', () => {
        expect(htmlToMarkdown('<p>Run <strong>10&nbsp;km</strong> today</p>')).toBe('Run **10&nbsp;km** today');
        expect(htmlToMarkdown('<h2>Chapter&nbsp;2</h2>')).toBe('## Chapter&nbsp;2');
    });

    it('converts task lists from GitHub and Google Docs', () => {
        const github = '<ul><li><input type="checkbox" checked disabled> done</li><li><input type="checkbox" disabled> open</li></ul>';
        const docs = '<ul><li role="checkbox" aria-checked="true"><p>shipped</p></li><li role="checkbox" aria-checked="false"><p>next</p></li></ul>';

        expect(htmlToMarkdown(github)).toBe('- [x] done\n- [ ] open');
        expect(htmlToMarkdown(docs)).toBe('- [x] shipped\n- [ ] next');
    });

    it('fences code blocks with their language', () => {
        const html = '<pre><code class="language-ts">const a = 1;\nconst b = `x`;\n</code></pre>';

        expect(htmlToMarkdown(html)).toBe('```ts\nconst a = 1;\nconst b = `x`;\n```');
        expect(htmlToMarkdown('<pre>one<br>two</pre>')).toBe('```\none\ntwo\n```');
        expect(htmlToMarkdown('<pre>```\nnested\n```</pre>')).toBe('````\n```\nnested\n```\n````');
    });

    it('converts tables with a header row, alignment and escaped pipes', () => {
        const html = '<table><thead><tr><th>Item</th><th align="right">Qty</th></tr></thead>'
            + '<tbody><tr><td><b>Widget</b></td><td>3</td></tr><tr><td colspan="2">a | b</td></tr></tbody></table>';

        expect(htmlToMarkdown(html)).toBe('| Item | Qty |\n| --- | ---: |\n| **Widget** | 3 |\n| a \\| b |  |');
    });

    it('takes the first row as the header of a table without one', () => {
        expect(htmlToMarkdown('<table><tr><td>a</td><td>b</td></tr><tr><td>1</td></tr></table>'))
            .toBe('| a | b |\n| --- | --- |\n| 1 |  |');
    });

    it('keeps web images as links that are never fetched and keeps data images', () => {
        const html = '<p><img src="https://example.com/logo.png" alt="Logo"> <img src="data:image/png;base64,AAAA" alt="dot"></p>';

        expect(htmlToMarkdown(html)).toBe('![Logo](https://example.com/logo.png) ![dot](data:image/png;base64,AAAA)');
    });

    it('strips scripts, event handlers and script links before converting', () => {
        const html = '<p><b>safe</b><script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">click</a></p>';
        const markdown = htmlToMarkdown(html) ?? '';

        expect(markdown).toBe('**safe**![](x)click');
        expect(markdown).not.toContain('alert');
        expect(markdown).not.toContain('onerror');
    });

    it('escapes text that would read as Markdown', () => {
        const html = '<p><b>Note</b>: 2 * 3 = [six] and snake_case stays, _but_ not this</p><p># not a heading</p><p>1. not a list</p>';

        expect(htmlToMarkdown(html)).toBe(
            '**Note**: 2 \\* 3 = \\[six\\] and snake_case stays, \\_but\\_ not this\n\n\\# not a heading\n\n1\\. not a list',
        );
    });

    it('reads Google Docs formatting from styles and ignores its bold wrapper', () => {
        const html = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1">'
            + '<p dir="ltr"><span style="font-weight:700;">Bold</span><span> and </span><span style="font-style:italic;">italic</span>'
            + '<span style="text-decoration:line-through;"> struck</span></p>'
            + '<ul><li dir="ltr" aria-level="1"><p dir="ltr"><span>one</span></p></li>'
            + '<ul><li dir="ltr" aria-level="2"><p dir="ltr"><span>deeper</span></p></li></ul></ul></b>';

        expect(htmlToMarkdown(html)).toBe('**Bold** and *italic* ~~struck~~\n\n- one\n  - deeper');
    });

    it('turns Word list paragraphs into nested lists', () => {
        const html = '<html><head><style>p.MsoNormal { margin: 0 }</style></head><body>'
            + '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">1.<span> </span></span>First</p>'
            + '<p class="MsoListParagraph" style="mso-list:l0 level2 lfo1"><span style="mso-list:Ignore">o<span> </span></span>Inner</p>'
            + '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">2.<span> </span></span>Second</p>'
            + '<p class="MsoNormal"><b>After</b></p></body></html>';

        expect(htmlToMarkdown(html)).toBe('1. First\n   - Inner\n2. Second\n\n**After**');
    });

    it('turns line breaks into hard breaks', () => {
        expect(htmlToMarkdown('<p><em>one</em><br>two</p>')).toBe('*one*\\\ntwo');
    });

    it('returns null for HTML without formatting, so plain text is pasted', () => {
        expect(htmlToMarkdown('<span>just text</span>')).toBeNull();
        expect(htmlToMarkdown('<p>one</p><p>two</p>')).toBeNull();
        expect(htmlToMarkdown('<script>alert(1)</script>')).toBeNull();
    });

    it('returns null for a code editor copy', () => {
        const html = '<div style="color: #d4d4d4; white-space: pre;"><div><span style="font-weight: bold;"># Title</span></div></div>';

        expect(htmlToMarkdown(html)).toBeNull();
    });
});

// A page with its own heading, as a .html file holds it.
function page(body: string, head = '<meta charset="utf-8"><title>Page</title>'): string {
    return `<!doctype html>\n<html lang="en">\n<head>${head}</head>\n<body>\n<h1>Page</h1>\n${body}\n</body>\n</html>\n`;
}

// The Markdown of a page's body, after its own heading.
function bodyMarkdown(body: string): string {
    return htmlDocumentToMarkdown(page(body)).replace(/^# Page\n\n/, '');
}

describe('htmlDocumentToMarkdown', () => {
    it.each([
        ['headings', '<h2>Part</h2><h3>Part <em>one</em></h3>', '## Part\n\n### Part *one*\n'],
        [
            'paragraphs, emphasis, strong, strike and inline code',
            '<p>Plain <em>soft</em>, <strong>loud</strong>, <del>gone</del> and <code>npm test</code>.</p>\n<p>Second</p>',
            'Plain *soft*, **loud**, ~~gone~~ and `npm test`.\n\nSecond\n',
        ],
        [
            'fenced code with its language, keeping blank lines and spaces at line ends',
            '<pre class="md-code language-python"><code>print(1)  \n\n\nprint(2)\n</code></pre>',
            '```python\nprint(1)  \n\n\nprint(2)\n```\n',
        ],
        ['ordered lists', '<ol start="2"><li>two</li><li>three</li></ol>', '2. two\n3. three\n'],
        ['unordered lists', '<ul>\n<li>apple\n<ul>\n<li>green</li>\n</ul>\n</li>\n<li>pear</li>\n</ul>', '- apple\n  - green\n- pear\n'],
        [
            'task lists, from checkboxes and from a box written as text',
            '<ul><li><input type="checkbox" checked disabled> done</li><li><input type="checkbox"> open</li></ul>'
                + '<p>Next</p><ul><li>[x] shipped</li><li>[ ] planned</li></ul>',
            '- [x] done\n- [ ] open\n\nNext\n\n- [x] shipped\n- [ ] planned\n',
        ],
        [
            'tables, with alignment, a caption and line breaks in cells',
            '<table><caption>Sales</caption><thead><tr><th>City</th><th align="right">Total</th></tr></thead>'
                + '<tbody><tr><td>Patras<br>West</td><td>12</td></tr></tbody></table>',
            'Sales\n\n| City | Total |\n| --- | ---: |\n| Patras<br>West | 12 |\n',
        ],
        [
            'links and images, keeping relative paths as written, titles and in-page links',
            '<p><a href="docs/guide.md">Guide</a>, <img src="../images/logo.png" alt="Logo" title="Our logo">, '
                + '<a href="#usage">Usage</a> and <a href="https://example.com/a_b">https://example.com/a_b</a></p>',
            '[Guide](docs/guide.md), ![Logo](../images/logo.png "Our logo"), [Usage](#usage) and <https://example.com/a_b>\n',
        ],
        ['blockquotes', '<blockquote><p>wise</p><p>words</p></blockquote>', '> wise\n>\n> words\n'],
        ['rules', '<p>above</p><hr><p>below</p>', 'above\n\n---\n\nbelow\n'],
        ['line breaks', '<p>one<br>two</p>', 'one\\\ntwo\n'],
    ])('converts %s', (_name, body, expected) => {
        expect(bodyMarkdown(body)).toBe(expected);
    });

    it('keeps the simple HTML GitHub-flavoured Markdown allows, with Markdown inside', () => {
        const body = '<details open><summary>More <b>info</b> &amp; more</summary><p>Hidden <em>text</em></p></details>'
            + '<p>H<sub>2</sub>O, x<sup>2</sup>, <kbd>Ctrl</kbd>+<kbd>S</kbd>, <mark>note</mark> and <ins>added</ins></p>';

        expect(bodyMarkdown(body)).toBe(
            '<details open>\n<summary>More info &amp; more</summary>\n\nHidden *text*\n\n</details>\n\n'
            + 'H<sub>2</sub>O, x<sup>2</sup>, <kbd>Ctrl</kbd>+<kbd>S</kbd>, <mark>note</mark> and <ins>added</ins>\n',
        );
    });

    it('keeps the text of what Markdown can\'t express, such as alignment, colours and underlines', () => {
        const body = '<p align="center" class="lead" style="color: red; text-align: center">Centred <span style="color: blue">blue</span>'
            + ' and <u>underlined</u> <font color="green">text</font></p><div style="float: right">Aside</div>';

        expect(bodyMarkdown(body)).toBe('Centred blue and underlined text\n\nAside\n');
    });

    it('drops the head, scripts, styles, comments, event handlers, form controls and embedded content', () => {
        const head = '<meta charset="utf-8"><title>Page</title><style>body { color: red; }</style>'
            + '<script>window.headRan = true;</script><link rel="stylesheet" href="site.css"><meta name="description" content="Secret meta">';
        const body = '<p onclick="alert(1)">Kept <a href="javascript:alert(2)" onmouseover="alert(3)">link text</a></p>'
            + '<script>alert(4)</script><style>p { color: blue; }</style><!-- a comment -->'
            + '<form action="/send"><p>Before the fields</p><label>Name <input type="text" value="typed"></label>'
            + '<select><option>Choice</option></select><textarea>Draft</textarea><button>Send</button></form>'
            + '<noscript>Enable scripts</noscript><iframe src="https://example.com/frame">Frame</iframe>'
            + '<svg><text>Drawn</text></svg><video src="clip.mp4">Video fallback</video><p>After</p>';
        const markdown = htmlDocumentToMarkdown(page(body, head));

        expect(markdown).toBe('# Page\n\nKept link text\n\nBefore the fields\n\nName\n\nAfter\n');
        expect(markdown).not.toMatch(/alert|Ran|color|Secret|comment|typed|Choice|Draft|Send|Enable|Frame|Drawn|fallback/);
    });

    it('heads the Markdown with the page\'s title when the page has no <h1>', () => {
        const titled = '<!doctype html><html><head><title>  Field\n notes </title></head><body><h2>Part</h2><p>Text</p></body></html>';

        expect(htmlDocumentToMarkdown(titled)).toBe('# Field notes\n\n## Part\n\nText\n');
    });

    it('leaves the title out when the page has an <h1>, when it repeats the first heading, or when Nib Studio wrote the page', () => {
        const withHeading = '<html><head><title>Site</title></head><body><h1>Article</h1></body></html>';
        const repeated = '<html><head><title>Part</title></head><body><h2>Part</h2></body></html>';
        const written = '<html><head><meta name="generator" content="Nib Studio"><title>notes</title></head><body><p>Text</p></body></html>';

        expect(htmlDocumentToMarkdown(withHeading)).toBe('# Article\n');
        expect(htmlDocumentToMarkdown(repeated)).toBe('## Part\n');
        expect(htmlDocumentToMarkdown(written)).toBe('Text\n');
    });

    it('gives nothing for a page with no text', () => {
        expect(htmlDocumentToMarkdown('<!doctype html><html><head><style>p {}</style></head><body><script>1</script></body></html>')).toBe('');
        expect(htmlDocumentToMarkdown('')).toBe('');
    });

    it('turns a diagram\'s picture carrying its Mermaid source back into a mermaid code block', () => {
        const body = '<div class="md-mermaid" data-mermaid-source="flowchart LR\n    A --&gt; B[&quot;Café&quot;]">'
            + '<img src="data:image/png;base64,AAAA" alt="Mermaid diagram" width="40" height="20"></div>';

        expect(bodyMarkdown(body)).toBe('```mermaid\nflowchart LR\n    A --> B["Café"]\n```\n');
    });

    it('turns a <pre class="mermaid"> of a web page into a mermaid code block, without its indent', () => {
        expect(bodyMarkdown('<pre class="mermaid">\n    graph TD\n      A--&gt;B\n</pre>')).toBe('```mermaid\ngraph TD\n  A-->B\n```\n');
    });

    it('converts a paste as before, without what only a page converted whole keeps', () => {
        const html = '<p><a href="#usage">Usage</a>, <kbd>Ctrl</kbd>, x<sup>2</sup> and <a href="a.md" title="Tip">a</a></p>'
            + '<details><summary>More</summary><p>Hidden</p></details>';

        expect(htmlToMarkdown(html)).toBe('Usage, `Ctrl`, x2 and [a](a.md)\n\nMore\n\nHidden');
    });
});

describe('Markdown → HTML → Markdown', () => {
    const drawDiagramAsync = async (): Promise<{ url: string; width: number; height: number }> => ({
        url: 'data:image/png;base64,AAAA',
        width: 40,
        height: 20,
    });

    async function roundTripAsync(markdown: string): Promise<string> {
        return htmlDocumentToMarkdown(await markdownToHtmlDocumentAsync(markdown, { fileName: 'notes.md', drawDiagramAsync }));
    }

    // What a Markdown text shows, with runs of white space as one.
    function rendered(markdown: string): string {
        return renderMarkdown(markdown).html.replace(/\s+/g, ' ').trim();
    }

    it('gives the same Markdown back for the common constructs', async () => {
        const markdown = [
            '# Field notes',
            '',
            'Plain *soft*, **loud**, ~~gone~~ and `npm test`.',
            '',
            '## Lists',
            '',
            '1. one',
            '2. two',
            '',
            'Fruit:',
            '',
            '- apple',
            '  - green',
            '- pear',
            '',
            'Tasks:',
            '',
            '- [x] done',
            '- [ ] open',
            '',
            '## Table',
            '',
            '| City | Total |',
            '| --- | ---: |',
            '| Patras | 12 |',
            '',
            '[Guide](guide.md), ![Logo](images/logo.png), [Usage](#usage) and <https://example.com/docs>',
            '',
            '> Quoted *words*',
            '',
            '---',
            '',
            'Line one\\',
            'line two',
            '',
            '```js',
            'const total = 1;',
            '',
            '',
            'export { total };',
            '```',
            '',
            '```mermaid',
            'flowchart LR',
            '    A --> B["Café"]',
            '```',
            '',
            '<details>',
            '<summary>More</summary>',
            '',
            'Hidden *text*',
            '',
            '</details>',
            '',
        ].join('\n');

        expect(await roundTripAsync(markdown)).toBe(markdown);
    });

    it('gives Markdown that shows the same for other ways of writing them', async () => {
        const markdown = [
            'Title',
            '=====',
            '',
            '* star item',
            '* another',
            '',
            '__bold__ and _italic_ text',
            'that wraps.',
            '',
            '~~~',
            'tilde fence',
            '~~~',
            '',
            '<https://example.com>',
            '',
        ].join('\n');
        const back = await roundTripAsync(markdown);

        expect(back).toBe('# Title\n\n- star item\n- another\n\n**bold** and *italic* text that wraps.\n\n```\ntilde fence\n```\n\n<https://example.com>\n');
        expect(rendered(back)).toBe(rendered(markdown));
    });

    it('keeps a diagram\'s source through the page, which shows it as a picture', async () => {
        const html = await markdownToHtmlDocumentAsync('```mermaid\nsequenceDiagram\n    Ada->>Alan: Hello <b>\n```\n', {
            fileName: 'notes.md',
            drawDiagramAsync,
        });

        expect(html).toContain('<img src="data:image/png;base64,AAAA" alt="Mermaid diagram"');
        expect(html).not.toMatch(/<script|-->/);
        expect(htmlDocumentToMarkdown(html)).toBe('```mermaid\nsequenceDiagram\n    Ada->>Alan: Hello <b>\n```\n');
    });
});
