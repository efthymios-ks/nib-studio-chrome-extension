import { drawDocumentDiagramsAsync, type DiagramElements, type DrawDiagramAsync } from '../markdown/documentDiagrams.js';
import {
    embedLocalImagesAsync,
    imageSourceKind,
    LOCAL_SOURCE_ATTRIBUTE,
    type LocalImageContext,
} from '../markdown/localImages.js';
import { renderMarkdown } from '../markdown/preview.js';
import { MARKDOWN_IMAGE_PLACEHOLDER_CLASS } from '../markdown/sanitizeMarkdownHtml.js';
import { documentRichText, sanitizeClipboardHtml, type RichText } from './clipboardHtml.js';

// A copied document takes at most this many bytes of pictures in all; a picture past it becomes a placeholder.
export const COPY_IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;

export interface DocumentCopyContext extends LocalImageContext {
    // Draws a Mermaid diagram as a picture; without it, or when it fails, the diagram's source goes in as a code block.
    readonly drawDiagramAsync?: DrawDiagramAsync;
}

// Diagrams as they paste into an editor: the picture in a paragraph, or the source as a code block.
const CLIPBOARD_DIAGRAM_ELEMENTS: DiagramElements = Object.freeze({
    drawn: (picture: HTMLImageElement) => {
        const paragraph = document.createElement('p');
        paragraph.append(picture);

        return paragraph;
    },
    failed: (source: string) => {
        const block = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = source;
        block.append(code);

        return block;
    },
});

// Markdown rendered as the preview renders it, for the clipboard: workspace pictures inside it as data: URLs,
// web pictures by their address, Mermaid diagrams as pictures, and no copy buttons on its code blocks.
export async function markdownRichTextAsync(text: string, context: DocumentCopyContext): Promise<RichText> {
    const rendered = renderMarkdown(text, { remoteImages: 'keep' });
    const html = await embedLocalImagesAsync(rendered.html, context, {
        placeholderClass: MARKDOWN_IMAGE_PLACEHOLDER_CLASS,
        maxEmbeddedBytes: COPY_IMAGE_LIMIT_BYTES,
    });
    const drawn = await drawDocumentDiagramsAsync(html, {
        diagrams: rendered.diagrams,
        drawDiagramAsync: context.drawDiagramAsync,
        elements: CLIPBOARD_DIAGRAM_ELEMENTS,
    });

    return documentRichText(drawn);
}

// An HTML page as written, for the clipboard: its body without scripts, style sheets, frames or forms,
// workspace pictures inside it as data: URLs and web pictures by their address.
// What its scripts would draw isn't in it, since they never run here.
export async function htmlPageRichTextAsync(text: string, context: LocalImageContext): Promise<RichText> {
    // A parsed document is inert: nothing in it runs or loads.
    const page = new DOMParser().parseFromString(text, 'text/html');
    const template = document.createElement('template');
    template.innerHTML = sanitizeClipboardHtml(page.body?.innerHTML ?? '');
    holdLocalImages(template.content);
    const html = await embedLocalImagesAsync(template.innerHTML, context, {
        placeholderClass: MARKDOWN_IMAGE_PLACEHOLDER_CLASS,
        maxEmbeddedBytes: COPY_IMAGE_LIMIT_BYTES,
    });

    return documentRichText(html);
}

// Pictures read from the workspace wait in `data-local-src` until they are read in, as the preview's do;
// a picture's `srcset` and a `<picture>`'s sources go, so each shows its `src`.
function holdLocalImages(root: ParentNode): void {
    for (const image of [...root.querySelectorAll('img')]) {
        const source = image.getAttribute('src') ?? '';
        image.removeAttribute('srcset');

        if (imageSourceKind(source) === 'local') {
            image.removeAttribute('src');
            image.setAttribute(LOCAL_SOURCE_ATTRIBUTE, source);
        }
    }

    for (const source of [...root.querySelectorAll('picture > source')]) {
        source.remove();
    }
}
