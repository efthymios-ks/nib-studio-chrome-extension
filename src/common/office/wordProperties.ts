import {
    compactGroups,
    fileMetadataGroup,
    formatCount,
    formatMetadataDate,
    metadataGroup,
    type MetadataGroup,
} from '../preview/metadataGroups.js';

// The document properties a Word file can carry, from docProps in a DOCX or the OLE property sets in a .doc.
export interface WordProperties {
    readonly title?: string;
    readonly subject?: string;
    readonly author?: string;
    readonly keywords?: string;
    readonly comments?: string;
    readonly category?: string;
    readonly manager?: string;
    readonly company?: string;
    readonly lastSavedBy?: string;
    readonly revision?: string;
    readonly application?: string;
    readonly created?: Date;
    readonly modified?: Date;
    readonly pages?: number;
    readonly words?: number;
    readonly characters?: number;
    // Counted while reading a .doc, rather than recorded in its properties.
    readonly pictures?: number;
}

// The Info panel of a Word preview: the file, then what the document says about itself.
export function wordMetadataGroups(
    file: Pick<File, 'name' | 'size' | 'lastModified'>,
    typeLabel: string,
    properties: WordProperties | null,
): MetadataGroup[] {
    if (properties == null) {
        return [fileMetadataGroup(file, typeLabel)];
    }

    return compactGroups([
        fileMetadataGroup(file, typeLabel),
        metadataGroup('Document', [
            ['Title', properties.title],
            ['Subject', properties.subject],
            ['Author', properties.author],
            ['Keywords', properties.keywords],
            ['Comments', properties.comments],
            ['Category', properties.category],
            ['Manager', properties.manager],
            ['Company', properties.company],
        ]),
        metadataGroup('History', [
            ['Created', formatMetadataDate(properties.created)],
            ['Modified', formatMetadataDate(properties.modified)],
            ['Modified by', properties.lastSavedBy],
            ['Revision', properties.revision],
            ['Application', properties.application],
        ]),
        metadataGroup('Statistics', [
            ['Pages', formatCount(properties.pages)],
            ['Words', formatCount(properties.words)],
            ['Characters', formatCount(properties.characters)],
            ['Pictures', formatCount(properties.pictures)],
        ]),
    ]);
}

// Drops empty and whitespace-only text and invalid dates, so a property object holds only real values.
export function cleanProperties(raw: { readonly [key in keyof WordProperties]?: WordProperties[key] | null }): WordProperties {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'string' && value.trim() !== '') {
            result[key] = value.trim();
        }

        if (typeof value === 'number' && Number.isFinite(value)) {
            result[key] = value;
        }

        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            result[key] = value;
        }
    }

    return result as WordProperties;
}
