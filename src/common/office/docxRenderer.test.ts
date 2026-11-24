// @vitest-environment happy-dom

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { base64ByteLength, renderDocxToHtmlAsync, sanitizeHtml } from './docxRenderer.js';

const PNG_BYTES = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5);

const STYLES_XML = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>',
    '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/></w:style>',
    '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style>',
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>',
    '</w:styles>',
].join('');

async function buildDocxAsync(bodyXml: string, options: { readonly withImage?: boolean } = {}): Promise<ArrayBuffer> {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Default Extension="png" ContentType="image/png"/>',
        '<Default Extension="emf" ContentType="image/x-emf"/>',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Override PartName="/word/document.xml"',
        ' ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
        '</Types>',
    ].join(''));
    zip.file('_rels/.rels', [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Target="word/document.xml"',
        ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/>',
        '</Relationships>',
    ].join(''));
    zip.file('word/_rels/document.xml.rels', [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rIdStyles" Target="styles.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"/>',
        '<Relationship Id="rIdPng" Target="media/image1.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>',
        '<Relationship Id="rIdEmf" Target="media/image2.emf" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>',
        '<Relationship Id="rIdLink" Target="https://example.com/" TargetMode="External"',
        ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"/>',
        '</Relationships>',
    ].join(''));
    zip.file('word/styles.xml', STYLES_XML);

    if (options.withImage === true) {
        zip.file('word/media/image1.png', PNG_BYTES);
        zip.file('word/media/image2.emf', Uint8Array.of(1, 0, 0, 0));
    }

    zip.file('word/document.xml', [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
        ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
        ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
        ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
        ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">',
        '<w:body>',
        bodyXml,
        '</w:body>',
        '</w:document>',
    ].join(''));

    return await zip.generateAsync({ type: 'arraybuffer' });
}

function picture(relationshipId: string, description: string): string {
    return [
        '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="476250"/>',
        `<wp:docPr id="1" name="Picture" descr="${description}"/>`,
        '<a:graphic><a:graphicData><pic:pic><pic:blipFill>',
        `<a:blip r:embed="${relationshipId}"/>`,
        '</pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>',
    ].join('');
}

function paragraph(style: string, text: string): string {
    return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

describe('renderDocxToHtmlAsync', () => {
    it('converts paragraphs and maps the title, subtitle, quote and heading styles', async () => {
        const docx = await buildDocxAsync([
            paragraph('Title', 'Quarterly report'),
            paragraph('Subtitle', 'Third quarter'),
            paragraph('Heading1', 'Summary'),
            paragraph('Quote', 'Well said.'),
            '<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>',
            '<w:p><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>underlined</w:t></w:r></w:p>',
        ].join(''));

        const result = await renderDocxToHtmlAsync(docx);

        expect(result.html).toBe([
            '<h1 class="document-title">Quarterly report</h1>',
            '<p class="document-subtitle">Third quarter</p>',
            '<h1>Summary</h1>',
            '<blockquote><p>Well said.</p></blockquote>',
            '<p>Hello world</p>',
            '<p><u>underlined</u></p>',
        ].join(''));
    });

    it('shows embedded pictures as data: URIs at the size the document gives, and others as a placeholder', async () => {
        const docx = await buildDocxAsync(picture('rIdPng', 'Chart') + picture('rIdEmf', 'Vector'), { withImage: true });

        const result = await renderDocxToHtmlAsync(docx, { imageSizes: new Map([[PNG_BYTES.length, [{ width: 100, height: 50 }]]]) });
        const holder = document.createElement('div');
        holder.innerHTML = result.html;
        const image = holder.querySelector('img');

        expect(image?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
        expect(image?.getAttribute('alt')).toBe('Chart');
        expect([image?.getAttribute('width'), image?.getAttribute('height')]).toEqual(['100', '50']);
        expect(holder.querySelectorAll('img')).toHaveLength(1);
        expect(holder.querySelector('.document-picture')?.textContent).toBe('Picture');
    });

    it('keeps the target of a web link as a tooltip only', async () => {
        const docx = await buildDocxAsync('<w:p><w:hyperlink r:id="rIdLink"><w:r><w:t>site</w:t></w:r></w:hyperlink></w:p>');

        const result = await renderDocxToHtmlAsync(docx);

        expect(result.html).toBe('<p><a title="https://example.com/" data-link="external">site</a></p>');
    });

    it('fails with a reason for a file that isn\'t a DOCX', async () => {
        await expect(renderDocxToHtmlAsync(new TextEncoder().encode('not a zip').buffer as ArrayBuffer)).rejects.toThrow();
    });
});

describe('sanitizeHtml', () => {
    it('strips scripts, styles, embedded objects and event handlers', () => {
        expect(sanitizeHtml('<p onclick="x()" style="color:red">safe</p><script>alert(1)</script>')).toBe('<p>safe</p>');
        expect(sanitizeHtml('<style>p { color: red; }</style><p>styled</p>')).toBe('<p>styled</p>');
    });

    it('replaces pictures that are not data: images with a placeholder, so nothing loads', () => {
        const html = sanitizeHtml('<p><img src="http://evil.com/a.png"><img src="file:///c:/a.png"><img src="data:text/html;base64,PHA+"></p>');

        expect(html).not.toContain('evil.com');
        expect(html).not.toContain('<img');
        expect(html.match(/document-picture/g)).toHaveLength(3);
    });

    it('keeps data: pictures and in-document links, and turns web, mail and phone links into tooltips', () => {
        const html = sanitizeHtml([
            '<img src="data:image/png;base64,iVBORw0KGgo=" alt="x" width="10" height="5">',
            '<a href="#word-footnote-1">1</a>',
            '<a href="mailto:a@b.c">mail</a>',
            '<a href="javascript:alert(1)">bad</a>',
        ].join(''));

        expect(html).toBe([
            '<img src="data:image/png;base64,iVBORw0KGgo=" alt="x" width="10" height="5">',
            '<a href="#word-footnote-1">1</a>',
            '<a title="mailto:a@b.c" data-link="external">mail</a>',
            '<a>bad</a>',
        ].join(''));
    });

    it('keeps semantic formatting and tables', () => {
        expect(sanitizeHtml('<p><strong>a</strong><em>b</em></p><table><tbody><tr><td colspan="2">c</td></tr></tbody></table>'))
            .toBe('<p><strong>a</strong><em>b</em></p><table><tbody><tr><td colspan="2">c</td></tr></tbody></table>');
    });
});

describe('base64ByteLength', () => {
    it('counts the bytes base64 text decodes to', () => {
        expect(['', 'YQ==', 'YWI=', 'YWJj', 'YWJjZA=='].map(base64ByteLength)).toEqual([0, 1, 2, 3, 4]);
    });
});
