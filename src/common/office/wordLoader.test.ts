// @vitest-environment happy-dom

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
    buildCompoundFile,
    buildDocFile,
    buildPropertySet,
    buildWord6File,
    sprm,
    SUMMARY_FORMAT_ID,
    u32,
} from './testing/docFixtures.js';
import { BLIP, blip, picf, shape } from './testing/officeArtFixtures.js';
import { loadWordDocumentAsync, type WordDocumentView } from './wordLoader.js';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

async function docxAsync(files: Readonly<Record<string, string>>): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', [
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '</Types>',
    ].join(''));

    for (const [name, content] of Object.entries(files)) {
        zip.file(name, content);
    }

    return await zip.generateAsync({ type: 'uint8array' });
}

function wordPackage(body: string): Record<string, string> {
    return {
        '_rels/.rels': [
            '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
            '<Relationship Id="rId1" Target="word/document.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/>',
            '</Relationships>',
        ].join(''),
        'word/document.xml': [
            '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
            body,
            '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>',
        ].join(''),
        'docProps/core.xml': [
            '<cp:coreProperties xmlns:cp="cp" xmlns:dc="dc"><dc:title>Packaged</dc:title></cp:coreProperties>',
        ].join(''),
    };
}

function summaryOf(view: WordDocumentView): string {
    const content = view.content;

    if (content.kind === 'message') {
        return `message: ${content.title}`;
    }

    return `${content.kind}/${content.source}`;
}

describe('loadWordDocumentAsync', () => {
    it('renders a DOCX through mammoth with its page and properties', async () => {
        const view = await loadWordDocumentAsync(await docxAsync(wordPackage('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>')), 'report.docx');

        expect(summaryOf(view)).toBe('html/docx');
        expect(view.content.kind === 'html' && view.content.html).toBe('<p>Hello</p>');
        expect(view.content.kind === 'html' && view.content.page.width).toBe(794);
        expect(view.formatLabel).toBe('Word document (DOCX)');
        expect(view.properties).toEqual({ title: 'Packaged' });
    });

    it('reads a DOCX with a .doc name by its content, and names template and macro kinds by extension', async () => {
        const bytes = await docxAsync(wordPackage('<w:p><w:r><w:t>Renamed</w:t></w:r></w:p>'));

        expect(summaryOf(await loadWordDocumentAsync(bytes, 'renamed.doc'))).toBe('html/docx');
        expect((await loadWordDocumentAsync(bytes, 'form.dotx')).formatLabel).toBe('Word template (DOTX)');
        expect((await loadWordDocumentAsync(bytes, 'tools.docm')).formatLabel).toBe('Word macro-enabled document (DOCM)');
    });

    it('says a workbook with a Word name isn\'t a Word document', async () => {
        const bytes = await docxAsync({
            '_rels/.rels': '<Relationships><Relationship Id="r" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>',
            'xl/workbook.xml': '<workbook/>',
        });
        const view = await loadWordDocumentAsync(bytes, 'book.docx');

        expect(view.content).toEqual({ kind: 'message', title: 'This file isn\'t a Word document', message: 'It is an Excel workbook.' });
    });

    it('reads a .doc into blocks with its properties, and a .doc with a .docx name too', async () => {
        const bytes = buildDocFile({
            pieces: [{ text: 'Legacy text\r', compressed: true }],
            summary: buildPropertySet(SUMMARY_FORMAT_ID, [[2, 'string', 'Old title']]),
        });

        for (const name of ['old.doc', 'misnamed.docx']) {
            const view = await loadWordDocumentAsync(bytes, name);

            expect(summaryOf(view), name).toBe('blocks/doc');
            expect(view.formatLabel).toBe('Word 97–2003 document (DOC)');
            expect(view.properties?.title).toBe('Old title');
        }
    });

    it('names a Word 97 template by its header and explains an encrypted file', async () => {
        const template = await loadWordDocumentAsync(buildDocFile({ pieces: [{ text: 'T\r', compressed: true }], flags: 0x0201 }), 'normal.doc');
        const encrypted = await loadWordDocumentAsync(buildCompoundFile({ EncryptionInfo: Uint8Array.of(1), EncryptedPackage: Uint8Array.of(2) }), 'secret.docx');

        expect(template.formatLabel).toBe('Word 97–2003 template (DOT)');
        expect(summaryOf(encrypted)).toBe('message: This document\'s encryption isn\'t supported');
        expect(encrypted.formatLabel).toBe('Word document (DOCX)');
        expect(encrypted.encryption).toMatchObject({ kind: 'unsupported' });
    });

    it('shows RTF and plain text as paragraphs with a note, and a web page sanitized', async () => {
        const rtf = await loadWordDocumentAsync(encode('{\\rtf1\\ansi First\\par Second}'), 'letter.doc');
        const text = await loadWordDocumentAsync(encode('Meeting notes\nSecond line\n'), 'notes.doc');
        const web = await loadWordDocumentAsync(encode('<html><head><style>p{}</style></head><body><p>Saved as web page</p></body></html>'), 'page.doc');

        expect(summaryOf(rtf)).toBe('blocks/text');
        expect(rtf.content.kind === 'blocks' && rtf.content.blocks.length).toBe(2);
        expect(rtf.note).toBe('This file is in Rich Text Format; its text shows without formatting.');
        expect(summaryOf(text)).toBe('blocks/text');
        expect(text.note).toBe('This file holds plain text, not a Word document.');
        expect(summaryOf(web)).toBe('html/web');
        expect(web.content.kind === 'html' && web.content.html).toBe('<p>Saved as web page</p>');
    });

    it('names a Word for Windows 1.0 or 2.0 file as an older format', async () => {
        const word2 = Uint8Array.of(0xdb, 0xa5, 0x2d, 0x00, ...new Array(124).fill(0));
        const word1 = Uint8Array.of(0x9b, 0xa5, 0x21, 0x00, ...new Array(124).fill(0));

        for (const bytes of [word2, word1]) {
            const view = await loadWordDocumentAsync(bytes, 'memo.doc');

            expect(view.content).toEqual({
                kind: 'message',
                title: 'This document uses an older Word format',
                message: 'It was saved by Word 2 or earlier, which the preview doesn\'t read. Open it in Word and save it as .docx to preview it.',
            });
            expect(view.formatLabel).toBe('Word for Windows 1.0–2.0 document (DOC)');
        }
    });

    it('reads a Word 6 or Word 95 file as text, naming its format with a note', async () => {
        const view = await loadWordDocumentAsync(buildWord6File({ text: 'Old memo\r', fib: 0x0068 }), 'old.doc');

        expect(summaryOf(view)).toBe('blocks/doc');
        expect(view.formatLabel).toBe('Word 6.0/95 document (DOC)');
        expect(view.note).toBe('This document is in the Word 6.0/95 format; its text shows without styles, lists or pictures.');
    });

    it('names an encrypted Word 95 file by its version too', async () => {
        const view = await loadWordDocumentAsync(buildWord6File({ text: 'Secret\r', flags: 0x0100 }), 'secret.doc');

        expect(summaryOf(view)).toBe('message: This document\'s encryption isn\'t supported');
        expect(view.formatLabel).toBe('Word 6.0/95 document (DOC)');
    });

    it('counts a .doc\'s pictures for Info, those shown as placeholders included', async () => {
        const data = picf({ width: 150, height: 150, records: [shape({ id: 1, blipIndex: 1 }), blip(BLIP.emf, [1, 2, 3])] });
        const bytes = buildDocFile({
            pieces: [{ text: '\u0001\u0001\r', compressed: true }],
            characters: [{ start: 0, end: 2, sprms: [sprm(0x0855, 1), sprm(0x6a03, ...u32(0))] }],
            data,
        });
        const view = await loadWordDocumentAsync(bytes, 'pictures.doc');

        expect(view.properties).toEqual({ pictures: 2 });
        expect(view.note).toBeNull();
    });

    it('names a Word 2 file in a compound file by its version too', async () => {
        const view = await loadWordDocumentAsync(buildDocFile({ pieces: [{ text: 'Old\r', compressed: true }], ident: 0xa5db, fib: 0x002d }), 'old.doc');

        expect(view.content.kind === 'message' && view.content.message).toContain('Word 2 or earlier');
        expect(view.formatLabel).toBe('Word for Windows 1.0–2.0 document (DOC)');
    });

    it('explains empty, binary, damaged and Word XML files', async () => {
        const views = await Promise.all([
            loadWordDocumentAsync(new Uint8Array(), 'empty.doc'),
            loadWordDocumentAsync(Uint8Array.of(0, 1, 2, 3, 0, 9), 'noise.doc'),
            loadWordDocumentAsync(Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 0, 0, 0), 'cut.docx'),
            loadWordDocumentAsync(encode('<?xml version="1.0"?><w:wordDocument/>'), 'flat.doc'),
        ]);

        expect(views.map(summaryOf)).toEqual([
            'message: This document is empty',
            'message: This file isn\'t a Word document',
            'message: This document can\'t be read',
            'message: This document is Word XML',
        ]);
    });
});
