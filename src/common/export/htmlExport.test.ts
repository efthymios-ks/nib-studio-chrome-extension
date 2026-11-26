// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildStandaloneHtml, downloadFile, downloadHtml } from './htmlExport.js';

describe('htmlExport', () => {
    describe('buildStandaloneHtml', () => {
        it('wraps the body in a complete document', () => {
            const html = buildStandaloneHtml({ title: 'Notes', bodyHtml: '<h1>Hello</h1>' });

            expect(html.startsWith('<!doctype html>')).toBe(true);
            expect(html).toContain('<title>Notes</title>');
            expect(html).toContain('<body>\n<h1>Hello</h1>\n</body>');
            expect(html).toContain('<meta charset="utf-8">');
        });

        it('escapes markup in the title', () => {
            const html = buildStandaloneHtml({ title: '<script>"a" & b</script>', bodyHtml: '' });

            expect(html).toContain('<title>&lt;script&gt;&quot;a&quot; &amp; b&lt;/script&gt;</title>');
            expect(html).not.toContain('<title><script>');
        });

        it('inserts the body unescaped', () => {
            const html = buildStandaloneHtml({ title: 'Doc', bodyHtml: '<p class="x">A &amp; B</p>' });

            expect(html).toContain('<p class="x">A &amp; B</p>');
        });

        it('colours links and a quote\'s bar in the accent', () => {
            const html = buildStandaloneHtml({ title: 'Doc', bodyHtml: '' });

            expect(html).toContain('a { color: #1f6feb; }');
            expect(html).toContain('border-left: 3px solid #1f6feb;');
        });

        it('sets the diagrams on white paper, and a diagram that can\'t be drawn in the light preview\'s error colours', () => {
            const html = buildStandaloneHtml({ title: 'Doc', bodyHtml: '' });

            expect(html).toMatch(/\.md-mermaid \{[^}]*text-align: center;[^}]*break-inside: avoid;/);
            expect(html).toContain('.md-mermaid img { background: #ffffff; }');
            expect(html).toMatch(/\.md-mermaid-error \{[^}]*white-space: pre-wrap;[^}]*color: #c72e0f;[^}]*background: #fde7e4;[^}]*border: 1px solid #c72e0f;/);
            expect(html).not.toContain('.md-mermaid svg');
        });

        it('parses into a document with the expected title and body', () => {
            const html = buildStandaloneHtml({ title: 'Report', bodyHtml: '<p id="first">One</p>' });
            const parsed = new DOMParser().parseFromString(html, 'text/html');

            expect(parsed.title).toBe('Report');
            expect(parsed.getElementById('first')?.textContent).toBe('One');
        });
    });

    describe('downloadHtml', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('clicks a temporary download link and releases the blob URL', async () => {
            const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
            const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
            const clicked: HTMLAnchorElement[] = [];
            vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
                clicked.push(this);
            });

            downloadHtml('notes.html', '<p>Hi</p>');

            expect(clicked).toHaveLength(1);
            const link = clicked[0] as HTMLAnchorElement;
            expect(link.download).toBe('notes.html');
            expect(link.href).toBe('blob:fake-url');
            expect(link.isConnected).toBe(false);
            expect(revokeObjectUrl).toHaveBeenCalledWith('blob:fake-url');

            const blob = createObjectUrl.mock.calls[0]?.[0] as Blob;
            expect(blob.type).toBe('text/html;charset=utf-8');
            await expect(blob.text()).resolves.toBe('<p>Hi</p>');
        });
    });

    describe('downloadFile', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('saves the text with its type under the file name', async () => {
            const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:json-url');
            vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
            const clicked: HTMLAnchorElement[] = [];
            vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
                clicked.push(this);
            });

            downloadFile('a-vs-b.diff.json', '{"a":1}\n', 'application/json;charset=utf-8');

            expect(clicked.map((link) => link.download)).toEqual(['a-vs-b.diff.json']);
            const blob = createObjectUrl.mock.calls[0]?.[0] as Blob;
            expect(blob.type).toBe('application/json;charset=utf-8');
            await expect(blob.text()).resolves.toBe('{"a":1}\n');
        });
    });
});
