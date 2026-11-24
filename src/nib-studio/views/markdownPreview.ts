import { titleWorkspaceLinks } from '../../common/html/linkTitles.js';
import { resolveLocalImagesAsync, type LocalImageContext } from '../../common/markdown/localImages.js';
import { renderMarkdown } from '../../common/markdown/preview.js';
import { MARKDOWN_IMAGE_PLACEHOLDER_CLASS } from '../../common/markdown/sanitizeMarkdownHtml.js';
import { createDocumentResources } from './documentImages.js';
import { findTarget, scrollToTarget } from './fragmentScroll.js';
import { attachCodeCopyHandler } from './markdownCodeCopy.js';
import { renderMermaidIntoAsync } from './mermaidBridge.js';
import { prefersReducedMotion as systemPrefersReducedMotion } from './previewZoomController.js';
import { attachWorkspaceLinks, type WorkspaceLinkTarget } from './workspaceLinks.js';

export interface MarkdownPreviewOptions {
    // The document's workspace path; null for a file from outside the workspace.
    readonly documentPath: string | null;
    // The workspace folder images are read from; null when no workspace is open.
    readonly root: FileSystemDirectoryHandle | null;
    readonly onOpenLink: (target: WorkspaceLinkTarget) => void;
    readonly prefersReducedMotion?: () => boolean;
}

export interface MarkdownPreviewHandle {
    render(source: string): void;
    // Scrolls smoothly to the heading or anchor with this id,
    // once the images and diagrams above it have their size.
    revealAsync(fragment: string): Promise<boolean>;
    // Shows the images again when files they come from changed on disk.
    refresh(changedPaths: ReadonlyArray<string>): void;
    // Revokes the image URLs.
    dispose(): void;
}

// How long a jump to a heading waits for the images and diagrams above it,
// so it lands where the heading ends up.
const REVEAL_WAIT_MS = 4000;

// Draws rendered Markdown into the element: workspace images from blob URLs, kept while shown,
// and links that open workspace files in the studio.
export function mountMarkdownPreview(article: HTMLElement, options: MarkdownPreviewOptions): MarkdownPreviewHandle {
    const resources = options.root != null && options.documentPath != null ? createDocumentResources(options.root) : null;
    const context: LocalImageContext = { documentPath: options.documentPath, resources };
    const prefersReducedMotion = options.prefersReducedMotion ?? systemPrefersReducedMotion;
    let generation = 0;
    let imagesShown: Promise<void> = Promise.resolve();
    let diagramsDrawn: Promise<unknown> = Promise.resolve();
    let isDisposed = false;

    attachCodeCopyHandler(article);
    const detachLinks = attachWorkspaceLinks(article, () => ({ documentPath: options.documentPath, onOpen: options.onOpenLink }));

    const showImages = (): void => {
        generation += 1;
        const current = generation;
        imagesShown = (async () => {
            const paths = await resolveLocalImagesAsync(article, context, { format: 'blob', placeholderClass: MARKDOWN_IMAGE_PLACEHOLDER_CLASS });

            if (current === generation && !isDisposed) {
                resources?.keepOnly(paths);
            }
        })();
    };

    return {
        render: (source) => {
            const preview = renderMarkdown(source);
            article.innerHTML = preview.html;
            titleWorkspaceLinks(article, options.documentPath);
            diagramsDrawn = Promise.all(preview.diagrams.map(async (diagram) => {
                const placeholder = article.querySelector<HTMLElement>(`[data-mermaid-id="${diagram.id}"]`);

                if (placeholder != null) {
                    await renderMermaidIntoAsync(placeholder, diagram.source, diagram.id);
                }
            }));
            showImages();
        },
        revealAsync: async (fragment) => {
            await Promise.race([Promise.all([imagesShown, diagramsDrawn]), delayAsync(REVEAL_WAIT_MS)]);
            const target = findTarget(article, fragment);

            if (target == null || isDisposed) {
                return false;
            }

            scrollToTarget(target, prefersReducedMotion);

            return true;
        },
        refresh: (changedPaths) => {
            if (resources?.forget(changedPaths) === true) {
                showImages();
            }
        },
        dispose: () => {
            isDisposed = true;
            detachLinks();
            resources?.dispose();
        },
    };
}

function delayAsync(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
