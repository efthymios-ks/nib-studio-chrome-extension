import {
    diffExportFileName,
    serializeDiffDocument,
    type DiffDocument,
    type DiffExportExtension,
} from '../../common/diff/diffDocument.js';
import { renderDiffDocumentHtmlAsync } from '../../common/diff/diffHtml.js';
import { downloadFile } from '../../common/export/htmlExport.js';
import type { DiffKind, DiffTab } from '../app/store.js';
import { currentJsonDiffDocument, YAML_DIFF_FORMAT } from './jsonDiffView.js';
import { markdownDiffDocumentFor, renderDiffMermaidAsync } from './markdownDiffView.js';
import { rowDiffDocumentForAsync } from './rowDiffView.js';
import { currentTextDiffDocument } from './textDiffView.js';
import { currentXmlDiffDocument } from './xmlDiffView.js';

// Export JSON and Export HTML of a diff tab: its diff document as it stands, saved as a download only when asked.

export type DiffExportFormat = DiffExportExtension;

interface ExportFormat {
    readonly type: string;
    readonly contentAsync: (document: DiffDocument) => Promise<string>;
}

const FORMATS: Readonly<Record<DiffExportFormat, ExportFormat>> = Object.freeze({
    json: {
        type: 'application/json;charset=utf-8',
        contentAsync: async (document: DiffDocument) => serializeDiffDocument(document),
    },
    html: {
        type: 'text/html;charset=utf-8',
        contentAsync: async (document: DiffDocument) => await renderDiffDocumentHtmlAsync(document, { renderMermaid: renderDiffMermaidAsync }),
    },
});

// Each kind reads its document from the tab's own state, so an export matches the diff on screen, rules and all.
const DOCUMENT_SOURCES: Readonly<Record<DiffKind, (tab: DiffTab) => Promise<DiffDocument | null>>> = Object.freeze({
    text: async (tab: DiffTab) => currentTextDiffDocument({ original: tab.original, modified: tab.modified, state: tab.state.text }),
    json: async (tab: DiffTab) => currentJsonDiffDocument({ original: tab.original, modified: tab.modified, state: tab.state.json }),
    yaml: async (tab: DiffTab) => currentJsonDiffDocument({
        original: tab.original,
        modified: tab.modified,
        state: tab.state.yaml,
        format: YAML_DIFF_FORMAT,
    }),
    xml: async (tab: DiffTab) => currentXmlDiffDocument({ original: tab.original, modified: tab.modified, state: tab.state.xml }),
    markdown: async (tab: DiffTab) => markdownDiffDocumentFor({ original: tab.original, modified: tab.modified, state: tab.state.markdown }),
    rows: async (tab: DiffTab) => await rowDiffDocumentForAsync({ original: tab.original, modified: tab.modified, state: tab.state.rows }),
});

// Both sides are chosen, so there can be something to export.
export function canExportDiffTab(tab: DiffTab | undefined): boolean {
    return tab?.original != null && tab.modified != null;
}

// The tab's diff document, or null while it has none, such as with a side missing or not valid for the kind.
export async function diffDocumentForTabAsync(tab: DiffTab): Promise<DiffDocument | null> {
    return await DOCUMENT_SOURCES[tab.diffKind](tab);
}

// Downloads the tab's diff as `<original>-vs-<modified>.diff.json` or `.diff.html`; the file name, or null with nothing to export.
export async function exportDiffTabAsync(tab: DiffTab, format: DiffExportFormat): Promise<string | null> {
    const document = await diffDocumentForTabAsync(tab);

    if (document == null) {
        return null;
    }

    const fileName = diffExportFileName(document, format);
    downloadFile(fileName, await FORMATS[format].contentAsync(document), FORMATS[format].type);

    return fileName;
}
