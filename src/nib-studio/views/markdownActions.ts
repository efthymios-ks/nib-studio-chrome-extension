import { basename } from '../../common/fs/fileEntry.js';
import { buildStandaloneHtml, downloadHtml } from '../../common/export/htmlExport.js';
import { printToPdfAsync } from '../../common/export/pdfExport.js';
import { embedLocalImagesAsync } from '../../common/markdown/localImages.js';
import { renderMarkdown, type MarkdownRenderOptions } from '../../common/markdown/preview.js';
import { MARKDOWN_IMAGE_PLACEHOLDER_CLASS } from '../../common/markdown/sanitizeMarkdownHtml.js';
import { isExternalPath, type OpenFile } from '../app/store.js';
import { toast } from '../app/toast.js';
import { createDocumentResources } from './documentImages.js';

// An exported page takes at most this many bytes of workspace images; an image past it becomes a placeholder.
export const EXPORT_IMAGE_LIMIT_BYTES = 25 * 1024 * 1024;

// Renders the active Markdown file to a standalone HTML document and triggers a download.
// The page works offline: workspace images travel inside it as data: URLs.
export async function exportMarkdownToHtmlAsync(file: OpenFile, root: FileSystemDirectoryHandle | null): Promise<void> {
    // The exported file leaves the extension, so web images keep their address.
    const bodyHtml = await renderWithImagesAsync(file, root, { remoteImages: 'keep' }, EXPORT_IMAGE_LIMIT_BYTES);
    const html = buildStandaloneHtml({
        title: basename(file.path),
        bodyHtml,
    });
    downloadHtml(`${basename(file.path)}.html`, html);
    toast('HTML downloaded.', 'ok');
}

// Prints the active Markdown file to a PDF using the shared print pipeline, once its images have loaded.
export async function exportMarkdownToPdfAsync(file: OpenFile, root: FileSystemDirectoryHandle | null): Promise<void> {
    const bodyHtml = await renderWithImagesAsync(file, root, {});
    await printToPdfAsync({
        title: basename(file.path),
        bodyHtml,
    });
}

async function renderWithImagesAsync(
    file: OpenFile,
    root: FileSystemDirectoryHandle | null,
    options: MarkdownRenderOptions,
    maxEmbeddedBytes?: number,
): Promise<string> {
    const documentPath = isExternalPath(file.path) ? null : file.path;
    const resources = root == null || documentPath == null ? null : createDocumentResources(root);
    const html = renderMarkdown(file.text, options).html;

    try {
        return await embedLocalImagesAsync(html, { documentPath, resources }, { placeholderClass: MARKDOWN_IMAGE_PLACEHOLDER_CLASS, maxEmbeddedBytes });
    }
    finally {
        resources?.dispose();
    }
}
