import {
    ParseSpeeds,
    PDFArray,
    PDFDict,
    PDFDocument,
    PDFHexString,
    PDFName,
    PDFRef,
    PDFString,
    type PDFContext,
    type PDFObject,
} from 'pdf-lib';
import { pageCountLabel } from './pageSelection.js';

// A PDF read for Save pages: ready to make new PDFs of its pages, or why it can't.
export type PdfPagesSource =
    | {
        readonly kind: 'ready';
        readonly pageCount: number;
        // A new PDF of the pages, numbered from 1, in the order given; a page given twice is in it twice.
        buildAsync(pages: ReadonlyArray<number>, options?: { readonly now?: Date }): Promise<Uint8Array>;
    }
    // pdf-lib writes the pages of an encrypted PDF without decrypting them,
    // so they would come out unreadable.
    | { readonly kind: 'encrypted' }
    | { readonly kind: 'damaged'; readonly reason: string };

export const PDF_PAGES_PRODUCER = 'Nib Studio';

// A link's target page stands in as this name, plus the page's index, while the pages are copied.
const PAGE_MARKER = 'NibStudioPage.';

const KEY = Object.freeze({
    action: PDFName.of('A'),
    additionalActions: PDFName.of('AA'),
    annotations: PDFName.of('Annots'),
    beads: PDFName.of('B'),
    destination: PDFName.of('Dest'),
    destinations: PDFName.of('Dests'),
    destinationOfAction: PDFName.of('D'),
    kids: PDFName.of('Kids'),
    names: PDFName.of('Names'),
    parentPage: PDFName.of('P'),
    actionType: PDFName.of('S'),
    subtype: PDFName.of('Subtype'),
});

export async function openPdfPagesSourceAsync(bytes: Uint8Array): Promise<PdfPagesSource> {
    if (bytes.length === 0) {
        return { kind: 'damaged', reason: 'The file is empty.' };
    }

    let source: PDFDocument;

    try {
        source = await PDFDocument.load(bytes, {
            ignoreEncryption: true,
            updateMetadata: false,
            parseSpeed: ParseSpeeds.Fast,
        });
    }
    catch {
        return { kind: 'damaged', reason: 'The file is damaged, or it isn\'t a PDF.' };
    }

    if (source.isEncrypted) {
        return { kind: 'encrypted' };
    }

    let pageCount: number;

    try {
        pageCount = source.getPageCount();
        prepareLinks(source);
    }
    catch {
        return { kind: 'damaged', reason: 'The PDF\'s list of pages is damaged.' };
    }

    if (pageCount === 0) {
        return { kind: 'damaged', reason: 'The PDF has no pages.' };
    }

    return {
        kind: 'ready',
        pageCount,
        buildAsync: async (pages, options) => await buildAsync(source, pages, options?.now ?? new Date()),
    };
}

async function buildAsync(source: PDFDocument, pages: ReadonlyArray<number>, now: Date): Promise<Uint8Array> {
    const pageCount = source.getPageCount();
    const outside = pages.find((page) => !Number.isInteger(page) || page < 1 || page > pageCount);

    if (outside != null) {
        throw new RangeError(`Page ${outside} isn't in the PDF, which has ${pageCountLabel(pageCount)}.`);
    }

    const target = await PDFDocument.create({ updateMetadata: false });
    const indices = pages.map((page) => page - 1);
    // One copy call shares fonts and pictures between the pages,
    // and a page given twice comes out as two pages.
    const copies = await target.copyPages(source, indices);
    const firstCopies = new Map<number, PDFRef>();

    copies.forEach((copy, position) => {
        target.addPage(copy);
        const index = indices[position] ?? -1;

        if (!firstCopies.has(index)) {
            firstCopies.set(index, copy.ref);
        }
    });

    relinkPages(target, firstCopies);
    copyDocumentInfo(source, target, now);

    return await target.save({ addDefaultPage: false, updateFieldAppearances: false });
}

// Points every link at its target page's index rather than the page itself,
// and lets go of what ties a page to
// the others,
// so copying a page never brings the pages it links to along. Article beads and page actions are left out.
function prepareLinks(source: PDFDocument): void {
    const pages = source.getPages();
    const pageIndexes = new Map(pages.map((page, index) => [page.ref.toString(), index]));
    const named = namedDestinations(source);

    for (const page of pages) {
        page.node.delete(KEY.beads);
        page.node.delete(KEY.additionalActions);

        for (const annotation of annotationsOf(page.node)) {
            annotation.delete(KEY.parentPage);
            markDestination(annotation, KEY.destination, { context: source.context, pageIndexes, named });
            const action = annotation.lookup(KEY.action);

            if (action instanceof PDFDict && isGoTo(action)) {
                markDestination(action, KEY.destinationOfAction, { context: source.context, pageIndexes, named });
            }
        }
    }
}

interface LinkContext {
    readonly context: PDFContext;
    readonly pageIndexes: ReadonlyMap<string, number>;
    readonly named: ReadonlyMap<string, PDFObject>;
}

function markDestination(holder: PDFDict, key: PDFName, links: LinkContext): void {
    const explicit = explicitDestination(holder.get(key), links);
    const page = explicit?.get(0);
    const index = page instanceof PDFRef ? links.pageIndexes.get(page.toString()) : undefined;

    if (explicit == null || index == null) {
        return;
    }

    const marked = links.context.obj([PDFName.of(`${PAGE_MARKER}${index}`)]);

    for (let position = 1; position < explicit.size(); position += 1) {
        marked.push(explicit.get(position));
    }

    holder.set(key, marked);
}

// A destination as the page and the place on it: given as such, by a name the document lists,
// or in a /D entry.
function explicitDestination(value: PDFObject | undefined, links: LinkContext): PDFArray | null {
    let destination = value instanceof PDFRef ? links.context.lookup(value) : value;

    if (destination instanceof PDFName || destination instanceof PDFString || destination instanceof PDFHexString) {
        destination = links.named.get(destination.decodeText());
    }

    if (destination instanceof PDFRef) {
        destination = links.context.lookup(destination);
    }

    if (destination instanceof PDFDict) {
        destination = destination.lookup(KEY.destinationOfAction);
    }

    return destination instanceof PDFArray ? destination : null;
}

// The document's named destinations: the catalog's Dests dictionary and the Dests name tree.
function namedDestinations(source: PDFDocument): Map<string, PDFObject> {
    const named = new Map<string, PDFObject>();
    const dictionary = source.catalog.lookup(KEY.destinations);

    if (dictionary instanceof PDFDict) {
        for (const [name, value] of dictionary.entries()) {
            named.set(name.decodeText(), value);
        }
    }

    const names = source.catalog.lookup(KEY.names);
    const tree = names instanceof PDFDict ? names.lookup(KEY.destinations) : undefined;

    if (tree instanceof PDFDict) {
        collectNameTree(tree, named, new Set());
    }

    return named;
}

function collectNameTree(node: PDFDict, into: Map<string, PDFObject>, visited: Set<PDFDict>): void {
    if (visited.has(node)) {
        return;
    }

    visited.add(node);
    const pairs = node.lookup(KEY.names);

    if (pairs instanceof PDFArray) {
        for (let index = 0; index + 1 < pairs.size(); index += 2) {
            const key = pairs.lookup(index);

            if (key instanceof PDFString || key instanceof PDFHexString) {
                into.set(key.decodeText(), pairs.get(index + 1));
            }
        }
    }

    const kids = node.lookup(KEY.kids);

    if (kids instanceof PDFArray) {
        for (let index = 0; index < kids.size(); index += 1) {
            const kid = kids.lookup(index);

            if (kid instanceof PDFDict) {
                collectNameTree(kid, into, visited);
            }
        }
    }
}

// Points each link of the new PDF at the first copy of its target page; a link to a page left out is removed.
function relinkPages(target: PDFDocument, firstCopies: ReadonlyMap<number, PDFRef>): void {
    const isKept = new Map<PDFDict, boolean>();

    for (const page of target.getPages()) {
        const annotations = page.node.lookup(KEY.annotations);

        if (!(annotations instanceof PDFArray)) {
            continue;
        }

        const kept: PDFObject[] = [];

        for (let index = 0; index < annotations.size(); index += 1) {
            const annotation = annotations.lookup(index);

            if (annotation instanceof PDFDict) {
                if (!isKept.has(annotation)) {
                    isKept.set(annotation, relinkAnnotation(annotation, firstCopies));
                }

                if (isKept.get(annotation) === false) {
                    continue;
                }
            }

            kept.push(annotations.get(index));
        }

        if (kept.length !== annotations.size()) {
            page.node.set(KEY.annotations, target.context.obj(kept));
        }
    }
}

// Whether the annotation stays: a link whose target page is left out goes, and any other annotation
// only loses the action that would go there.
function relinkAnnotation(annotation: PDFDict, firstCopies: ReadonlyMap<number, PDFRef>): boolean {
    const action = annotation.lookup(KEY.action);
    const places: Array<{ readonly holder: PDFDict; readonly key: PDFName; readonly removes: PDFName }> = [
        { holder: annotation, key: KEY.destination, removes: KEY.destination },
    ];

    if (action instanceof PDFDict && isGoTo(action)) {
        places.push({ holder: action, key: KEY.destinationOfAction, removes: KEY.action });
    }

    for (const place of places) {
        const destination = place.holder.lookup(place.key);
        const index = destination instanceof PDFArray ? markedPageIndex(destination.get(0)) : null;

        if (destination instanceof PDFArray && index != null) {
            const copy = firstCopies.get(index);

            if (copy != null) {
                destination.set(0, copy);
                continue;
            }

            if (annotation.lookup(KEY.subtype) === PDFName.of('Link')) {
                return false;
            }

            annotation.delete(place.removes);
        }
    }

    return true;
}

function markedPageIndex(value: PDFObject | undefined): number | null {
    if (!(value instanceof PDFName)) {
        return null;
    }

    const name = value.decodeText();

    return name.startsWith(PAGE_MARKER) ? Number(name.slice(PAGE_MARKER.length)) : null;
}

function annotationsOf(page: PDFDict): PDFDict[] {
    const annotations = page.lookup(KEY.annotations);

    if (!(annotations instanceof PDFArray)) {
        return [];
    }

    const found: PDFDict[] = [];

    for (let index = 0; index < annotations.size(); index += 1) {
        const annotation = annotations.lookup(index);

        if (annotation instanceof PDFDict) {
            found.push(annotation);
        }
    }

    return found;
}

function isGoTo(action: PDFDict): boolean {
    return action.lookup(KEY.actionType) === PDFName.of('GoTo');
}

// The new PDF keeps the original's title, author, subject, keywords, creating application and creation date;
// it is modified now, by Nib Studio.
function copyDocumentInfo(source: PDFDocument, target: PDFDocument, now: Date): void {
    const title = readSafely(() => source.getTitle());
    const author = readSafely(() => source.getAuthor());
    const subject = readSafely(() => source.getSubject());
    const keywords = readSafely(() => source.getKeywords());
    const creator = readSafely(() => source.getCreator());

    if (title != null) {
        target.setTitle(title);
    }

    if (author != null) {
        target.setAuthor(author);
    }

    if (subject != null) {
        target.setSubject(subject);
    }

    if (keywords != null) {
        target.setKeywords([keywords]);
    }

    if (creator != null) {
        target.setCreator(creator);
    }

    target.setProducer(PDF_PAGES_PRODUCER);
    target.setCreationDate(readSafely(() => source.getCreationDate()) ?? now);
    target.setModificationDate(now);
}

// An Info entry of the wrong type, or a date that doesn't parse, counts as missing.
function readSafely<T>(read: () => T | undefined): T | undefined {
    try {
        return read();
    }
    catch {
        return undefined;
    }
}
