import { h } from '../app/dom.js';
import { mountArchivePreview } from './archivePreview.js';
import { mountDocumentPreview } from './documentView.js';
import { mountFontPreview } from './fontPreview.js';
import { mountImagePreview } from './imagePreview.js';
import { mountMediaPreview } from './mediaPreview.js';
import { BINARY_PREVIEW_MESSAGE, mountMessagePreview, officePreviewMessage } from './messagePreview.js';
import { mountPdfPreview } from './pdfPreview.js';
import type { OpenPdf } from './pdfSavePagesDialog.js';
import type { PreviewHandle } from './previewHandle.js';
import type { PreviewKind } from './viewerKinds.js';

export interface PreviewPaneInput {
    readonly kind: PreviewKind;
    readonly file: File | null;
    readonly fileName: string;
    // Keys the remembered zoom and scroll: the tab's path.
    readonly memoryKey: string;
    // Save pages… of a PDF, given the document the preview has open.
    readonly onSavePdfPages?: (open: OpenPdf) => void;
}

// Mounts the preview for a file into the pane; the handle keeps it until the tab or the file changes.
export function mountPreview(pane: HTMLElement, input: PreviewPaneInput): PreviewHandle {
    if (input.file == null) {
        return mountUnreadable(pane);
    }

    if (input.kind === 'image') {
        return mountImagePreview(pane, { file: input.file, fileName: input.fileName, memoryKey: input.memoryKey });
    }

    if (input.kind === 'font') {
        return mountFontPreview(pane, { file: input.file, fileName: input.fileName, memoryKey: input.memoryKey });
    }

    if (input.kind === 'pdf') {
        return mountPdfPreview(pane, {
            file: input.file,
            fileName: input.fileName,
            memoryKey: input.memoryKey,
            onSavePages: input.onSavePdfPages,
        });
    }

    if (input.kind === 'document') {
        return mountDocumentPreview(pane, { file: input.file, fileName: input.fileName, memoryKey: input.memoryKey });
    }

    if (input.kind === 'archive') {
        return mountArchivePreview(pane, { file: input.file, fileName: input.fileName, memoryKey: input.memoryKey });
    }

    if (input.kind === 'office' || input.kind === 'binary') {
        const message = input.kind === 'office' ? officePreviewMessage(input.fileName) : BINARY_PREVIEW_MESSAGE;

        return mountMessagePreview(pane, { file: input.file, fileName: input.fileName, memoryKey: input.memoryKey, message });
    }

    return mountMediaPreview(pane, { file: input.file, fileName: input.fileName, memoryKey: input.memoryKey, kind: input.kind });
}

function mountUnreadable(pane: HTMLElement): PreviewHandle {
    const element = h('div', {
        class: 'editor-placeholder',
        children: [
            h('h2', { text: 'Preview not available' }),
            h('p', { text: 'The file could not be read.' }),
        ],
    });
    pane.append(element);

    return { element, update: () => {}, destroy: () => {} };
}
