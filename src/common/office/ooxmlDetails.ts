import { parseXml, type XmlNode } from '../paths/xmlParser.js';
import { TWIPS_PER_PIXEL, type PageGeometry } from './pageGeometry.js';
import { cleanProperties, type WordProperties } from './wordProperties.js';
import type { ZipPackage } from './zipPackage.js';

export interface ImageSize {
    readonly width: number;
    readonly height: number;
}

type OfficePackageKind = 'word' | 'excel' | 'powerpoint' | 'other';

interface OoxmlDetails {
    readonly kind: OfficePackageKind;
    readonly properties: WordProperties;
    readonly page: PageGeometry | null;
    // The size each picture is shown at in the document, keyed by its file's length in bytes and in document order.
    readonly imageSizes: ReadonlyMap<number, ReadonlyArray<ImageSize>>;
}

const OFFICE_DOCUMENT_RELATIONSHIP = /\/officeDocument$/;
const EMU_PER_PIXEL = 9525;
const CSS_PIXELS_PER_UNIT: Readonly<Record<string, number>> = Object.freeze({
    pt: 96 / 72,
    in: 96,
    cm: 96 / 2.54,
    mm: 96 / 25.4,
    px: 1,
});

// What a DOCX package says about itself and its layout, read straight from its parts.
export function readOoxmlDetails(zip: ZipPackage): OoxmlDetails {
    const mainPart = findMainPart(zip);
    const kind = packageKind(mainPart);
    const properties = cleanProperties({
        ...readCoreProperties(zip.readText('docProps/core.xml')),
        ...readAppProperties(zip.readText('docProps/app.xml')),
    });

    if (kind !== 'word' || mainPart == null) {
        return { kind, properties, page: null, imageSizes: new Map() };
    }

    const documentXml = zip.readText(mainPart) ?? '';
    const relationships = readRelationships(zip.readText(relationshipsPartOf(mainPart)));

    return {
        kind,
        properties,
        page: readPageGeometry(documentXml),
        imageSizes: readImageSizes(documentXml, (id) => {
            const target = relationships.get(id);

            return target == null ? null : zip.entries.get(resolvePartPath(mainPart, target))?.size ?? null;
        }),
    };
}

function findMainPart(zip: ZipPackage): string | null {
    const root = parseXml(zip.readText('_rels/.rels') ?? '');

    if (root.ok) {
        const main = root.root.children.find((child) => OFFICE_DOCUMENT_RELATIONSHIP.test(child.attributes['Type'] ?? ''));
        const target = main?.attributes['Target'];

        if (target != null) {
            return resolvePartPath('', target);
        }
    }

    return zip.entries.has('word/document.xml') ? 'word/document.xml' : null;
}

function packageKind(mainPart: string | null): OfficePackageKind {
    if (mainPart == null) {
        return 'other';
    }

    if (mainPart.startsWith('word/')) {
        return 'word';
    }

    if (mainPart.startsWith('xl/')) {
        return 'excel';
    }

    return mainPart.startsWith('ppt/') ? 'powerpoint' : 'other';
}

function relationshipsPartOf(part: string): string {
    const slash = part.lastIndexOf('/');

    return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

// A relationship target resolved against the folder of the part that names it, as a path inside the package.
export function resolvePartPath(fromPart: string, target: string): string {
    const base = target.startsWith('/') ? [] : fromPart.split('/').slice(0, -1);
    const segments = [...base];

    for (const segment of target.replace(/^\//, '').split('/')) {
        if (segment === '..') {
            segments.pop();
        }
        else if (segment !== '.' && segment !== '') {
            segments.push(segment);
        }
    }

    return segments.join('/');
}

function readRelationships(xml: string | null): Map<string, string> {
    const relationships = new Map<string, string>();
    const parsed = parseXml(xml ?? '');

    if (!parsed.ok) {
        return relationships;
    }

    for (const child of parsed.root.children) {
        const id = child.attributes['Id'];
        const target = child.attributes['Target'];

        if (id != null && target != null && child.attributes['TargetMode'] !== 'External') {
            relationships.set(id, target);
        }
    }

    return relationships;
}

function localName(node: XmlNode): string {
    return node.name.slice(node.name.indexOf(':') + 1);
}

function childTexts(xml: string | null): Map<string, string> {
    const texts = new Map<string, string>();
    const parsed = parseXml(xml ?? '');

    if (!parsed.ok) {
        return texts;
    }

    for (const child of parsed.root.children) {
        texts.set(localName(child), child.text.trim());
    }

    return texts;
}

function readCoreProperties(xml: string | null): WordProperties {
    const texts = childTexts(xml);

    return cleanProperties({
        title: texts.get('title'),
        subject: texts.get('subject'),
        author: texts.get('creator'),
        keywords: texts.get('keywords'),
        comments: texts.get('description'),
        category: texts.get('category'),
        lastSavedBy: texts.get('lastModifiedBy'),
        revision: texts.get('revision'),
        created: parseDate(texts.get('created')),
        modified: parseDate(texts.get('modified')),
    });
}

function readAppProperties(xml: string | null): WordProperties {
    const texts = childTexts(xml);

    return cleanProperties({
        application: texts.get('Application'),
        company: texts.get('Company'),
        manager: texts.get('Manager'),
        pages: parseCount(texts.get('Pages')),
        words: parseCount(texts.get('Words')),
        characters: parseCount(texts.get('Characters')),
    });
}

function parseDate(text: string | undefined): Date | undefined {
    if (text == null || text === '') {
        return undefined;
    }

    const date = new Date(text);

    return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseCount(text: string | undefined): number | undefined {
    return text == null || !/^\d+$/.test(text) ? undefined : Number(text);
}

function attributeNumber(attributes: string, name: string): number | null {
    const match = new RegExp(`(?:^|\\s)(?:\\w+:)?${name}="(-?\\d+)"`).exec(attributes);

    return match == null ? null : Number(match[1]);
}

// The page of the document's last section, which the body's own section properties describe.
export function readPageGeometry(documentXml: string): PageGeometry | null {
    const size = lastTagAttributes(documentXml, 'pgSz');
    const width = size == null ? null : attributeNumber(size, 'w');

    if (width == null || width <= 0) {
        return null;
    }

    const margins = lastTagAttributes(documentXml, 'pgMar') ?? '';
    const margin = (name: string): number => Math.max(0, attributeNumber(margins, name) ?? 1440) / TWIPS_PER_PIXEL;

    return {
        width: width / TWIPS_PER_PIXEL,
        height: (attributeNumber(size ?? '', 'h') ?? width * 1.294) / TWIPS_PER_PIXEL,
        marginTop: margin('top'),
        marginRight: margin('right'),
        marginBottom: margin('bottom'),
        marginLeft: margin('left'),
    };
}

function lastTagAttributes(xml: string, name: string): string | null {
    const pattern = new RegExp(`<(?:\\w+:)?${name}\\b([^>]*)>`, 'g');
    const last = [...xml.matchAll(pattern)].at(-1);

    return last == null ? null : last[1] ?? '';
}

// DrawingML pictures carry their size in EMU on wp:extent; VML pictures in the shape's style.
export function readImageSizes(
    documentXml: string,
    sizeOfTarget: (relationshipId: string) => number | null,
): Map<number, ImageSize[]> {
    const sizes = new Map<number, ImageSize[]>();
    const add = (relationshipId: string, size: ImageSize | null): void => {
        const bytes = sizeOfTarget(relationshipId);

        if (bytes == null || size == null || size.width <= 0 || size.height <= 0) {
            return;
        }

        const queue = sizes.get(bytes) ?? [];
        queue.push(size);
        sizes.set(bytes, queue);
    };

    for (const match of documentXml.matchAll(/<(\w+):(inline|anchor)\b[\s\S]*?<\/\1:\2>/g)) {
        const block = match[0];
        const extent = /<(?:\w+:)?extent\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(block);
        const size = extent == null ? null : { width: Number(extent[1]) / EMU_PER_PIXEL, height: Number(extent[2]) / EMU_PER_PIXEL };

        for (const blip of block.matchAll(/<(?:\w+:)?blip\b[^>]*\bembed="([^"]+)"/g)) {
            add(blip[1] ?? '', size);
        }
    }

    for (const match of documentXml.matchAll(/<(?:\w+:)?shape\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?shape>/g)) {
        const style = /\bstyle="([^"]*)"/.exec(match[1] ?? '')?.[1] ?? '';
        const imageData = /<(?:\w+:)?imagedata\b[^>]*\b(?:r:)?id="([^"]+)"/.exec(match[2] ?? '');

        if (imageData != null) {
            add(imageData[1] ?? '', vmlSize(style));
        }
    }

    return sizes;
}

function vmlSize(style: string): ImageSize | null {
    const length = (name: string): number | null => {
        const match = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([\\d.]+)\\s*(pt|in|cm|mm|px)?`).exec(style);

        return match == null ? null : Number(match[1]) * (CSS_PIXELS_PER_UNIT[match[2] ?? 'px'] ?? 1);
    };
    const width = length('width');
    const height = length('height');

    return width == null || height == null ? null : { width, height };
}
