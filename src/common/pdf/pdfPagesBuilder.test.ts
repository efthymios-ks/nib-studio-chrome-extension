import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFString, StandardFonts, type PDFPage } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { openPdfPagesSourceAsync, PDF_PAGES_PRODUCER, type PdfPagesSource } from './pdfPagesBuilder.js';
import { buildTestPdf } from './testing/pdfBuilder.js';

// Eight pages, each a different width, so a page of the result tells which page it came from.
const WIDTHS = [210, 220, 230, 240, 250, 260, 270, 280];
const HEIGHT = 400;
const CREATED = new Date(Date.UTC(2024, 2, 12, 8, 15, 22));
const NOW = new Date(Date.UTC(2026, 10, 18, 9, 30, 0));

async function createPdfAsync(build?: (document: PDFDocument, pages: PDFPage[]) => void): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const pages = WIDTHS.map((width, index) => {
        const page = document.addPage([width, HEIGHT]);
        page.drawText(`Page ${index + 1}`, { x: 20, y: HEIGHT - 40, size: 12, font });

        return page;
    });
    document.setTitle('Quarterly report');
    document.setAuthor('Ada Lovelace');
    document.setSubject('Figures for the quarter');
    document.setKeywords(['figures', 'quarter']);
    document.setCreator('Report Writer');
    document.setProducer('Some PDF library');
    document.setCreationDate(CREATED);
    build?.(document, pages);

    return await document.save();
}

async function readySourceAsync(bytes: Uint8Array): Promise<Extract<PdfPagesSource, { kind: 'ready' }>> {
    const source = await openPdfPagesSourceAsync(bytes);

    if (source.kind !== 'ready') {
        throw new Error(`The source is ${source.kind}`);
    }

    return source;
}

// The page each page of the PDF came from, read from its width.
function sourcePagesOf(document: PDFDocument): number[] {
    return document.getPages().map((page) => WIDTHS.indexOf(Math.round(page.getWidth())) + 1);
}

function countObjects(document: PDFDocument, type: string): number {
    return document.context
        .enumerateIndirectObjects()
        .filter(([, object]) => object instanceof PDFDict && object.lookup(PDFName.of('Type')) === PDFName.of(type))
        .length;
}

function annotationsOf(page: PDFPage): PDFDict[] {
    const annotations = page.node.lookup(PDFName.of('Annots'));

    if (!(annotations instanceof PDFArray)) {
        return [];
    }

    return Array.from({ length: annotations.size() }, (_, index) => annotations.lookup(index, PDFDict));
}

// The page a link goes to, as a page number of the document it is in.
function linkTarget(document: PDFDocument, annotation: PDFDict): number | null {
    const action = annotation.lookup(PDFName.of('A'));
    const destination = action instanceof PDFDict
        ? action.lookup(PDFName.of('D'))
        : annotation.lookup(PDFName.of('Dest'));
    const page = destination instanceof PDFArray ? destination.get(0) : null;

    if (!(page instanceof PDFRef)) {
        return null;
    }

    const index = document.getPages().findIndex((candidate) => candidate.ref === page);

    return index < 0 ? null : index + 1;
}

function addAnnotation(document: PDFDocument, page: PDFPage, entries: Record<string, unknown>): void {
    const existing = page.node.lookup(PDFName.of('Annots'));
    const annotations = existing instanceof PDFArray ? existing : document.context.obj([]);
    const annotation = document.context.obj({ Type: 'Annot', Rect: [10, 10, 60, 30], P: page.ref, ...entries } as never);
    annotations.push(document.context.register(annotation));
    page.node.set(PDFName.of('Annots'), annotations);
}

describe('openPdfPagesSourceAsync', () => {
    it('reads the page count of a PDF it can save pages of', async () => {
        const source = await openPdfPagesSourceAsync(buildTestPdf({ pages: [[612, 792], [612, 792], [792, 612]] }));

        expect(source).toMatchObject({ kind: 'ready', pageCount: 3 });
    });

    it('turns down an encrypted PDF', async () => {
        expect(await openPdfPagesSourceAsync(buildTestPdf({ isEncrypted: true }))).toEqual({ kind: 'encrypted' });
    });

    it('says why a damaged or empty file can\'t give pages', async () => {
        const text = new TextEncoder().encode('This is a text file named like a PDF.\n');
        const cut = buildTestPdf().slice(0, 60);

        expect(await openPdfPagesSourceAsync(new Uint8Array())).toEqual({ kind: 'damaged', reason: 'The file is empty.' });
        expect(await openPdfPagesSourceAsync(text)).toEqual({ kind: 'damaged', reason: 'The file is damaged, or it isn\'t a PDF.' });
        expect((await openPdfPagesSourceAsync(cut)).kind).toBe('damaged');
        expect(await openPdfPagesSourceAsync(buildTestPdf({ pages: [] }))).toEqual({ kind: 'damaged', reason: 'The PDF has no pages.' });
    });
});

describe('buildAsync', () => {
    it('makes a PDF of 1, 2, 6-8, 1 in that order, with the repeated page as a page of its own', async () => {
        const source = await readySourceAsync(await createPdfAsync());
        const result = await PDFDocument.load(await source.buildAsync([1, 2, 6, 7, 8, 1], { now: NOW }));
        const pages = result.getPages();

        expect(result.getPageCount()).toBe(6);
        expect(sourcePagesOf(result)).toEqual([1, 2, 6, 7, 8, 1]);
        expect(pages.map((page) => page.getHeight())).toEqual(Array.from({ length: 6 }, () => HEIGHT));
        expect(pages[0]?.ref).not.toBe(pages[5]?.ref);
        expect(countObjects(result, 'Page')).toBe(6);
    });

    it('shares the pages\' font rather than copying it for each page', async () => {
        const source = await readySourceAsync(await createPdfAsync());
        const result = await PDFDocument.load(await source.buildAsync([1, 1, 1, 2], { now: NOW }));

        expect(countObjects(result, 'Font')).toBe(1);
    });

    it('builds again from the same source, as a second save does', async () => {
        const source = await readySourceAsync(await createPdfAsync());
        await source.buildAsync([1, 2], { now: NOW });
        const result = await PDFDocument.load(await source.buildAsync([8, 7], { now: NOW }));

        expect(sourcePagesOf(result)).toEqual([8, 7]);
    });

    it('keeps the title, author, subject, keywords, creator and creation date, and is modified now by Nib Studio', async () => {
        const source = await readySourceAsync(await createPdfAsync());
        const result = await PDFDocument.load(await source.buildAsync([3], { now: NOW }), { updateMetadata: false });

        expect(result.getTitle()).toBe('Quarterly report');
        expect(result.getAuthor()).toBe('Ada Lovelace');
        expect(result.getSubject()).toBe('Figures for the quarter');
        expect(result.getKeywords()).toBe('figures quarter');
        expect(result.getCreator()).toBe('Report Writer');
        expect(result.getProducer()).toBe(PDF_PAGES_PRODUCER);
        expect(result.getCreationDate()?.toISOString()).toBe(CREATED.toISOString());
        expect(result.getModificationDate()?.toISOString()).toBe(NOW.toISOString());
    });

    it('dates a PDF without a creation date now and leaves out what the original doesn\'t say', async () => {
        const source = await readySourceAsync(buildTestPdf({ pages: [[612, 792], [612, 792]] }));
        const result = await PDFDocument.load(await source.buildAsync([2, 1], { now: NOW }), { updateMetadata: false });

        expect(result.getPageCount()).toBe(2);
        expect(result.getTitle()).toBeUndefined();
        expect(result.getAuthor()).toBeUndefined();
        expect(result.getCreationDate()?.toISOString()).toBe(NOW.toISOString());
    });

    it('turns down a page the PDF doesn\'t have', async () => {
        const source = await readySourceAsync(await createPdfAsync());

        await expect(source.buildAsync([1, 9])).rejects.toThrow('Page 9 isn\'t in the PDF, which has 8 pages.');
        await expect(source.buildAsync([0])).rejects.toThrow(RangeError);
    });

    it('points a link at the copy of its target page and drops a link to a page left out, with no page brought along', async () => {
        const bytes = await createPdfAsync((document, pages) => {
            addAnnotation(document, pages[0]!, { Subtype: 'Link', Dest: [pages[2]!.ref, 'Fit'] });
            addAnnotation(document, pages[0]!, { Subtype: 'Link', Dest: [pages[3]!.ref, 'XYZ', null, null, null] });
            addAnnotation(document, pages[0]!, { Subtype: 'Link', A: { S: 'URI', URI: PDFString.of('https://example.com/') } });
        });
        const source = await readySourceAsync(bytes);
        const result = await PDFDocument.load(await source.buildAsync([1, 3, 1], { now: NOW }));
        const [first, second, third] = result.getPages();

        expect(countObjects(result, 'Page')).toBe(3);
        expect(annotationsOf(first!).map((annotation) => linkTarget(result, annotation))).toEqual([2, null]);
        expect(annotationsOf(first!)[1]?.lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('S'))).toBe(PDFName.of('URI'));
        expect(annotationsOf(third!).map((annotation) => linkTarget(result, annotation))).toEqual([2, null]);
        expect(annotationsOf(second!)).toEqual([]);
        expect(annotationsOf(first!).every((annotation) => annotation.get(PDFName.of('P')) == null)).toBe(true);
    });

    it('follows GoTo actions and named destinations to the first copy of the page', async () => {
        const bytes = await createPdfAsync((document, pages) => {
            document.catalog.set(PDFName.of('Dests'), document.context.obj({ intro: [pages[0]!.ref, 'Fit'] }));
            document.catalog.set(PDFName.of('Names'), document.context.obj({
                Dests: { Kids: [{ Names: [PDFString.of('chapter-5'), { D: [pages[4]!.ref, 'Fit'] }] }] },
            } as never));
            addAnnotation(document, pages[1]!, { Subtype: 'Link', Dest: 'intro' });
            addAnnotation(document, pages[1]!, { Subtype: 'Link', Dest: PDFString.of('chapter-5') });
            addAnnotation(document, pages[1]!, { Subtype: 'Link', A: { S: 'GoTo', D: [pages[4]!.ref, 'Fit'] } });
        });
        const source = await readySourceAsync(bytes);
        const result = await PDFDocument.load(await source.buildAsync([5, 2, 1, 5], { now: NOW }));
        const second = result.getPages()[1]!;

        expect(annotationsOf(second).map((annotation) => linkTarget(result, annotation))).toEqual([3, 1, 1]);
        expect(countObjects(result, 'Page')).toBe(4);
    });

    it('keeps an annotation that isn\'t a link but takes away its action to a page left out', async () => {
        const bytes = await createPdfAsync((document, pages) => {
            addAnnotation(document, pages[0]!, { Subtype: 'Widget', FT: 'Btn', A: { S: 'GoTo', D: [pages[7]!.ref, 'Fit'] } });
        });
        const source = await readySourceAsync(bytes);
        const result = await PDFDocument.load(await source.buildAsync([1], { now: NOW }));
        const [widget] = annotationsOf(result.getPages()[0]!);

        expect(widget?.lookup(PDFName.of('Subtype'))).toBe(PDFName.of('Widget'));
        expect(widget?.get(PDFName.of('A'))).toBeUndefined();
        expect(countObjects(result, 'Page')).toBe(1);
    });

    it('leaves out article beads and page actions, which tie a page to others', async () => {
        const bytes = await createPdfAsync((document, pages) => {
            const bead = document.context.register(document.context.obj({ Type: 'Bead', P: pages[5]!.ref, R: [0, 0, 10, 10] }));
            pages[0]!.node.set(PDFName.of('B'), document.context.obj([bead]));
            pages[0]!.node.set(PDFName.of('AA'), document.context.obj({ O: { S: 'GoTo', D: [pages[6]!.ref, 'Fit'] } } as never));
        });
        const source = await readySourceAsync(bytes);
        const result = await PDFDocument.load(await source.buildAsync([1], { now: NOW }));
        const page = result.getPages()[0]!;

        expect(page.node.get(PDFName.of('B'))).toBeUndefined();
        expect(page.node.get(PDFName.of('AA'))).toBeUndefined();
        expect(countObjects(result, 'Page')).toBe(1);
    });
});
