import type { MarkdownDiffDocument } from '../../common/diff/diffDocument.js';
import { renderDiffDocumentHtmlAsync } from '../../common/diff/diffHtml.js';
import { buildMarkdownDiffDocument } from '../../common/diff/markdownDiffDocument.js';
import { clear, h } from '../app/dom.js';
import { toast } from '../app/toast.js';
import { errorMessage } from '../../common/errorMessage.js';
import { buildDiffSidesBar, diffDocumentSide, type DiffSideName } from './diffSideHeader.js';
import { buildDiffToolbarSides } from './diffToolbar.js';
import type { DiffViewInput, MarkdownDiffViewState } from './diffViewState.js';
import { attachMarkdownDiffControls } from './markdownDiffControls.js';
import { renderMermaidSvgAsync } from './mermaidBridge.js';

export type MarkdownDiffViewInput = DiffViewInput<MarkdownDiffViewState>;

export type MarkdownDiffDocumentSource = Pick<MarkdownDiffViewInput, 'original' | 'modified' | 'state'>;

const VIEWS: ReadonlyArray<MarkdownDiffViewState['view']> = ['diff', 'before', 'after'];

export function renderMarkdownDiffView(container: HTMLElement, input: MarkdownDiffViewInput): void {
    clear(container);

    const { original, modified, callbacks } = input;
    container.append(
        h('div', { class: 'editor-toolbar', children: buildDiffToolbarSides(input) }),
        buildDiffSidesBar(original, modified),
    );

    const empty: DiffSideName | null = original == null ? 'original' : modified == null ? 'modified' : null;

    if (empty != null) {
        if (callbacks.targetDropZone != null) {
            container.append(callbacks.targetDropZone((target) => callbacks.onSetSide(empty, target)));
        }

        return;
    }

    // No `allow-scripts`: the diff page's own scripts stay off and the parent drives
    // its controls through `allow-same-origin`.
    const frame = h('iframe', {
        class: 'markdown-diff-frame',
        attrs: {
            title: 'Markdown diff',
            sandbox: 'allow-same-origin',
        },
    }) as HTMLIFrameElement;
    container.append(frame);

    frame.addEventListener('load', () => {
        const frameDocument = frame.contentDocument;
        const frameWindow = frame.contentWindow;

        if (frameDocument == null || frameDocument.querySelector('.md-bar') == null) {
            return;
        }

        attachMarkdownDiffControls(frameDocument, {
            initialView: input.state.view,
            onViewChange: (view) => {
                input.state.view = VIEWS.includes(view as MarkdownDiffViewState['view']) ? view as MarkdownDiffViewState['view'] : 'diff';
            },
        });

        if (frameWindow != null) {
            frameWindow.scrollTo(0, input.state.scrollY);
            frameWindow.addEventListener('scroll', () => {
                input.state.scrollY = frameWindow.scrollY;
            }, { passive: true });
        }
    });

    void showHtmlAsync(frame, input);
}

async function showHtmlAsync(frame: HTMLIFrameElement, input: MarkdownDiffViewInput): Promise<void> {
    const html = await loadHtmlAsync(input);

    if (html != null && frame.isConnected) {
        frame.srcdoc = html;
    }
}

// The diff document of both texts: the one the page was drawn from while the texts are the same, or a new one.
export function markdownDiffDocumentFor(input: MarkdownDiffDocumentSource): MarkdownDiffDocument | null {
    if (input.original == null || input.modified == null) {
        return null;
    }

    const originalText = input.original.text ?? '';
    const modifiedText = input.modified.text ?? '';
    const cache = input.state.cache;

    if (cache != null && cache.original === originalText && cache.modified === modifiedText) {
        return cache.document;
    }

    return buildMarkdownDiffDocument({
        original: diffDocumentSide(input.original),
        modified: diffDocumentSide(input.modified),
        originalText,
        modifiedText,
    });
}

// Draws a Mermaid diagram of the diff page as an image, offline.
export async function renderDiffMermaidAsync(source: string): Promise<string | null> {
    return await renderMermaidSvgAsync(source, `diff-${Math.random().toString(36).slice(2, 8)}`);
}

// Builds the diff page once per pair of texts; coming back to the tab reuses it.
async function loadHtmlAsync(input: MarkdownDiffViewInput): Promise<string | null> {
    const originalText = input.original?.text ?? '';
    const modifiedText = input.modified?.text ?? '';
    const cache = input.state.cache;

    if (cache != null && cache.original === originalText && cache.modified === modifiedText) {
        return cache.html;
    }

    toast('Building diff…', 'info');

    try {
        const document = markdownDiffDocumentFor(input);

        if (document == null) {
            return null;
        }

        const html = await renderDiffDocumentHtmlAsync(document, { renderMermaid: renderDiffMermaidAsync });
        input.state.cache = { original: originalText, modified: modifiedText, html, document };

        return html;
    }
    catch (error) {
        toast(errorMessage(error, 'Diff failed.'), 'fail');

        return null;
    }
}
