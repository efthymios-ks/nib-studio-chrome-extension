import { buildHtmlPreviewAsync } from '../../common/html/htmlPreviewDocument.js';
import type { LocalImageContext } from '../../common/markdown/localImages.js';
import { h } from '../app/dom.js';
import { registerSaveShortcutGuard } from '../app/saveShortcut.js';
import { createDocumentResources } from './documentImages.js';
import { findTarget, scrollToTarget } from './fragmentScroll.js';
import { prefersReducedMotion as systemPrefersReducedMotion } from './previewZoomController.js';
import {
    attachWorkspaceLinks,
    closestLink,
    linkActionFor,
    MIDDLE_BUTTON,
    openInNewTab,
    type WorkspaceLinkOptions,
    type WorkspaceLinkTarget,
} from './workspaceLinks.js';

export interface HtmlPreviewOptions {
    readonly fileName: string;
    // The document's workspace path; null for a file from outside the workspace.
    readonly documentPath: string | null;
    // The workspace folder style sheets and images are read from; null when no workspace is open.
    readonly root: FileSystemDirectoryHandle | null;
    // A style sheet open in a tab with unsaved edits is drawn from that tab's text, by its workspace path.
    readonly unsavedText?: (path: string) => string | null;
    readonly onOpenLink: (target: WorkspaceLinkTarget) => void;
    // Ctrl+S in the page saves, as it does elsewhere in the studio, instead of opening the browser's Save as.
    readonly onSave?: () => void;
    readonly prefersReducedMotion?: () => boolean;
    // How long the preview waits after the last edit before drawing the page again.
    readonly delayMs?: number;
}

export interface HtmlPreviewHandle {
    readonly frame: HTMLIFrameElement;
    // Draws the page again from new text, once the edits pause.
    update(text: string): void;
    // Scrolls smoothly to the element with this id or name.
    reveal(fragment: string): void;
    // Draws the page again when a style sheet or image it uses changed on disk.
    refresh(changedPaths: ReadonlyArray<string>): void;
    dispose(): void;
}

const UPDATE_DELAY_MS = 300;

// Shows an HTML file as a page in a sandboxed frame: sanitized, with no scripts (the frame allows none),
// its own
// styles kept apart from the studio's, and its style sheets and images read from the workspace.
// The frame can't run a script, so the studio handles its link clicks from outside,
// through `allow-same-origin`.
export function mountHtmlPreview(pane: HTMLElement, text: string, options: HtmlPreviewOptions): HtmlPreviewHandle {
    const frame = h('iframe', {
        class: 'html-preview-frame',
        attrs: { title: `Preview of ${options.fileName}`, sandbox: 'allow-same-origin' },
    }) as HTMLIFrameElement;
    pane.append(frame);

    const resources = options.root != null && options.documentPath != null
        ? createDocumentResources(options.root, { unsavedText: options.unsavedText })
        : null;
    const context: LocalImageContext = { documentPath: options.documentPath, resources };
    const prefersReducedMotion = options.prefersReducedMotion ?? systemPrefersReducedMotion;
    let current = text;
    let generation = 0;
    let timer: number | null = null;
    let pendingFragment: string | null = null;
    let scroll = { left: 0, top: 0 };
    let detachFrame: (() => void) | null = null;
    let isDisposed = false;

    const scrollToFragment = (fragment: string): boolean => {
        const frameDocument = frame.contentDocument;
        const target = frameDocument?.body == null ? null : findTarget(frameDocument, fragment);

        if (target != null) {
            scrollToTarget(target, prefersReducedMotion);
        }

        return target != null;
    };

    frame.addEventListener('load', () => {
        const frameDocument = frame.contentDocument;
        detachFrame?.();
        detachFrame = null;

        if (frameDocument == null || isDisposed) {
            return;
        }

        detachFrame = attachToFrame(frameDocument, {
            documentPath: options.documentPath,
            onOpen: options.onOpenLink,
            onFragment: (fragment) => {
                scrollToFragment(fragment);
            },
        }, options.onSave);
        frame.contentWindow?.scrollTo(scroll.left, scroll.top);

        // A fragment the page doesn't have is dropped, so a later edit that adds it doesn't jump there.
        if (pendingFragment != null) {
            scrollToFragment(pendingFragment);
            pendingFragment = null;
        }
    });

    const renderAsync = async (): Promise<void> => {
        generation += 1;
        const run = generation;
        const built = await buildHtmlPreviewAsync(current, context);

        if (run !== generation || isDisposed) {
            return;
        }

        const frameWindow = frame.contentWindow;
        scroll = frameWindow == null ? scroll : { left: frameWindow.scrollX, top: frameWindow.scrollY };
        frame.srcdoc = built.html;
        resources?.keepOnly(built.paths);
    };

    const schedule = (): void => {
        if (timer != null) {
            window.clearTimeout(timer);
        }

        timer = window.setTimeout(() => {
            timer = null;
            void renderAsync();
        }, options.delayMs ?? UPDATE_DELAY_MS);
    };

    void renderAsync();

    return {
        frame,
        update: (next) => {
            if (next === current) {
                return;
            }

            current = next;
            schedule();
        },
        reveal: (fragment) => {
            if (!scrollToFragment(fragment)) {
                pendingFragment = fragment;
            }
        },
        refresh: (changedPaths) => {
            // The resources know every path the page asked for, found or not.
            if (resources?.forget(changedPaths) === true) {
                schedule();
            }
        },
        dispose: () => {
            isDisposed = true;

            if (timer != null) {
                window.clearTimeout(timer);
            }

            detachFrame?.();
            resources?.dispose();
        },
    };
}

// Links, middle clicks, Ctrl+S and dropped files in the page; the page's elements belong to the frame,
// so nothing here checks them with `instanceof`. Returns the function that lets go.
export function attachToFrame(
    frameDocument: Document,
    linkOptions: WorkspaceLinkOptions,
    onSave?: () => void,
): () => void {
    const detachLinks = attachWorkspaceLinks(frameDocument, () => linkOptions);
    // A middle click on any link would ask for a new window, which the sandbox refuses with an error,
    // so one on a web link opens its new tab from the studio, as a middle click in the Markdown preview does.
    const onAuxClick = (event: Event): void => {
        const pointer = event as MouseEvent;
        const link = closestLink(pointer.target);

        if (link == null) {
            return;
        }

        event.preventDefault();
        const href = link.getAttribute('href') ?? '';

        if (pointer.button === MIDDLE_BUTTON && linkActionFor(href, linkOptions.documentPath).kind === 'follow') {
            (linkOptions.onFollow ?? openInNewTab)(href);
        }
    };
    // A file dropped on the page would replace it.
    const onDrag = (event: Event): void => event.preventDefault();
    const removeSaveGuard = registerSaveShortcutGuard(frameDocument, onSave);
    frameDocument.addEventListener('auxclick', onAuxClick);
    frameDocument.addEventListener('dragover', onDrag);
    frameDocument.addEventListener('drop', onDrag);

    return () => {
        detachLinks();
        removeSaveGuard();
        frameDocument.removeEventListener('auxclick', onAuxClick);
        frameDocument.removeEventListener('dragover', onDrag);
        frameDocument.removeEventListener('drop', onDrag);
    };
}
