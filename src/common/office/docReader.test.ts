import { describe, expect, it } from 'vitest';
import { TEXT_FORMAT, type DocBlock, type DocParagraph, type DocPicture, type DocTable } from './docModel.js';
import { readDocFile, type DocReadResult } from './docReader.js';
import {
    buildCompoundFile,
    buildDocFile,
    buildPropertySet,
    buildWord6File,
    DOCUMENT_SUMMARY_FORMAT_ID,
    sprm,
    SUMMARY_FORMAT_ID,
    u16,
    u32,
    word6Sprm,
    type DocFixture,
} from './testing/docFixtures.js';
import {
    BLIP,
    blip,
    blipStoreEntry,
    drawingContent,
    floatingAnchors,
    picf,
    shape,
    TINY_DIB,
    TINY_PNG,
} from './testing/officeArtFixtures.js';

const IN_TABLE = sprm(0x2416, 1);
const ROW_END = sprm(0x2417, 1);
const HEADER_ROW = sprm(0x3404, 1);
const BOLD = sprm(0x0835, 1);
const ITALIC = sprm(0x0836, 1);
const SPECIAL = sprm(0x0855, 1);

function read(fixture: DocFixture): DocReadResult {
    return readDocFile(buildDocFile(fixture));
}

function blocksOf(fixture: DocFixture): ReadonlyArray<DocBlock> {
    const result = read(fixture);

    if (!result.ok) {
        throw new Error(`${result.title}: ${result.message}`);
    }

    return result.document.blocks;
}

function textOf(paragraph: DocBlock | undefined): string {
    if (paragraph?.kind !== 'paragraph') {
        return `<${paragraph?.kind ?? 'none'}>`;
    }

    return paragraph.inlines.map((inline) => (inline.kind === 'text' ? inline.text : `[${inline.kind}]`)).join('');
}

function cellTexts(table: DocBlock | undefined): string[][] {
    return (table as DocTable).rows.map((row) => row.cells.map((cell) => cell.paragraphs.map(textOf).join('/')));
}

describe('readDocFile text', () => {
    it('reads 8-bit and UTF-16 pieces into paragraphs, mapping Windows-1252 punctuation', () => {
        const blocks = blocksOf({
            pieces: [
                { text: 'It’s “quoted” – €5\r', compressed: true },
                { text: 'Ελληνικά κείμενο\r' },
            ],
        });

        expect(blocks.map(textOf)).toEqual(['It’s “quoted” – €5', 'Ελληνικά κείμενο']);
    });

    it('keeps a paragraph split across pieces whole', () => {
        const blocks = blocksOf({ pieces: [{ text: 'Half in 8-bit, ', compressed: true }, { text: 'half in UTF-16.\r' }] });

        expect(blocks.map(textOf)).toEqual(['Half in 8-bit, half in UTF-16.']);
    });

    it('reads only the main document, up to its text length', () => {
        const blocks = blocksOf({ pieces: [{ text: 'Body\rFootnote text\r', compressed: true }], mainTextLength: 5 });

        expect(blocks.map(textOf)).toEqual(['Body']);
    });

    it('keeps field results, nested fields included, and drops field codes', () => {
        const blocks = blocksOf({
            pieces: [{
                text: 'See \u0013 HYPERLINK "https://example.com" \u0014the \u0013 PAGE \u0014site\u0015\u0015 now. \u0013 TOC \u0015Done\r',
                compressed: true,
            }],
        });

        expect(blocks.map(textOf)).toEqual(['See the site now. Done']);
    });

    it('turns breaks, hyphens and picture anchors into what Word shows', () => {
        const text = 'One\u000btwo\u001ethree\u001ffour\u0001five\u0008six\u0009tab\r';
        const blocks = blocksOf({ pieces: [{ text, compressed: true }], characters: [{ start: 0, end: text.length, sprms: [SPECIAL] }] });
        const paragraph = blocks[0] as DocParagraph;

        expect(paragraph.inlines.map((inline) => (inline.kind === 'text' ? inline.text : `[${inline.kind}]`))).toEqual([
            'One',
            '[line-break]',
            'two‑threefour',
            '[picture]',
            'five',
            '[picture]',
            'six\ttab',
        ]);
    });

    it('splits pages at a page break and drops the empty paragraph a break leaves', () => {
        const blocks = blocksOf({ pieces: [{ text: 'Page one\r\u000cPage two\r', compressed: true }] });

        expect(blocks.map(textOf)).toEqual(['Page one', '<page-break>', 'Page two']);
    });

    it('keeps empty paragraphs between text but drops the ones the document ends with', () => {
        const blocks = blocksOf({ pieces: [{ text: 'A\r\rB\r\r\r', compressed: true }] });

        expect(blocks.map(textOf)).toEqual(['A', '', 'B']);
    });
});

describe('readDocFile tables', () => {
    it('builds rows from cell marks and row ends', () => {
        const blocks = blocksOf({
            pieces: [{ text: 'Before\ra\u0007b\u0007\u0007c\u0007d\u0007\u0007After\r', compressed: true }],
            paragraphs: new Map([
                [1, { sprms: [IN_TABLE] }],
                [2, { sprms: [IN_TABLE] }],
                [3, { sprms: [IN_TABLE, ROW_END, HEADER_ROW] }],
                [4, { sprms: [IN_TABLE] }],
                [5, { sprms: [IN_TABLE] }],
                [6, { sprms: [IN_TABLE, ROW_END] }],
            ]),
        });

        expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'table', 'paragraph']);
        expect(cellTexts(blocks[1])).toEqual([['a', 'b'], ['c', 'd']]);
        expect((blocks[1] as DocTable).rows.map((row) => row.isHeader)).toEqual([true, false]);
        expect(textOf(blocks[2])).toBe('After');
    });

    it('keeps empty cells apart from row ends by their formatting', () => {
        const blocks = blocksOf({
            pieces: [{ text: 'a\u0007\u0007c\u0007\u0007', compressed: true }],
            paragraphs: new Map([
                [0, { sprms: [IN_TABLE] }],
                [1, { sprms: [IN_TABLE] }],
                [2, { sprms: [IN_TABLE] }],
                [3, { sprms: [IN_TABLE, ROW_END] }],
            ]),
        });

        expect(cellTexts(blocks[0])).toEqual([['a', '', 'c']]);
    });

    it('holds several paragraphs in one cell and flattens a nested table into it', () => {
        const blocks = blocksOf({
            pieces: [{ text: 'first\rsecond\u0007inner\r\r\u0007\u0007', compressed: true }],
            paragraphs: new Map([
                [0, { sprms: [IN_TABLE] }],
                [1, { sprms: [IN_TABLE] }],
                [2, { sprms: [IN_TABLE, sprm(0x6649, 2, 0, 0, 0), sprm(0x244b, 1)] }],
                [3, { sprms: [IN_TABLE, sprm(0x6649, 2, 0, 0, 0), sprm(0x244c, 1)] }],
                [4, { sprms: [IN_TABLE] }],
                [5, { sprms: [IN_TABLE, ROW_END] }],
            ]),
        });

        expect(cellTexts(blocks[0])).toEqual([['first/second', 'inner/']]);
    });

    it('tells row ends from cells by position when the formatting is missing', () => {
        const blocks = blocksOf({ pieces: [{ text: 'a\u0007b\u0007\u0007c\u0007d\u0007\u0007', compressed: true }] });

        expect(cellTexts(blocks[0])).toEqual([['a', 'b'], ['c', 'd']]);
    });
});

describe('readDocFile formatting', () => {
    it('reads bold, italic, underline, strike and superscript runs', () => {
        const blocks = blocksOf({
            pieces: [{ text: 'plain bold italic under strike sup\r', compressed: true }],
            characters: [
                { start: 6, end: 10, sprms: [BOLD] },
                { start: 11, end: 17, sprms: [ITALIC, BOLD] },
                { start: 18, end: 23, sprms: [sprm(0x2a3e, 1)] },
                { start: 24, end: 30, sprms: [sprm(0x0837, 1)] },
                { start: 31, end: 34, sprms: [sprm(0x2a48, 1)] },
            ],
        });
        const inlines = (blocks[0] as DocParagraph).inlines.filter((inline) => inline.kind === 'text' && inline.text.trim() !== '');

        expect(inlines).toEqual([
            { kind: 'text', text: 'plain ', format: 0 },
            { kind: 'text', text: 'bold', format: TEXT_FORMAT.bold },
            { kind: 'text', text: 'italic', format: TEXT_FORMAT.bold | TEXT_FORMAT.italic },
            { kind: 'text', text: 'under', format: TEXT_FORMAT.underline },
            { kind: 'text', text: 'strike', format: TEXT_FORMAT.strike },
            { kind: 'text', text: 'sup', format: TEXT_FORMAT.superscript },
        ]);
    });

    it('leaves out hidden and deleted text', () => {
        const blocks = blocksOf({
            pieces: [{ text: 'shown hidden deleted end\r', compressed: true }],
            characters: [
                { start: 6, end: 13, sprms: [sprm(0x083c, 1)] },
                { start: 13, end: 21, sprms: [sprm(0x0800, 1)] },
            ],
        });

        expect(blocks.map(textOf)).toEqual(['shown end']);
    });

    it('takes headings, the title and alignment from styles and paragraph formatting', () => {
        const blocks = blocksOf({
            pieces: [{ text: 'Report\rIntro\rDetail\rCustom\rCentred\rBody\r', compressed: true }],
            styles: [
                { sti: 0, name: 'Normal' },
                { sti: 1, name: 'heading 1', base: 0 },
                { sti: 2, name: 'heading 2', base: 0 },
                { sti: 62, name: 'Title', base: 0 },
                { sti: 0x0ffe, name: 'Chapter', base: 0, paragraphSprms: [sprm(0x2640, 0)] },
            ],
            paragraphs: new Map([
                [0, { style: 3 }],
                [1, { style: 1 }],
                [2, { style: 2 }],
                [3, { style: 4 }],
                [4, { sprms: [sprm(0x2403, 1)] }],
            ]),
        });

        expect(blocks.map((block) => {
            const paragraph = block as DocParagraph;

            return `${paragraph.role}${paragraph.level === 0 ? '' : paragraph.level} ${paragraph.alignment}`;
        })).toEqual(['title start', 'heading1 start', 'heading2 start', 'heading1 start', 'body center', 'body start']);
    });

    it('applies a paragraph style\'s bold to body text, and a run can turn it off', () => {
        const blocks = blocksOf({
            pieces: [{ text: 'Strong not\r', compressed: true }],
            styles: [{ sti: 0, name: 'Normal' }, { sti: 0x0ffe, name: 'Emphatic', base: 0, characterSprms: [BOLD] }],
            paragraphs: new Map([[0, { style: 1 }]]),
            characters: [{ start: 7, end: 10, sprms: [sprm(0x0835, 0x81)] }],
        });

        expect((blocks[0] as DocParagraph).inlines).toEqual([
            { kind: 'text', text: 'Strong ', format: TEXT_FORMAT.bold },
            { kind: 'text', text: 'not', format: 0 },
        ]);
    });

    it('marks list items with their list, level and number format', () => {
        const blocks = blocksOf({
            pieces: [{ text: 'Dot\rOne\rNested\rPlain\r', compressed: true }],
            lists: [
                { id: 11, levels: [{ format: 23 }] },
                { id: 22, levels: [{ format: 0, start: 3 }, { format: 4 }, ...new Array(7).fill({ format: 0 })] },
            ],
            paragraphs: new Map([
                [0, { sprms: [sprm(0x460b, 1, 0)] }],
                [1, { sprms: [sprm(0x460b, 2, 0)] }],
                [2, { sprms: [sprm(0x460b, 2, 0), sprm(0x260a, 1)] }],
            ]),
        });

        expect(blocks.map((block) => (block as DocParagraph).list)).toEqual([
            { id: 11, level: 0, format: 'bullet', start: 1 },
            { id: 22, level: 0, format: 'decimal', start: 3 },
            { id: 22, level: 1, format: 'lower-alpha', start: 1 },
            null,
        ]);
    });

    it('reads the page size and margins of the first section', () => {
        const result = read({
            pieces: [{ text: 'Wide\r', compressed: true }],
            section: [sprm(0xb01f, ...u16(15840)), sprm(0xb020, ...u16(12240)), sprm(0xb021, ...u16(720)), sprm(0xb022, ...u16(720))],
        });

        expect(result.ok && result.document.page).toEqual({ width: 1056, height: 816, marginTop: 96, marginRight: 48, marginBottom: 96, marginLeft: 48 });
    });

    it('marks a template by its FIB flag', () => {
        const result = read({ pieces: [{ text: 'Template\r', compressed: true }], flags: 0x0201 });

        expect(result.ok && result.document.isTemplate).toBe(true);
    });
});

function picturesOf(fixture: DocFixture): DocPicture[] {
    return blocksOf(fixture).flatMap((block) => (block.kind === 'paragraph' ? block.inlines : []))
        .filter((inline): inline is DocPicture => inline.kind === 'picture');
}

// A paragraph holding one inline picture whose PICF record is at `location` in the Data stream.
function inlinePictureFixture(data: ReadonlyArray<number>, location = 0): DocFixture {
    return {
        pieces: [{ text: 'See \u0001\r', compressed: true }],
        characters: [{ start: 4, end: 5, sprms: [SPECIAL, sprm(0x6a03, ...u32(location))] }],
        data,
    };
}

describe('readDocFile pictures', () => {
    it('reads an inline picture from its PICF in the Data stream, at its goal size and scale', () => {
        const data = picf({
            width: 1500,
            height: 900,
            scaleX: 500,
            scaleY: 2000,
            records: [shape({ id: 1025, blipIndex: 1, description: 'Logo' }), blipStoreEntry({ blipType: 6, embedded: blip(BLIP.png, TINY_PNG) })],
        });
        const [picture] = picturesOf(inlinePictureFixture(data));

        expect(picture).toMatchObject({ layout: 'inline', format: 'png', width: 50, height: 120, crop: null, description: 'Logo' });
        expect(picture?.image?.mimeType).toBe('image/png');
        expect([...(picture?.image?.bytes ?? [])]).toEqual(TINY_PNG);
    });

    it('takes the crop off an inline picture\'s size, and skips a shape file\'s name', () => {
        const data = picf({
            width: 3000,
            height: 1500,
            name: 'logo.png',
            records: [shape({ id: 1025, blipIndex: 1, crop: { left: 0x4000, right: 0x4000 } }), blip(BLIP.png, TINY_PNG)],
        });
        const [picture] = picturesOf(inlinePictureFixture([0, 0, ...data], 2));

        expect(picture).toMatchObject({ format: 'png', width: 100, height: 100, crop: { top: 0, right: 0.25, bottom: 0, left: 0.25 } });
    });

    it('wraps an inline DIB as a BMP, and names an EMF without an image', () => {
        const dib = picf({ width: 150, height: 150, records: [shape({ id: 1, blipIndex: 1 }), blip(BLIP.dib, TINY_DIB)] });
        const emf = picf({ width: 150, height: 150, records: [shape({ id: 2, blipIndex: 1 }), blip(BLIP.emf, [1, 2, 3, 4])] });

        expect(picturesOf(inlinePictureFixture(dib))[0]?.image?.mimeType).toBe('image/bmp');
        expect(picturesOf(inlinePictureFixture(emf))[0]).toMatchObject({ format: 'emf', image: null, width: 10, height: 10 });
    });

    it('reads a floating picture from its anchor, its shape and the blip store, which points into the delay stream', () => {
        const png = blip(BLIP.png, TINY_PNG);
        const [picture] = picturesOf({
            pieces: [{ text: 'Intro\r\u0008Caption\r', compressed: true }],
            characters: [{ start: 6, end: 7, sprms: [SPECIAL] }],
            drawing: {
                delay: png,
                build: (delayAt) => ({
                    anchors: floatingAnchors([{ cp: 6, shapeId: 1026, left: 300, top: 0, right: 3300, bottom: 1500 }]),
                    content: drawingContent([blipStoreEntry({ blipType: 6, delayOffset: delayAt, size: png.length })], [shape({ id: 1026, blipIndex: 1 })]),
                }),
            },
        });

        expect(picture).toMatchObject({ layout: 'floating', format: 'png', width: 200, height: 100 });
        expect([...(picture?.image?.bytes ?? [])]).toEqual(TINY_PNG);
    });

    it('shows a placeholder for a drawing without a picture and for anchors the drawing data doesn\'t know', () => {
        const pictures = picturesOf({
            pieces: [{ text: '\u0008a\u0008b\r', compressed: true }],
            characters: [{ start: 0, end: 4, sprms: [SPECIAL] }],
            drawing: {
                build: () => ({
                    anchors: floatingAnchors([{ cp: 0, shapeId: 1030, left: 0, top: 0, right: 10, bottom: 10 }]),
                    content: drawingContent([], [shape({ id: 1030 })]),
                }),
            },
        });

        expect(pictures.map((picture) => [picture.layout, picture.format, picture.image])).toEqual([['floating', null, null], ['floating', null, null]]);
    });

    it('keeps the text when picture data is damaged or out of range', () => {
        const fixtures: DocFixture[] = [
            inlinePictureFixture([1, 2, 3]),
            inlinePictureFixture(picf({ width: 10, height: 10, records: [] }), 5000),
            { ...inlinePictureFixture([]), data: undefined },
            inlinePictureFixture(picf({ width: 10, height: 10, records: [shape({ id: 1, blipIndex: 4 })] })),
            {
                pieces: [{ text: 'See \u0008\r', compressed: true }],
                characters: [{ start: 4, end: 5, sprms: [SPECIAL] }],
                drawing: { build: () => ({ anchors: [...u32(4), ...u32(5), 1, 2, 3], content: [0xff, 0xff, 0xff] }) },
            },
        ];

        for (const fixture of fixtures) {
            const [paragraph] = blocksOf(fixture);

            expect(textOf(paragraph)).toBe('See [picture]');
            expect(picturesOf(fixture)[0]?.image).toBeNull();
        }
    });
});

describe('readDocFile Word 6 and Word 95', () => {
    it('reads the text a Word 6 file holds in one run, with its character formatting', () => {
        const text = 'Plain bold italic 4th\rNext\r';
        const result = readDocFile(buildWord6File({
            text,
            characters: [
                { start: 6, end: 10, sprms: [word6Sprm(93, 0, 0), word6Sprm(85, 1)] },
                { start: 11, end: 17, sprms: [word6Sprm(86, 1)] },
                { start: 19, end: 21, sprms: [word6Sprm(104, 1)] },
            ],
            summary: buildPropertySet(SUMMARY_FORMAT_ID, [[2, 'string', 'Old memo']]),
        }));

        expect(result.ok && result.document.version).toBe('word6');
        expect(result.properties?.title).toBe('Old memo');
        expect(result.ok && (result.document.blocks[0] as DocParagraph).inlines).toEqual([
            { kind: 'text', text: 'Plain ', format: 0 },
            { kind: 'text', text: 'bold', format: TEXT_FORMAT.bold },
            { kind: 'text', text: ' ', format: 0 },
            { kind: 'text', text: 'italic', format: TEXT_FORMAT.italic },
            { kind: 'text', text: ' 4', format: 0 },
            { kind: 'text', text: 'th', format: TEXT_FORMAT.superscript },
        ]);
        expect(result.ok && result.document.blocks.map(textOf)).toEqual(['Plain bold italic 4th', 'Next']);
    });

    it('follows a Word 6 piece table and reads tables, fields and hidden text', () => {
        const text = 'Before \u0013 PAGE \u00142\u0015 hidden\ra\u0007b\u0007\u0007After\r';
        const blocks = readDocFile(buildWord6File({
            text,
            pieceBreaks: [7, 22, 30],
            characters: [{ start: 17, end: 24, sprms: [word6Sprm(92, 1)] }],
        }));

        expect(blocks.ok && blocks.document.blocks.map((block) => (block.kind === 'table' ? cellTexts(block) : textOf(block)))).toEqual([
            'Before 2',
            [['a', 'b']],
            'After',
        ]);
    });

    it('reads 8-bit text in the code page of the file\'s language', () => {
        const greek = readDocFile(buildWord6File({ text: [0xc1, 0xe8, 0xde, 0xed, 0xe1, 0x0d], languageId: 0x0408 }));
        const western = readDocFile(buildWord6File({ text: [0x93, 0x43, 0x61, 0x66, 0xe9, 0x94, 0x0d] }));

        expect(greek.ok && greek.document.blocks.map(textOf)).toEqual(['Αθήνα']);
        expect(western.ok && western.document.blocks.map(textOf)).toEqual(['“Café”']);
    });

    it('says an encrypted Word 95 file\'s encryption isn\'t supported, and a template is one', () => {
        const encrypted = readDocFile(buildWord6File({ text: 'Secret\r', flags: 0x0100, fib: 0x0068 }));
        const template = readDocFile(buildWord6File({ text: 'Form\r', flags: 0x0001 }));

        expect(encrypted).toMatchObject({ ok: false, problem: 'encrypted', title: 'This document\'s encryption isn\'t supported', version: 'word6' });
        expect(template.ok && template.document.isTemplate).toBe(true);
    });

    it('reads a Word 95 file that carries the Word 97 identifier, and reports a text range past the end as damage', () => {
        const word = new Array<number>(0x200).fill(0);
        word.splice(0, 4, ...u16(0xa5dc), ...u16(0x0065));
        word.splice(0x18, 8, ...u32(0x100), ...u32(0x5000));
        word.splice(0x34, 4, ...u32(4));
        const word95 = readDocFile(buildWord6File({ text: 'Short\r', ident: 0xa5ec, fib: 0x0068 }));

        expect(word95.ok && word95.document.blocks.map(textOf)).toEqual(['Short']);
        expect(readDocFile(buildCompoundFile({ WordDocument: Uint8Array.from(word) }))).toMatchObject({ ok: false, problem: 'damaged' });
    });
});

describe('readDocFile properties', () => {
    it('reads the summary and document summary property sets', () => {
        const created = new Date('2024-03-05T08:30:00Z');
        const result = read({
            pieces: [{ text: 'Text\r', compressed: true }],
            summary: buildPropertySet(SUMMARY_FORMAT_ID, [
                [2, 'string', 'Annual report'],
                [3, 'string', 'Finances'],
                [4, 'string', 'Zoë Müller'],
                [5, 'string', 'money, plans'],
                [6, 'string', 'Draft for review'],
                [8, 'unicode', 'Ελένη'],
                [9, 'string', '7'],
                [12, 'date', created],
                [13, 'date', new Date('2024-03-06T10:00:00Z')],
                [14, 'int', 12],
                [15, 'int', 3456],
                [16, 'int', 20123],
                [18, 'string', 'Microsoft Office Word'],
            ]),
            documentSummary: buildPropertySet(DOCUMENT_SUMMARY_FORMAT_ID, [
                [2, 'string', 'Reports'],
                [14, 'string', 'Ana Silva'],
                [15, 'string', 'Acme € Co'],
            ]),
        });

        expect(result.properties).toEqual({
            title: 'Annual report',
            subject: 'Finances',
            author: 'Zoë Müller',
            keywords: 'money, plans',
            comments: 'Draft for review',
            lastSavedBy: 'Ελένη',
            revision: '7',
            created,
            modified: new Date('2024-03-06T10:00:00Z'),
            pages: 12,
            words: 3456,
            characters: 20123,
            application: 'Microsoft Office Word',
            category: 'Reports',
            manager: 'Ana Silva',
            company: 'Acme € Co',
        });
    });

    it('reads 8-bit strings in the code page the set names', () => {
        const result = read({
            pieces: [{ text: 'Text\r', compressed: true }],
            summary: buildPropertySet(SUMMARY_FORMAT_ID, [[2, 'string', 'Τίτλος']], 65001),
        });

        expect(result.properties?.title).toBe('Τίτλος');
    });
});

describe('readDocFile problems', () => {
    it('says an encrypted document is encrypted, with its properties', () => {
        const result = read({
            pieces: [{ text: 'Secret\r', compressed: true }],
            flags: 0x0300,
            summary: buildPropertySet(SUMMARY_FORMAT_ID, [[2, 'string', 'Locked']]),
        });

        expect(result).toMatchObject({ ok: false, problem: 'encrypted' });
        expect(result.properties?.title).toBe('Locked');
    });

    it('says a file is encrypted although encryption scrambled the FIB after its start', () => {
        // Only the first 32 bytes of the FIB stay readable; the rest is as random as encrypted bytes are.
        const scrambled = (ident: number, fib: number): Uint8Array => {
            const word = Array.from({ length: 0x600 }, (_, index) => (index * 151 + 7) & 0xff);
            word.splice(0, 4, ...u16(ident), ...u16(fib));
            word.splice(0x0a, 2, ...u16(0x0300));
            word.splice(0x20, 2, ...u16(0xfff0));

            return buildCompoundFile({ 'WordDocument': Uint8Array.from(word), '1Table': new Uint8Array(512) });
        };

        for (const [ident, fib] of [[0xa5ec, 0x00c1], [0xa5ec, 0x0101], [0xa5dc, 0x0065], [0xa5ec, 0x0068]] as const) {
            expect(readDocFile(scrambled(ident, fib)), fib.toString(16)).toMatchObject({ ok: false, problem: 'encrypted' });
        }
    });

    it('says a password-protected DOCX is encrypted', () => {
        const result = readDocFile(buildCompoundFile({ EncryptionInfo: Uint8Array.of(4, 0, 4, 0), EncryptedPackage: Uint8Array.of(1, 2, 3) }));

        expect(result).toMatchObject({ ok: false, problem: 'encrypted' });
    });

    it('reads a Word 97 file by its identifier and nFib', () => {
        const result = read({ pieces: [{ text: 'Current\r', compressed: true }], ident: 0xa5ec, fib: 0x00c1 });

        expect(result.ok && result.document.blocks.map(textOf)).toEqual(['Current']);
    });

    it('names files older than Word 6 by their nFib or identifier, whichever identifier they carry', () => {
        const versions: ReadonlyArray<readonly [ident: number, fib: number]> = [
            [0xa5dc, 0x002d],
            [0xa5ec, 0x002d],
            [0xa5db, 0x002d],
            [0xa59b, 0x0021],
        ];

        for (const [ident, fib] of versions) {
            const result = read({ pieces: [{ text: 'Old\r', compressed: true }], ident, fib });
            const label = `ident ${ident.toString(16)}, nFib ${fib.toString(16)}`;

            expect(result, label).toMatchObject({ ok: false, problem: 'old-format', title: 'This document uses an older Word format' });
            expect(!result.ok && result.message, label).toContain('Word 2 or earlier');
        }
    });

    it('says an Excel workbook with a Word name isn\'t a Word document', () => {
        const result = readDocFile(buildCompoundFile({ Workbook: Uint8Array.from(u32(0x00060809)) }));

        expect(result).toMatchObject({ ok: false, problem: 'not-word', message: 'It is an Excel workbook. Only Word documents preview here.' });
    });

    it('reports damage rather than throwing', () => {
        const results = [
            readDocFile(Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0)),
            read({ pieces: [{ text: 'No table\r', compressed: true }], omitTableStream: true }),
            read({ pieces: [{ text: 'Bad ident\r', compressed: true }], ident: 0x1234 }),
            read({ pieces: [{ text: 'Too long\r', compressed: true }], mainTextLength: 1_000_000 }),
        ];

        expect(results.map((result) => (result.ok ? 'ok' : result.problem))).toEqual(['damaged', 'damaged', 'damaged', 'damaged']);
        expect(results.every((result) => !result.ok && result.title === 'This document can\'t be read')).toBe(true);
    });
});
