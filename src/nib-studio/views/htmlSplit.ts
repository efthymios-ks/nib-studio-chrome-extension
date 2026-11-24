import { basename } from '../../common/fs/fileEntry.js';
import type { OpenFile } from '../app/store.js';
import { mountHtmlPreview, type HtmlPreviewOptions } from './htmlPreview.js';
import { renderSplitView, type MarkdownSplitCallbacks, type MarkdownSplitHandle } from './markdownSplit.js';

// The HTML source on the left and its sandboxed page on the right, drawn again once typing pauses,
// with the same divider and editor bar as Markdown's Split.
export function renderHtmlSplit(
    container: HTMLElement,
    file: OpenFile,
    callbacks: MarkdownSplitCallbacks,
    previewOptions: Omit<HtmlPreviewOptions, 'fileName'>,
): MarkdownSplitHandle {
    return renderSplitView(container, file, callbacks, 'html', (body, text) => {
        const preview = mountHtmlPreview(body, text, { ...previewOptions, fileName: basename(file.path) });

        return {
            render: (next) => preview.update(next),
            refresh: (changedPaths) => preview.refresh(changedPaths),
            reveal: (fragment) => preview.reveal(fragment),
            dispose: () => preview.dispose(),
        };
    });
}
