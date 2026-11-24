import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { readImageSizes, readOoxmlDetails, readPageGeometry, resolvePartPath } from './ooxmlDetails.js';
import { openZipPackage } from './zipPackage.js';

const CORE_XML = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"',
    ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"',
    ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '<dc:title>Quarterly &amp; yearly</dc:title><dc:subject>Orders</dc:subject><dc:creator>Ελένη</dc:creator>',
    '<cp:keywords>orders, revenue</cp:keywords><dc:description>Sample text.</dc:description>',
    '<cp:lastModifiedBy>Nib</cp:lastModifiedBy><cp:revision>3</cp:revision><cp:category>   </cp:category>',
    '<dcterms:created xsi:type="dcterms:W3CDTF">2026-11-02T09:30:00Z</dcterms:created>',
    '<dcterms:modified xsi:type="dcterms:W3CDTF">not a date</dcterms:modified>',
    '</cp:coreProperties>',
].join('');

const APP_XML = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">',
    '<Application>Microsoft Office Word</Application><Pages>4</Pages><Words>1234</Words><Characters>5678</Characters>',
    '<Company>Acme</Company><Manager>Ana</Manager><TotalTime>12</TotalTime>',
    '</Properties>',
].join('');

const ROOT_RELS = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '</Relationships>',
].join('');

const DOCUMENT_RELS = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>',
    '<Relationship Id="rIdImage2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../word/media/image2.jpeg"/>',
    '<Relationship Id="rIdWeb" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.com/a.png" TargetMode="External"/>',
    '</Relationships>',
].join('');

const DOCUMENT_XML = [
    '<w:document xmlns:w="w" xmlns:wp="wp" xmlns:a="a" xmlns:r="r" xmlns:v="v"><w:body>',
    '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="2286000" cy="1524000"/><a:graphic><a:graphicData><pic:pic><pic:blipFill>',
    '<a:blip r:embed="rIdImage1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>',
    '<w:p><w:r><w:pict><v:shape style="width:72pt;height:0.5in"><v:imagedata r:id="rIdImage2"/></v:shape></w:pict></w:r></w:p>',
    '<w:p><w:r><w:drawing><wp:anchor><wp:extent cx="952500" cy="952500"/><a:blip r:link="rIdWeb"/></wp:anchor></w:drawing></w:r></w:p>',
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1800"/></w:sectPr>',
    '</w:body></w:document>',
].join('');

async function zipOfAsync(files: Readonly<Record<string, string | Uint8Array>>): Promise<Uint8Array> {
    const zip = new JSZip();

    for (const [name, content] of Object.entries(files)) {
        zip.file(name, content);
    }

    return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

describe('readOoxmlDetails', () => {
    it('reads core and app properties, the page and the picture sizes of a DOCX', async () => {
        const zip = openZipPackage(await zipOfAsync({
            '_rels/.rels': ROOT_RELS,
            'word/document.xml': DOCUMENT_XML,
            'word/_rels/document.xml.rels': DOCUMENT_RELS,
            'word/media/image1.png': new Uint8Array(1000),
            'word/media/image2.jpeg': new Uint8Array(2000),
            'docProps/core.xml': CORE_XML,
            'docProps/app.xml': APP_XML,
        }));
        const details = zip == null ? null : readOoxmlDetails(zip);

        expect(details?.kind).toBe('word');
        expect(details?.properties).toEqual({
            title: 'Quarterly & yearly',
            subject: 'Orders',
            author: 'Ελένη',
            keywords: 'orders, revenue',
            comments: 'Sample text.',
            lastSavedBy: 'Nib',
            revision: '3',
            created: new Date('2026-11-02T09:30:00Z'),
            application: 'Microsoft Office Word',
            company: 'Acme',
            manager: 'Ana',
            pages: 4,
            words: 1234,
            characters: 5678,
        });
        expect(details?.page).toEqual({ width: 11906 / 15, height: 16838 / 15, marginTop: 96, marginRight: 72, marginBottom: 96, marginLeft: 120 });
        expect(details?.imageSizes).toEqual(new Map([[1000, [{ width: 240, height: 160 }]], [2000, [{ width: 96, height: 48 }]]]));
    });

    it('names a workbook or presentation package by its main part', async () => {
        const rels = ROOT_RELS.replace('word/document.xml', 'xl/workbook.xml');
        const zip = openZipPackage(await zipOfAsync({ '_rels/.rels': rels, 'xl/workbook.xml': '<workbook/>' }));

        expect(zip == null ? null : readOoxmlDetails(zip).kind).toBe('excel');
    });

    it('finds the document part without package relationships', async () => {
        const zip = openZipPackage(await zipOfAsync({ 'word/document.xml': DOCUMENT_XML }));

        expect(zip == null ? null : readOoxmlDetails(zip)).toMatchObject({ kind: 'word', properties: {}, page: { width: 11906 / 15 } });
    });
});

describe('ooxml helpers', () => {
    it('resolves relationship targets against the part that names them', () => {
        expect(resolvePartPath('word/document.xml', 'media/image1.png')).toBe('word/media/image1.png');
        expect(resolvePartPath('word/document.xml', '../customXml/item1.xml')).toBe('customXml/item1.xml');
        expect(resolvePartPath('word/document.xml', '/word/media/a.png')).toBe('word/media/a.png');
        expect(resolvePartPath('', 'word/document.xml')).toBe('word/document.xml');
    });

    it('takes the last section of the body and default margins', () => {
        expect(readPageGeometry('<w:sectPr><w:pgSz w:w="12240"/></w:sectPr><w:sectPr><w:pgSz w:w="15840" w:orient="landscape"/></w:sectPr>'))
            .toEqual({ width: 1056, height: 1056 * 1.294, marginTop: 96, marginRight: 96, marginBottom: 96, marginLeft: 96 });
        expect(readPageGeometry('<w:body/>')).toBeNull();
    });

    it('queues the sizes of a picture placed twice in document order', () => {
        const xml = [
            '<wp:inline><wp:extent cx="952500" cy="952500"/><a:blip r:embed="rId1"/></wp:inline>',
            '<wp:inline><wp:extent cx="1905000" cy="952500"/><a:blip r:embed="rId1"/></wp:inline>',
        ].join('');

        expect(readImageSizes(xml, () => 77)).toEqual(new Map([[77, [{ width: 100, height: 100 }, { width: 200, height: 100 }]]]));
    });
});
