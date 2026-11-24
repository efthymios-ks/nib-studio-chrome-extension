import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    TEXT_FORMAT,
    type DocBlock,
    type DocImage,
    type DocListMark,
    type DocParagraph,
    type DocPicture,
} from '../../common/office/docModel.js';
import { createPictureUrls, renderDocBlocks } from './docBlocksView.js';

const PNG: DocImage = { mimeType: 'image/png', bytes: Uint8Array.of(0x89, 0x50, 0x4e, 0x47) };

function picture(options: Partial<DocPicture>): DocPicture {
    return {
        kind: 'picture',
        layout: 'inline',
        format: options.image == null ? null : 'png',
        image: null,
        width: null,
        height: null,
        crop: null,
        description: null,
        ...options,
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

function paragraph(text: string, options: Partial<DocParagraph> = {}): DocParagraph {
    return {
        kind: 'paragraph',
        role: 'body',
        level: 0,
        alignment: 'start',
        list: null,
        inlines: text === '' ? [] : [{ kind: 'text', text, format: 0 }],
        ...options,
    };
}

function listItem(text: string, mark: Partial<DocListMark>): DocParagraph {
    return paragraph(text, { list: { id: 1, level: 0, format: 'bullet', start: 1, ...mark } });
}

function html(blocks: ReadonlyArray<DocBlock>): string {
    const holder = document.createElement('div');
    holder.append(renderDocBlocks(blocks));

    return holder.innerHTML;
}

describe('renderDocBlocks', () => {
    it('renders the title, headings, aligned and empty paragraphs and page breaks', () => {
        expect(html([
            paragraph('Report', { role: 'title' }),
            paragraph('Q3', { role: 'subtitle' }),
            paragraph('Summary', { role: 'heading', level: 2 }),
            paragraph('Centred', { alignment: 'center' }),
            paragraph(''),
            { kind: 'page-break' },
            paragraph('Deep', { role: 'heading', level: 9 }),
        ])).toBe([
            '<h1 class="document-title">Report</h1>',
            '<p class="document-subtitle">Q3</p>',
            '<h2>Summary</h2>',
            '<p data-align="center">Centred</p>',
            '<p><br></p>',
            '<hr class="document-page-break">',
            '<h6>Deep</h6>',
        ].join(''));
    });

    it('nests formatting, and shows breaks and picture placeholders', () => {
        expect(html([paragraph('', {
            inlines: [
                { kind: 'text', text: 'bold italic', format: TEXT_FORMAT.bold | TEXT_FORMAT.italic },
                { kind: 'line-break' },
                { kind: 'text', text: 'x', format: TEXT_FORMAT.underline | TEXT_FORMAT.superscript },
                picture({}),
            ],
        })])).toBe([
            '<p><strong><em>bold italic</em></strong><br><u><sup>x</sup></u>',
            '<span class="document-picture" role="img" aria-label="Picture">Picture</span></p>',
        ].join(''));
    });

    it('shows pictures at the document\'s size from the URLs it is given, cropped, with their description', () => {
        const urlOf = vi.fn((image: DocImage) => `blob:test/${image.mimeType}`);
        const holder = document.createElement('div');
        holder.append(renderDocBlocks([paragraph('', {
            inlines: [
                { kind: 'text', text: 'Logo ', format: 0 },
                picture({ image: PNG, width: 120.4, height: 40, description: 'Company logo', crop: { top: 0.1, right: 0, bottom: 0, left: 0.25 } }),
                picture({ image: PNG, width: null, height: null }),
            ],
        })], urlOf));
        const images = [...holder.querySelectorAll('img')];

        expect(images.map((image) => [image.getAttribute('src'), image.getAttribute('alt'), image.getAttribute('width'), image.getAttribute('height')])).toEqual([
            ['blob:test/image/png', 'Company logo', '120', '40'],
            ['blob:test/image/png', 'Picture', null, null],
        ]);
        expect(images[0]?.style.getPropertyValue('object-view-box')).toBe('inset(10.00% 0.00% 0.00% 25.00%)');
        expect(images[0]?.dataset['layout']).toBe('inline');
    });

    it('leads the anchor paragraph with its floating pictures, and names formats the browser can\'t draw', () => {
        expect(html([paragraph('', {
            inlines: [
                { kind: 'text', text: 'Text', format: 0 },
                picture({ layout: 'floating', format: 'emf' }),
                picture({ format: 'wmf' }),
                picture({ format: 'png' }),
            ],
        })])).toBe([
            '<p><span class="document-picture" role="img" aria-label="Picture (EMF)">Picture (EMF)</span>Text',
            '<span class="document-picture" role="img" aria-label="Picture (WMF)">Picture (WMF)</span>',
            '<span class="document-picture" role="img" aria-label="Picture">Picture</span></p>',
        ].join(''));
    });

    it('names a TIFF picture that wasn\'t turned into PNG in its placeholder, as the browser can\'t draw TIFF', () => {
        const tiff: DocImage = { mimeType: 'image/tiff', bytes: Uint8Array.of(0x49, 0x49, 0x2a, 0x00) };
        const holder = document.createElement('div');
        holder.append(renderDocBlocks([paragraph('', { inlines: [picture({ image: tiff, format: 'tiff' })] })], () => 'blob:test/tiff'));

        expect(holder.innerHTML).toBe('<p><span class="document-picture" role="img" aria-label="Picture (TIFF)">Picture (TIFF)</span></p>');
    });

    it('shows a picture as a placeholder when the browser can\'t decode it', () => {
        const holder = document.createElement('div');
        holder.append(renderDocBlocks([paragraph('', { inlines: [picture({ image: PNG, format: 'png', layout: 'floating' })] })], () => 'blob:test/broken'));

        holder.querySelector('img')?.dispatchEvent(new Event('error'));

        expect(holder.innerHTML).toBe('<p><span class="document-picture" role="img" aria-label="Picture">Picture</span></p>');
    });

    it('gathers list items into nested lists, numbered by their format and start', () => {
        expect(html([
            listItem('a', {}),
            listItem('b', {}),
            listItem('b1', { level: 1, format: 'lower-alpha' }),
            listItem('c', {}),
            paragraph('between'),
            listItem('one', { id: 2, format: 'decimal', start: 3 }),
            listItem('dot', { id: 3 }),
        ])).toBe([
            '<ul><li>a</li><li>b<ol data-format="lower-alpha"><li>b1</li></ol></li><li>c</li></ul>',
            '<p>between</p>',
            '<ol start="3" data-format="decimal"><li>one</li></ol>',
            '<ul><li>dot</li></ul>',
        ].join(''));
    });

    it('makes one blob URL per image and revokes them all together', () => {
        const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test/${create.mock.calls.length}`);
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
        const urls = createPictureUrls();
        const other: DocImage = { mimeType: 'image/jpeg', bytes: Uint8Array.of(0xff, 0xd8, 0xff) };

        expect([urls.urlOf(PNG), urls.urlOf(PNG), urls.urlOf(other)]).toEqual(['blob:test/1', 'blob:test/1', 'blob:test/2']);
        expect((create.mock.calls[0]?.[0] as Blob).type).toBe('image/png');

        urls.revoke();

        expect(revoke.mock.calls.map(([url]) => url)).toEqual(['blob:test/1', 'blob:test/2']);
    });

    it('renders tables with leading header rows in a head and paragraphs in cells', () => {
        expect(html([{
            kind: 'table',
            rows: [
                { isHeader: true, cells: [{ paragraphs: [paragraph('Name')] }, { paragraphs: [paragraph('Total')] }] },
                { isHeader: false, cells: [{ paragraphs: [paragraph('Ada'), paragraph('Lovelace')] }, { paragraphs: [paragraph('')] }] },
            ],
        }])).toBe([
            '<table><thead><tr><th><p>Name</p></th><th><p>Total</p></th></tr></thead>',
            '<tbody><tr><td><p>Ada</p><p>Lovelace</p></td><td><p><br></p></td></tr></tbody></table>',
        ].join(''));
    });
});
