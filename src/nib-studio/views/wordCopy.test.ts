import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COPY_IMAGE_LIMIT_BYTES } from '../../common/clipboard/documentCopy.js';
import type { DocBlock, DocParagraph } from '../../common/office/docModel.js';
import { stubClipboard, type FakeClipboard } from '../testing/fakeClipboard.js';
import { copyWordPageAsync, wordRichText } from './wordCopy.js';

const PAGE = { width: 816, height: 1056, marginTop: 96, marginRight: 96, marginBottom: 96, marginLeft: 96 };

function paragraph(text: string, overrides: Partial<DocParagraph> = {}): DocParagraph {
    return { kind: 'paragraph', role: 'body', level: 0, alignment: 'start', list: null, inlines: [{ kind: 'text', text, format: 0 }], ...overrides };
}

describe('wordRichText', () => {
    it('copies a .doc\'s headings, tables and pictures, the pictures as data: URLs', () => {
        const blocks: DocBlock[] = [
            paragraph('Quarterly', { role: 'heading', level: 1 }),
            {
                kind: 'table',
                rows: [
                    { isHeader: true, cells: [{ paragraphs: [paragraph('Name')] }, { paragraphs: [paragraph('Total')] }] },
                    { isHeader: false, cells: [{ paragraphs: [paragraph('Ada')] }, { paragraphs: [paragraph('42')] }] },
                ],
            },
            {
                ...paragraph(''),
                inlines: [{
                    kind: 'picture',
                    layout: 'inline',
                    format: 'png',
                    image: { mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) },
                    width: 10,
                    height: 5,
                    crop: null,
                    description: 'Chart',
                }],
            },
        ];

        const rich = wordRichText({ kind: 'blocks', source: 'doc', blocks, page: PAGE });

        expect(rich.html).toMatch(/<h1[^>]*>Quarterly<\/h1>/);
        expect(rich.html).toMatch(/<table[^>]* border="1"/);
        expect(rich.html).toContain('src="data:image/png;base64,AQID"');
        expect(rich.html).not.toContain('blob:');
        expect(rich.text).toBe('Quarterly\n\nName\tTotal\nAda\t42');
    });

    it('copies a .docx\'s HTML, leaving out pictures past the limit of a copy', () => {
        const big = `data:image/png;base64,${'A'.repeat(Math.ceil((COPY_IMAGE_LIMIT_BYTES + 3) / 3) * 4)}`;
        const rich = wordRichText({ kind: 'html', source: 'docx', html: `<p>Hello</p><p><img src="${big}"></p>`, page: PAGE });

        expect(rich.html).not.toContain('<img');
        expect(rich.text).toBe('Hello\n\n[Picture left out: a copy holds at most 10 MB of pictures]');
    });
});

describe('copyWordPageAsync', () => {
    let clipboard: FakeClipboard;

    beforeEach(() => {
        clipboard = stubClipboard();
    });

    afterEach(() => {
        clipboard.restore();
    });

    it('puts the page on the clipboard as HTML with its text', async () => {
        const outcome = await copyWordPageAsync({ kind: 'html', source: 'docx', html: '<h2>Report</h2><ul><li>One</li></ul>', page: PAGE });

        expect(outcome).toEqual({ message: 'Formatted document copied.', tone: 'ok' });
        expect(clipboard.last().get('text/html')).toBe('<h2>Report</h2><ul><li>One</li></ul>');
        expect(clipboard.last().get('text/plain')).toBe('Report\n\n- One');
    });
});
