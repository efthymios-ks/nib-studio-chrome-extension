import { describe, expect, it } from 'vitest';
import type { MetadataGroup } from '../preview/metadataGroups.js';
import { formatLocalDateTime } from '../text/timeFormat.js';
import { describePdfError, isTaggedMarkInfo, pdfMetadataGroups, restrictionsText, type PdfDetails } from './pdfDetails.js';
import { buildTestPdf } from './testing/pdfBuilder.js';

const FILE = { name: 'contract.pdf', size: 7_869_974, lastModified: Date.UTC(2026, 10, 18, 9, 0, 0) };

function details(overrides: Partial<PdfDetails> = {}): PdfDetails {
    return {
        info: { PDFFormatVersion: '1.7', IsLinearized: false, EncryptFilterName: null },
        xmp: null,
        pageCount: 32,
        firstPageSize: { width: 595.28, height: 841.89 },
        hasMixedPageSizes: false,
        permissions: null,
        isTagged: false,
        needsPassword: false,
        ...overrides,
    };
}

function rows(groups: ReadonlyArray<MetadataGroup>): Record<string, string> {
    return Object.fromEntries(groups.flatMap((group) => group.rows.map((row) => [`${group.title}/${row.label}`, row.value])));
}

function xmp(entries: Record<string, unknown>): PdfDetails['xmp'] {
    return { get: (name) => entries[name] ?? null };
}

describe('pdfMetadataGroups', () => {
    it('lists the file, the document information, its history, the PDF facts and the security, in that order', () => {
        const groups = pdfMetadataGroups(FILE, details({
            info: {
                PDFFormatVersion: '1.6',
                IsLinearized: true,
                EncryptFilterName: null,
                Title: 'Lease agreement',
                Author: 'Ada Lovelace',
                Subject: 'Office lease',
                Keywords: 'lease, office',
                Creator: 'Writer',
                Producer: 'LibreOffice 7.6',
                CreationDate: "D:20240312101522+02'00'",
                ModDate: 'D:20250101090000Z',
                Language: 'el-GR',
            },
            isTagged: true,
        }));

        expect(groups.map((group) => group.title)).toEqual(['File', 'Document', 'History', 'PDF', 'Security']);
        expect(rows(groups)).toEqual({
            'File/Name': 'contract.pdf',
            'File/Type': 'PDF document',
            'File/Size': '7.5 MB (7,869,974 bytes)',
            'File/Modified': formatLocalDateTime(new Date(FILE.lastModified)),
            'Document/Title': 'Lease agreement',
            'Document/Author': 'Ada Lovelace',
            'Document/Subject': 'Office lease',
            'Document/Keywords': 'lease, office',
            'History/Created': formatLocalDateTime(new Date(Date.UTC(2024, 2, 12, 8, 15, 22))),
            'History/Modified': formatLocalDateTime(new Date(Date.UTC(2025, 0, 1, 9, 0, 0))),
            'History/Application': 'Writer',
            'History/Producer': 'LibreOffice 7.6',
            'PDF/Version': '1.6',
            'PDF/Pages': '32',
            'PDF/Page size': '210 × 297 mm (8.27 × 11.69 in), A4',
            'PDF/Tagged': 'Yes',
            'PDF/Fast web view': 'Yes',
            'PDF/Language': 'el-GR',
            'Security/Encrypted': 'No',
        });
    });

    it('falls back to the XMP metadata, joining lists', () => {
        const result = rows(pdfMetadataGroups(FILE, details({
            xmp: xmp({
                'dc:title': 'Συμβόλαιο μίσθωσης',
                'dc:creator': ['Ada Lovelace', 'Alan Turing'],
                'dc:description': 'Office lease',
                'dc:subject': ['lease', 'office'],
                'xmp:createdate': '2024-03-12T10:15:22+02:00',
                'xmp:modifydate': '2024-03-13',
                'xmp:creatortool': 'Word',
                'pdf:producer': 'Acrobat',
            }),
        })));

        expect(result['Document/Title']).toBe('Συμβόλαιο μίσθωσης');
        expect(result['Document/Author']).toBe('Ada Lovelace, Alan Turing');
        expect(result['Document/Subject']).toBe('Office lease');
        expect(result['Document/Keywords']).toBe('lease, office');
        expect(result['History/Created']).toBe(formatLocalDateTime(new Date(Date.UTC(2024, 2, 12, 8, 15, 22))));
        expect(result['History/Modified']).toBe('2024-03-13');
        expect(result['History/Application']).toBe('Word');
        expect(result['History/Producer']).toBe('Acrobat');
    });

    it('prefers the Info dictionary over XMP, and tidies what it shows', () => {
        const result = rows(pdfMetadataGroups(FILE, details({
            info: { Title: '  Lease\u0000 agreement\n draft ', Author: '   ' },
            xmp: xmp({ 'dc:title': 'Other title', 'dc:creator': ['Alan Turing'] }),
        })));

        expect(result['Document/Title']).toBe('Lease agreement draft');
        expect(result['Document/Author']).toBe('Alan Turing');
    });

    it('keeps a date it can\'t read as written', () => {
        expect(rows(pdfMetadataGroups(FILE, details({ info: { CreationDate: 'last Tuesday' } })))['History/Created']).toBe('last Tuesday');
    });

    it('leaves out the Document group when the PDF says nothing about itself', () => {
        expect(pdfMetadataGroups(FILE, details()).map((group) => group.title)).toEqual(['File', 'PDF', 'Security']);
    });

    it('notes when the other pages differ from the first, and leaves out what is unknown', () => {
        const mixed = rows(pdfMetadataGroups(FILE, details({ hasMixedPageSizes: true, firstPageSize: { width: 612, height: 792 }, isTagged: null })));

        expect(mixed['PDF/Page size']).toBe('215.9 × 279.4 mm (8.5 × 11 in), Letter; the first page, others differ');
        expect(mixed['PDF/Tagged']).toBeUndefined();
        expect(rows(pdfMetadataGroups(FILE, details({ firstPageSize: null })))['PDF/Page size']).toBeUndefined();
    });

    it('notes forms and signatures, which the preview shows but never fills in or checks', () => {
        const result = rows(pdfMetadataGroups(FILE, details({ info: { IsAcroFormPresent: true, IsSignaturesPresent: true } })));

        expect(result['PDF/Forms']).toBe('Yes, shown as they are filled in');
        expect(result['PDF/Signatures']).toBe('Yes, not verified');
    });

    it('describes encryption, a password and restrictions', () => {
        const result = rows(pdfMetadataGroups(FILE, details({
            info: { EncryptFilterName: 'Standard' },
            needsPassword: true,
            permissions: new Set([0x04, 0x800, 0x200]),
        })));

        expect(result['Security/Encrypted']).toBe('Yes');
        expect(result['Security/Password']).toBe('Needed to open');
        expect(result['Security/Restricted']).toBe('Changing the document, copying text and images, adding comments, filling in forms, assembling pages');
        expect(rows(pdfMetadataGroups(FILE, details({ info: { EncryptFilterName: 'Adobe.PubSec' } })))['Security/Encrypted']).toBe('Yes, Adobe.PubSec');
    });
});

describe('restrictionsText', () => {
    it('is null when nothing is restricted', () => {
        expect(restrictionsText(null)).toBeNull();
        expect(restrictionsText([0x04, 0x08, 0x10, 0x20, 0x100, 0x200, 0x400, 0x800])).toBeNull();
    });

    it('names everything when nothing is allowed', () => {
        expect(restrictionsText([])).toBe('Printing, changing the document, copying text and images, adding comments, filling in forms, '
            + 'copying for accessibility, assembling pages, printing in high quality');
    });
});

describe('isTaggedMarkInfo', () => {
    it('reads the Map pdf.js gives, the object its typings describe, and no MarkInfo as untagged', () => {
        expect(isTaggedMarkInfo(new Map([['Marked', true]]))).toBe(true);
        expect(isTaggedMarkInfo(new Map([['Marked', false]]))).toBe(false);
        expect(isTaggedMarkInfo({ Marked: true })).toBe(true);
        expect(isTaggedMarkInfo(null)).toBe(false);
    });
});

describe('describePdfError', () => {
    const named = (name: string, message = ''): Error => Object.assign(new Error(message), { name });

    it('says what went wrong in words a viewer understands', () => {
        expect(describePdfError(named('InvalidPDFException', 'The PDF file is empty, i.e. its size is zero bytes.'))).toBe('The file is empty.');
        expect(describePdfError(named('InvalidPDFException', 'Invalid PDF structure.'))).toBe('The file is damaged, or it isn\'t a PDF.');
        expect(describePdfError(named('NotReadableError', 'The requested file could not be read'))).toBe('The file could not be read from disk.');
        expect(describePdfError(named('PasswordException', 'Incorrect Password'))).toBe('The password was not accepted.');
    });

    it('passes any other message on, with a fallback for none', () => {
        expect(describePdfError(new Error('Out of memory.'))).toBe('Out of memory.');
        expect(describePdfError(null)).toBe('The PDF could not be opened.');
        expect(describePdfError(named('UnknownErrorException', ' '))).toBe('The PDF could not be opened.');
    });
});

describe('pdfMetadataGroups with pdf.js reading a PDF', () => {
    it('shows what pdf.js reads from a PDF\'s Info dictionary and pages', async () => {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const data = buildTestPdf({
            pages: [[612, 792], [792, 612]],
            info: { Title: 'Quarterly report', Author: 'Nib Studio', CreationDate: "D:20240312101522+02'00'", Producer: 'Test writer' },
            isTagged: true,
            version: '1.6',
        });
        const pdf = await pdfjs.getDocument({ data, verbosity: pdfjs.VerbosityLevel.ERRORS }).promise;

        try {
            const [metadata, permissions, markInfo, firstPage] = await Promise.all([pdf.getMetadata(), pdf.getPermissions(), pdf.getMarkInfo(), pdf.getPage(1)]);
            const viewport = firstPage.getViewport({ scale: 1 });
            const result = rows(pdfMetadataGroups(FILE, {
                info: metadata.info as Record<string, unknown>,
                xmp: metadata.metadata ?? null,
                pageCount: pdf.numPages,
                firstPageSize: { width: viewport.width, height: viewport.height },
                hasMixedPageSizes: true,
                permissions,
                isTagged: isTaggedMarkInfo(markInfo),
                needsPassword: false,
            }));

            expect(result['Document/Title']).toBe('Quarterly report');
            expect(result['Document/Author']).toBe('Nib Studio');
            expect(result['History/Created']).toBe(formatLocalDateTime(new Date(Date.UTC(2024, 2, 12, 8, 15, 22))));
            expect(result['History/Producer']).toBe('Test writer');
            expect(result['PDF/Version']).toBe('1.6');
            expect(result['PDF/Pages']).toBe('2');
            expect(result['PDF/Page size']).toBe('215.9 × 279.4 mm (8.5 × 11 in), Letter; the first page, others differ');
            expect(result['PDF/Tagged']).toBe('Yes');
            expect(result['PDF/Fast web view']).toBe('No');
            expect(result['Security/Encrypted']).toBe('No');
            expect(result['Security/Restricted']).toBeUndefined();
        }
        finally {
            await pdf.loadingTask.destroy();
        }
    });

    it('reads no Info dictionary as no document details', async () => {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const pdf = await pdfjs.getDocument({ data: buildTestPdf(), verbosity: pdfjs.VerbosityLevel.ERRORS }).promise;

        try {
            const metadata = await pdf.getMetadata();
            const groups = pdfMetadataGroups(FILE, details({ info: metadata.info as Record<string, unknown>, xmp: metadata.metadata ?? null }));

            expect(groups.map((group) => group.title)).toEqual(['File', 'PDF', 'Security']);
            expect(await pdf.getMarkInfo()).toBeNull();
        }
        finally {
            await pdf.loadingTask.destroy();
        }
    });
});
