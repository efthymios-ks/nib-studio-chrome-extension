import {
    compactGroups,
    fileMetadataGroup,
    formatCount,
    metadataGroup,
    type MetadataGroup,
} from '../preview/metadataGroups.js';
import { errorMessage } from '../errorMessage.js';
import { describePdfDate } from './pdfDate.js';
import { formatPageSize } from './paperSize.js';

export const PDF_TYPE_LABEL = 'PDF document';

// What the Info panel shows of a PDF, as pdf.js reads it.
export interface PdfDetails {
    // The document information dictionary and the facts pdf.js adds to it,
    // such as PDFFormatVersion and IsLinearized.
    readonly info: Readonly<Record<string, unknown>>;
    // The XMP metadata, by lowercase name such as "dc:title"; null when there is none.
    readonly xmp: { readonly get: (name: string) => unknown } | null;
    readonly pageCount: number;
    // The first page as it shows, in points: turned by its rotation and scaled by its user unit.
    readonly firstPageSize: { readonly width: number; readonly height: number } | null;
    // Whether the pages differ in size; null until every page was measured.
    readonly hasMixedPageSizes: boolean | null;
    // What the document allows, as permission flags; null when it restricts nothing.
    readonly permissions: Iterable<number> | null;
    // Whether it is tagged for accessibility; null when unknown.
    readonly isTagged: boolean | null;
    readonly needsPassword: boolean;
}

// The actions a PDF's permission flags allow, in flag order, as the Info panel names them.
const PERMISSION_NAMES: ReadonlyArray<readonly [flag: number, name: string]> = [
    [0x04, 'printing'],
    [0x08, 'changing the document'],
    [0x10, 'copying text and images'],
    [0x20, 'adding comments'],
    [0x100, 'filling in forms'],
    [0x200, 'copying for accessibility'],
    [0x400, 'assembling pages'],
    [0x800, 'printing in high quality'],
];

// The File, Document, PDF and Security groups; rows a PDF doesn't hold are left out.
export function pdfMetadataGroups(
    file: Pick<File, 'name' | 'size' | 'lastModified'>,
    details: PdfDetails,
): MetadataGroup[] {
    const info = details.info;
    const field = (infoKey: string, xmpKey: string): string | null => cleanText(info[infoKey])
        ?? xmpText(details.xmp, xmpKey);
    const date = (infoKey: string, xmpKey: string): string | null => describePdfDate(info[infoKey])
        ?? describePdfDate(xmpText(details.xmp, xmpKey));
    const hasForms = info['IsAcroFormPresent'] === true || info['IsXFAPresent'] === true;
    const isLinearized = typeof info['IsLinearized'] === 'boolean' ? info['IsLinearized'] : null;

    return compactGroups([
        fileMetadataGroup(file, PDF_TYPE_LABEL),
        metadataGroup('Document', [
            ['Title', field('Title', 'dc:title')],
            ['Subject', field('Subject', 'dc:description')],
            ['Author', field('Author', 'dc:creator')],
            ['Keywords', field('Keywords', 'pdf:keywords') ?? xmpText(details.xmp, 'dc:subject')],
        ]),
        metadataGroup('History', [
            ['Created', date('CreationDate', 'xmp:createdate')],
            ['Modified', date('ModDate', 'xmp:modifydate')],
            ['Application', field('Creator', 'xmp:creatortool')],
            ['Producer', field('Producer', 'pdf:producer')],
        ]),
        metadataGroup('PDF', [
            ['Version', cleanText(info['PDFFormatVersion'])],
            ['Pages', formatCount(details.pageCount)],
            ['Page size', pageSizeText(details)],
            ['Tagged', yesNo(details.isTagged)],
            ['Fast web view', yesNo(isLinearized)],
            ['Language', cleanText(info['Language'])],
            ['Forms', hasForms ? 'Yes, shown as they are filled in' : null],
            ['Signatures', info['IsSignaturesPresent'] === true ? 'Yes, not verified' : null],
        ]),
        metadataGroup('Security', [
            ['Encrypted', encryptionText(info['EncryptFilterName'])],
            ['Password', details.needsPassword ? 'Needed to open' : null],
            ['Restricted', restrictionsText(details.permissions)],
        ]),
    ]);
}

function pageSizeText(details: PdfDetails): string | null {
    const size = details.firstPageSize;

    if (size == null || size.width <= 0 || size.height <= 0) {
        return null;
    }

    const text = formatPageSize(size.width, size.height);

    return details.hasMixedPageSizes === true ? `${text}; the first page, others differ` : text;
}

function yesNo(value: boolean | null): string | null {
    if (value == null) {
        return null;
    }

    return value ? 'Yes' : 'No';
}

function encryptionText(filterName: unknown): string {
    if (typeof filterName !== 'string' || filterName === '') {
        return 'No';
    }

    return filterName === 'Standard' ? 'Yes' : `Yes, ${filterName}`;
}

// Whether pdf.js's MarkInfo says the document is tagged: pdf.js 6 gives a Map, its typings an object, and
// a PDF without MarkInfo gives null, which means untagged.
export function isTaggedMarkInfo(markInfo: unknown): boolean {
    if (markInfo instanceof Map) {
        return markInfo.get('Marked') === true;
    }

    return (markInfo as { Marked?: unknown } | null)?.Marked === true;
}

// "Printing, copying text and images": what the document doesn't allow; null when it allows everything.
export function restrictionsText(permissions: Iterable<number> | null): string | null {
    if (permissions == null) {
        return null;
    }

    const allowed = new Set(permissions);
    const restricted = PERMISSION_NAMES
        .filter(([flag]) => !allowed.has(flag))
        .map(([, name]) => name);

    if (restricted.length === 0) {
        return null;
    }

    const text = restricted.join(', ');

    return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

// Text as the panel shows it: trimmed, with control characters and runs of spaces tidied;
// null when nothing is left.
function cleanText(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') {
        return null;
    }

    const text = String(value).replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim();

    return text === '' ? null : text;
}

function xmpText(xmp: PdfDetails['xmp'], name: string): string | null {
    const value = xmp?.get(name);

    if (Array.isArray(value)) {
        return cleanText(value.map((item) => cleanText(item)).filter((item) => item != null).join(', '));
    }

    return cleanText(value);
}

// What a viewer is told when a PDF can't be opened, from the error pdf.js or the file system gave.
export function describePdfError(error: unknown): string {
    const name = (error as { name?: unknown } | null)?.name;
    const message = errorMessage(error ?? '');

    if (name === 'InvalidPDFException' && /empty/i.test(message)) {
        return 'The file is empty.';
    }

    if (name === 'InvalidPDFException' || name === 'FormatError') {
        return 'The file is damaged, or it isn\'t a PDF.';
    }

    if (
        name === 'MissingPDFException'
        || name === 'NotReadableError'
        || name === 'NotFoundError'
    ) {
        return 'The file could not be read from disk.';
    }

    if (name === 'PasswordException') {
        return 'The password was not accepted.';
    }

    return message.trim() === '' ? 'The PDF could not be opened.' : message;
}
