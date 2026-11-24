import { clear, h } from '../app/dom.js';
import { mountEditor, type EditorHostHandle, type EditorMode } from '../editor/editorHost.js';
import type { OpenFile } from '../app/store.js';
import { mountMarkdownPreview, type MarkdownPreviewOptions } from './markdownPreview.js';

export interface MarkdownSplitCallbacks {
    readonly onChange: (path: string, text: string) => void;
    readonly onSave: (path: string) => void;
}

// The preview half of a split, drawn from the source as it is typed.
export interface SplitPreview {
    readonly render: (text: string) => void;
    readonly refresh: (changedPaths: ReadonlyArray<string>) => void;
    readonly reveal: (fragment: string) => void;
    readonly dispose: () => void;
}

// Brings the split up to text changed elsewhere, refreshes its images and lets it go.
export interface MarkdownSplitHandle {
    readonly sync: (file: OpenFile) => void;
    readonly refresh: (changedPaths: ReadonlyArray<string>) => void;
    readonly reveal: (fragment: string) => void;
    readonly dispose: () => void;
}

// Remembers the caret and scroll position per file for the Markdown split
// editor so switching views doesn't jump to the top of the document.
const markdownEditorState = new Map<string, { head: number; scrollTop: number; textLength: number }>();

let activeMarkdownSplitHandle: EditorHostHandle | null = null;
let activeMarkdownSplitPath: string | null = null;
let activeMarkdownSplitPreview: SplitPreview | null = null;

// Draws the source and the preview side by side, under one editor bar that formats the source.
// The preview reads images from the workspace and opens workspace links as the Preview view does.
export function renderMarkdownSplit(
    container: HTMLElement,
    file: OpenFile,
    callbacks: MarkdownSplitCallbacks,
    previewOptions: Omit<MarkdownPreviewOptions, 'prefersReducedMotion'> = { documentPath: null, root: null, onOpenLink: () => {} },
): MarkdownSplitHandle {
    return renderSplitView(container, file, callbacks, 'markdown', (body, text) => {
        const article = h('article', { class: 'markdown-preview' });
        body.append(article);
        const preview = mountMarkdownPreview(article, previewOptions);
        preview.render(text);

        return {
            render: (next) => preview.render(next),
            refresh: (changedPaths) => preview.refresh(changedPaths),
            reveal: (fragment) => {
                void preview.revealAsync(fragment);
            },
            dispose: () => preview.dispose(),
        };
    });
}

// The source in an editor of the mode on the left, and the preview `mountPreview` draws into its pane on the right,
// with a divider between them; one split is on screen at a time.
export function renderSplitView(
    container: HTMLElement,
    file: OpenFile,
    callbacks: MarkdownSplitCallbacks,
    mode: EditorMode,
    mountPreview: (body: HTMLElement, text: string) => SplitPreview,
): MarkdownSplitHandle {
    disposeActiveMarkdownSplitEditor();
    clear(container);

    const barSlot = h('div', { class: 'editor-bar-slot' });
    const split = h('div', { class: 'split split-horizontal' });
    const editorPane = h('div', { class: 'split-pane' });
    const previewPane = h('div', { class: 'split-pane' });

    const editorHeader = h('div', {
        class: 'split-pane-header',
        children: [h('span', { text: 'Source' })],
    });
    const editorBody = h('div', { class: 'split-pane-body' });
    const editorHost = h('div', { class: 'editor-host' });
    editorBody.append(editorHost);
    editorPane.append(editorHeader, editorBody);

    const previewHeader = h('div', {
        class: 'split-pane-header',
        children: [h('span', { text: 'Preview' })],
    });
    const previewBody = h('div', { class: 'split-pane-body' });
    previewPane.append(previewHeader, previewBody);

    const resizer = h('div', { class: 'split-resizer split-resizer-vertical' });
    attachSplitResizer(split, resizer);
    split.append(editorPane, resizer, previewPane);
    container.append(barSlot, split);

    const preview = mountPreview(previewBody, file.text);
    activeMarkdownSplitPreview = preview;

    const remembered = markdownEditorState.get(file.path);
    const sameLength = remembered != null && remembered.textLength === file.text.length;

    activeMarkdownSplitPath = file.path;
    const handle = mountEditor(editorHost, {
        initialText: file.text,
        mode,
        initialSelection: sameLength ? remembered?.head : undefined,
        initialScrollTop: sameLength ? remembered?.scrollTop : undefined,
        onChange: (text) => {
            callbacks.onChange(file.path, text);
            preview.render(text);
        },
        onSave: () => callbacks.onSave(file.path),
        sessionKey: file.path,
        barSlot,
    });
    activeMarkdownSplitHandle = handle;

    return {
        sync: (next) => {
            if (handle.syncText(next.text)) {
                preview.render(handle.getValue());
            }
        },
        refresh: (changedPaths) => preview.refresh(changedPaths),
        reveal: (fragment) => preview.reveal(fragment),
        dispose: () => preview.dispose(),
    };
}

export function disposeActiveMarkdownSplitEditor(): void {
    if (activeMarkdownSplitHandle != null && activeMarkdownSplitPath != null) {
        try {
            markdownEditorState.set(activeMarkdownSplitPath, {
                head: activeMarkdownSplitHandle.getSelectionHead(),
                scrollTop: activeMarkdownSplitHandle.getScrollTop(),
                textLength: activeMarkdownSplitHandle.getValue().length,
            });
        }
        catch {
            // View may already be torn down; non-fatal.
        }

        activeMarkdownSplitHandle.destroy();
    }

    activeMarkdownSplitPreview?.dispose();
    activeMarkdownSplitHandle = null;
    activeMarkdownSplitPath = null;
    activeMarkdownSplitPreview = null;
}

function attachSplitResizer(split: HTMLElement, handle: HTMLElement): void {
    handle.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const rect = split.getBoundingClientRect();
        const totalWidth = rect.width;
        document.body.dataset['resizing'] = 'horizontal';

        const onMove = (move: MouseEvent): void => {
            const offset = move.clientX - rect.left;
            const ratio = Math.min(0.9, Math.max(0.1, offset / totalWidth));
            split.style.setProperty('--split-columns', `${ratio * 100}% 6px ${(1 - ratio) * 100}%`);
        };

        const onUp = (): void => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            delete document.body.dataset['resizing'];
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}
