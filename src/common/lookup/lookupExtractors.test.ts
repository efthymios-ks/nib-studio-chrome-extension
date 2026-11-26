import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildDocFile } from '../office/testing/docFixtures.js';
import {
    buildEncryptedWorkbook,
    buildStandardEncryptedAsync,
    buildTinyWorkbook,
    buildTinyXlsx,
    encryptDocFile,
} from '../office/testing/encryptionFixtures.js';
import { SALES_SHEETS, buildSheetsWorkbook } from '../office/testing/workbookFixtures.js';
import { decodeText, extractText, htmlText, markupText, MAX_FILE_BYTES, readPlanFor, type Extraction } from './lookupExtractors.js';

const OPTIONS = { codePage: 1253 };

async function zipAsync(parts: Readonly<Record<string, string>>): Promise<Uint8Array> {
    const zip = new JSZip();

    for (const [name, text] of Object.entries(parts)) {
        zip.file(name, text);
    }

    return new Uint8Array(await zip.generateAsync({ type: 'arraybuffer' }));
}

function textOf(extraction: Extraction): string {
    return extraction.kind === 'text' ? extraction.text.replace(/\s+/g, ' ').trim() : `<${extraction.kind}>`;
}

const WORD_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

describe('readPlanFor', () => {
    it('reads text, Office and OpenDocument files, sniffs unknown ones, and hands PDFs to pdf.js', () => {
        expect(['notes.txt', 'data.json', 'page.html', 'report.docx', 'deck.pptm', 'sheet.ods', 'old.doc'].map((name) => readPlanFor(name, 10)))
            .toEqual(['read', 'read', 'read', 'read', 'read', 'read', 'read']);
        expect(readPlanFor('README', 10)).toBe('sniff');
        expect(readPlanFor('invoice.pdf', 10)).toBe('pdf');
    });

    it('keeps only the names of images, media, fonts, archives, old presentations and files over 20 MB', () => {
        expect(['photo.png', 'song.mp3', 'clip.mp4', 'font.ttf', 'backup.zip', 'old.ppt'].map((name) => readPlanFor(name, 10)))
            .toEqual(['name-only', 'name-only', 'name-only', 'name-only', 'name-only', 'name-only']);
        expect(readPlanFor('huge.txt', MAX_FILE_BYTES + 1)).toBe('name-only');
        expect(readPlanFor('limit.txt', MAX_FILE_BYTES)).toBe('read');
    });
});

describe('decodeText', () => {
    it('reads UTF-8, with or without a byte order mark, and UTF-16 by its mark', () => {
        expect(decodeText(new TextEncoder().encode('\uFEFFκαλημέρα'), 1252)).toBe('καλημέρα');
        expect(decodeText(Uint8Array.of(0xff, 0xfe, 0xb1, 0x03, 0x62, 0x00), 1252)).toBe('αb');
    });

    it('reads text that isn\'t UTF-8 in the code page it reads best in, as the editor does, whatever the browser\'s languages', () => {
        const greek = Uint8Array.of(0xcc, 0xe1, 0xf1, 0xdf, 0xe1);

        expect(decodeText(greek, 1253)).toBe('Μαρία');
        expect(decodeText(greek, 1252)).toBe('Μαρία');
    });

    it('reads text that isn\'t UTF-8 in the browser\'s own code page of two bytes a character, such as Shift_JIS', () => {
        expect(decodeText(Uint8Array.of(0x82, 0xa0, 0x82, 0xa2), 932)).toBe('あい');
    });
});

describe('extractText', () => {
    it('reads a text file with its own lines', () => {
        expect(extractText('notes.txt', new TextEncoder().encode('one\ntwo'), OPTIONS)).toEqual({ kind: 'text', text: 'one\ntwo', keepsLines: true });
    });

    it('reads a page without its tags, scripts, styles and comments, keeping the page\'s lines', () => {
        const page = '<html><head><style>p { color: red; }</style>\n<script>\nhidden()\n</script></head>\n<body><p>Dark <b>mode</b> &amp; more</p><!-- note --></body></html>';
        const extraction = extractText('page.html', new TextEncoder().encode(page), OPTIONS);

        expect(textOf(extraction)).toBe('Dark mode & more');
        expect(extraction.kind === 'text' && extraction.text.split('\n').length).toBe(page.split('\n').length);
        expect(htmlText('<p>a</p><p>b</p>').replace(/\s+/g, ' ').trim()).toBe('a b');
    });

    it('reads a DOCX\'s body, headers and footers, joining runs and parting paragraphs, without field codes or deleted text', async () => {
        const docx = await zipAsync({
            'word/document.xml': `<w:document ${WORD_NS}><w:body><w:p><w:r><w:t>The Quar</w:t></w:r><w:r><w:t>terly review</w:t></w:r></w:p><w:p><w:r><w:instrText>PAGE</w:instrText><w:delText>old</w:delText><w:t>is owned</w:t><w:tab/><w:t>by Anna</w:t></w:r></w:p></w:body></w:document>`,
            'word/header1.xml': `<w:hdr ${WORD_NS}><w:p><w:r><w:t>Header text</w:t></w:r></w:p></w:hdr>`,
            'word/styles.xml': `<w:styles ${WORD_NS}><w:style><w:name w:val="Never read"/></w:style></w:styles>`,
        });

        expect(textOf(extractText('proposal.docx', docx, OPTIONS))).toBe('The Quarterly review is owned by Anna Header text');
    });

    it('reads a presentation\'s slides in order, then their notes', async () => {
        const slide = (text: string): string => `<p:sld xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`;
        const pptx = await zipAsync({
            'ppt/slides/slide10.xml': slide('Ten'),
            'ppt/slides/slide2.xml': slide('Two'),
            'ppt/slides/slide1.xml': slide('One'),
            'ppt/notesSlides/notesSlide1.xml': slide('Note'),
        });

        expect(textOf(extractText('deck.pptx', pptx, OPTIONS))).toBe('One Two Ten Note');
    });

    it('reads an OpenDocument text\'s content', async () => {
        const odt = await zipAsync({
            'content.xml': '<office:document-content xmlns:office="o" xmlns:text="t"><text:p>Apple<text:s/>orchard</text:p><text:h>Δρόμος</text:h></office:document-content>',
        });

        expect(textOf(extractText('notes.odt', odt, OPTIONS))).toBe('Apple orchard Δρόμος');
    });

    it('reads every sheet of a workbook row by row, XLSX, XLS and ODS alike', () => {
        const rows = [['Category', 'Q1'], ['Cloud hosting', 4300]];

        expect(textOf(extractText('budget.xlsx', buildTinyXlsx(rows), OPTIONS))).toBe('Category Q1 Cloud hosting 4300');
        expect(textOf(extractText('budget.xls', buildTinyWorkbook(rows, 'biff8'), OPTIONS))).toBe('Category Q1 Cloud hosting 4300');
        expect(textOf(extractText('budget.ods', buildTinyWorkbook(rows, 'ods'), OPTIONS))).toBe('Category Q1 Cloud hosting 4300');
    });

    it('reads every visible sheet, a line per row, and says where each sheet starts and its first row', () => {
        for (const bookType of ['xlsx', 'biff8', 'xlsb'] as const) {
            const extraction = extractText('sales.xlsx', buildSheetsWorkbook(SALES_SHEETS, bookType), OPTIONS);

            expect(extraction.kind === 'text' ? extraction.text.split('\n') : [], bookType).toEqual([
                'order_id city total', 'Q1-1 Patras 120', 'Q1-2 Athens 80', 'Q1-3 Volos 45',
                'order_id city total', 'Q2-1 Larissa 300', 'Q2-2 Patras 15',
                'customer city revenue', 'Thessaly Ironworks Larissa 5400', 'Olympus Foods Katerini 2100',
            ]);
            expect(extraction.kind === 'text' ? [extraction.keepsLines, extraction.sections] : null, bookType).toEqual([true, [
                { name: 'Q1', firstLine: 1, firstNumber: 1 },
                { name: 'Q2', firstLine: 5, firstNumber: 1 },
                { name: 'North Region', firstLine: 8, firstNumber: 1 },
            ]]);
        }
    });

    it('keeps each row on one line when a cell holds line breaks', () => {
        const extraction = extractText('notes.xlsx', buildSheetsWorkbook([{ name: 'Notes', rows: [['Note'], ['first line\nsecond line']] }]), OPTIONS);

        expect(extraction.kind === 'text' ? extraction.text.split('\n') : []).toEqual(['Note', 'first line second line']);
    });

    it('reads a Word 97–2003 document', () => {
        const doc = buildDocFile({ pieces: [{ text: 'Revenue grew\rin Θεσσαλονίκη\r' }] });

        expect(textOf(extractText('report.doc', doc, OPTIONS))).toBe('Revenue grew in Θεσσαλονίκη');
    });

    it('keeps only the name of a file that isn\'t what its name says', () => {
        expect(extractText('broken.docx', Uint8Array.of(0, 1, 2, 3, 0, 0), OPTIONS).kind).toBe('name-only');
        expect(extractText('broken.pptx', Uint8Array.of(0x50, 0x4b, 3, 4, 0, 0), OPTIONS).kind).toBe('name-only');
    });
});

describe('extractText of protected files', () => {
    it('finds a password on a DOCX, an XLSX, an XLS and a DOC, and reads none of their text', async () => {
        const docx = await zipAsync({ 'word/document.xml': `<w:document ${WORD_NS}><w:body><w:p><w:r><w:t>Confidential</w:t></w:r></w:p></w:body></w:document>` });
        const lockedDocx = await buildStandardEncryptedAsync({ password: 'pw', plain: docx });
        const lockedXlsx = await buildStandardEncryptedAsync({ password: 'pw', plain: buildTinyXlsx([['Confidential']]) });
        const lockedXls = buildEncryptedWorkbook([['Confidential']], 'pw', 'rc4');
        const lockedDoc = encryptDocFile(buildDocFile({ pieces: [{ text: 'Confidential\r', compressed: true }], tableReserved: 256 }), 'pw', 'rc4');

        expect(extractText('contract.docx', lockedDocx, OPTIONS)).toEqual({ kind: 'locked' });
        expect(extractText('salaries.xlsx', lockedXlsx, OPTIONS)).toEqual({ kind: 'locked' });
        expect(extractText('salaries.xls', lockedXls, OPTIONS)).toEqual({ kind: 'locked' });
        expect(extractText('report.doc', lockedDoc, OPTIONS)).toEqual({ kind: 'locked' });
    });

    it('reads the plain bytes a tab unlocked', () => {
        expect(textOf(extractText('salaries.xlsx', buildTinyXlsx([['Confidential', 1250]]), { ...OPTIONS, isUnlocked: true }))).toBe('Confidential 1250');
    });
});

describe('markupText', () => {
    it('parts words at paragraphs, cells and breaks, and decodes references', () => {
        expect(markupText('<w:p><w:r><w:t>a&amp;b</w:t></w:r></w:p><w:tc><w:p><w:t>c</w:t></w:p></w:tc><w:br/>d').replace(/\s+/g, ' ').trim()).toBe('a&b c d');
    });
});
