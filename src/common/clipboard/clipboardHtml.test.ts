// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { capInlineImages, documentRichText, sanitizeClipboardHtml } from './clipboardHtml.js';

describe('sanitizeClipboardHtml', () => {
    it('drops scripts, handlers, javascript: links, style sheets and forms', () => {
        const html = sanitizeClipboardHtml([
            '<p onclick="steal()">Hi</p>',
            '<script>alert(1)</script>',
            '<a href="javascript:alert(1)">Bad</a>',
            '<style>p { color: red; }</style>',
            '<form action="/x"><span>Inside</span></form>',
            '<iframe src="https://example.com"></iframe>',
        ].join(''));

        expect(html).not.toMatch(/<script|onclick|javascript:|<style|<form|<iframe/);
        expect(html).toContain('<p>Hi</p>');
        expect(html).toContain('Inside');
    });
});

describe('documentRichText', () => {
    it('keeps headings, lists, tables and links, with borders on tables', () => {
        const rich = documentRichText('<h1>Title</h1><ul><li>One</li></ul><table><tr><td>A</td></tr></table><p><a href="https://example.com/">link</a></p>');

        expect(rich.html).toContain('<h1>Title</h1>');
        expect(rich.html).toContain('<li>One</li>');
        expect(rich.html).toContain('<table border="1" cellspacing="0" cellpadding="4" style="border-collapse: collapse;">');
        expect(rich.html).toContain('<a href="https://example.com/">link</a>');
        expect(rich.text).toBe('Title\n\n- One\n\nA\n\nlink');
    });

    it('keeps web and mail links, and only the text of links to workspace files or headings', () => {
        const rich = documentRichText('<p><a href="https://example.com/">Web</a> <a href="mailto:a@b.c">Mail</a> <a href="../data/users.csv">File</a> <a href="#figures">Heading</a></p>');

        expect(rich.html).toBe('<p><a href="https://example.com/">Web</a> <a href="mailto:a@b.c">Mail</a> <a>File</a> <a>Heading</a></p>');
    });

    it('leaves out buttons, controls and what does not show', () => {
        const rich = documentRichText('<p>Shown</p><button>Copy</button><input value="x"><div hidden>Hidden</div><p style="display: none">Gone</p>');

        expect(rich.html).toBe('<p>Shown</p>');
        expect(rich.text).toBe('Shown');
    });

    it('never keeps a script', () => {
        const rich = documentRichText('<p>A</p><script>alert(1)</script><img src="x" onerror="alert(1)">');

        expect(rich.html).not.toMatch(/<script|onerror/);
    });
});

describe('capInlineImages', () => {
    it('keeps pictures within the limit in document order and notes the ones left out', () => {
        const template = document.createElement('template');
        const big = `data:image/png;base64,${'A'.repeat(800)}`;
        const small = `data:image/png;base64,${'A'.repeat(40)}`;
        template.innerHTML = `<p><img src="${big}"><img src="${big}"><img src="${small}"><img src="https://example.com/a.png"></p>`;

        capInlineImages(template.content, 700);

        const sources = [...template.content.querySelectorAll('img')].map((image) => image.getAttribute('src'));
        expect(sources).toEqual([big, small, 'https://example.com/a.png']);
        expect(template.content.textContent).toContain('[Picture left out');
    });
});
