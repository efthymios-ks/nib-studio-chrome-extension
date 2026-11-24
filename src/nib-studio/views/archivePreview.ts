import { archiveTypeLabel } from '../../common/preview/archiveFormat.js';
import { mountMessagePreview } from './messagePreview.js';
import type { PreviewHandle } from './previewHandle.js';

export interface ArchivePreviewOptions {
    readonly file: File;
    readonly fileName: string;
    readonly memoryKey: string;
}

const NO_PREVIEW_TITLE = 'This archive has no preview';
const NO_PREVIEW_MESSAGE = 'Its contents aren\'t listed here. Open it with an archive tool, such as File Explorer or 7-Zip.';

// An archive shows a message saying where to open it, and its File group in Info, naming its format.
// Its bytes are never read. There is no zoom; the toolbar holds only Info.
export function mountArchivePreview(host: HTMLElement, options: ArchivePreviewOptions): PreviewHandle {
    return mountMessagePreview(host, {
        ...options,
        message: {
            badge: 'Archive',
            typeLabel: archiveTypeLabel(options.fileName),
            title: NO_PREVIEW_TITLE,
            message: NO_PREVIEW_MESSAGE,
        },
    });
}
