import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from './htmlToMarkdown.js';

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
