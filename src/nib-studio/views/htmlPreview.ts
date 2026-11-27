import { errorMessage } from '../../common/errorMessage.js';
import { buildHtmlPreviewAsync } from '../../common/html/htmlPreviewDocument.js';
import {
    PAGE_COPY_NEEDS_GESTURE,
    readSandboxMessage,
    SANDBOX_CHANNEL,
    type PageClipboardContent,
    type SandboxMessage,
    type ScrollPosition,
    type StudioMessage,
} from '../../common/html/sandboxMessages.js';
import type { LocalImageContext } from '../../common/markdown/localImages.js';
import { copyFailureMessage, copyTypesAsync } from '../app/clipboard.js';
import { h } from '../app/dom.js';
import { toast } from '../app/toast.js';
import { createDocumentResources } from './documentImages.js';
import { prefersReducedMotion as systemPrefersReducedMotion } from './previewZoomController.js';
import { followLink, type WorkspaceLinkOptions, type WorkspaceLinkTarget } from './workspaceLinks.js';

export interface HtmlPreviewOptions {
    readonly fileName: string;
    // The document's workspace path; null for a file from outside the workspace.
    readonly documentPath: string | null;
    // The workspace folder style sheets, scripts and images are read from; null when no workspace is open.
    readonly root: FileSystemDirectoryHandle | null;
    // A style sheet or script open in a tab with unsaved edits is drawn from that tab's text,
    // by its workspace path.
    readonly unsavedText?: (path: string) => string | null;
    readonly onOpenLink: (target: WorkspaceLinkTarget) => void;
    // Ctrl+S in the page saves, as it does elsewhere in the studio, instead of opening the browser's Save as.
    readonly onSave?: () => void;
    readonly prefersReducedMotion?: () => boolean;
    // How long the preview waits after the last edit before drawing the page again.
    readonly delayMs?: number;
}

export interface HtmlPreviewHandle {
    // Holds the frame of the page shown, and the next page's frame beneath it while that one loads.
    readonly host: HTMLElement;
    // Draws the page again from new text, once the edits pause.
    update(text: string): void;
    // Scrolls smoothly to the element with this id or name.
    reveal(fragment: string): void;
    // Draws the page again when a style sheet, script or image it uses changed on disk.
    refresh(changedPaths: ReadonlyArray<string>): void;
    dispose(): void;
}

// One drawing of the page, in a sandbox page of its own.
interface PageFrame {
    readonly frame: HTMLIFrameElement;
    readonly html: string;
    // Whether the sandbox page has been sent the page.
    isSent: boolean;
    // Shows the page while its loading still goes on.
    showTimer: number | null;
    // Loads of the frame's window not yet answered by `ready` or `rendered`: one stays unanswered
    // when the frame has gone from its sandbox page to another address.
    unansweredLoads: number;
    // Draws the page again when a load stays unanswered.
    leaveTimer: number | null;
}

// The extension's sandbox page, beside the studio's own page; see `sandboxPage.ts`.
const SANDBOX_PAGE = 'sandbox.html';
// The manifest gives the sandbox page the same flags; the frame asks for them too.
// Without `allow-same-origin` the page has an origin of its own,
// so it can't reach the studio, its files or the extension.
// `allow-forms` lets a form's submit handlers run, while the sandbox's `form-action 'none'` keeps
// any submission from leaving.
const SANDBOX_FLAGS = 'allow-scripts allow-modals allow-forms';
// A sandbox page has an opaque origin, which messages give as `null`.
const SANDBOX_ORIGIN = 'null';
const UPDATE_DELAY_MS = 300;
// A new drawing shows once its page has loaded, or after this long,
// so a page whose loading never ends still shows.
const SHOW_DELAY_MS = 1500;
// How long a load of the frame may go unanswered before the frame counts as gone from its sandbox page.
const LEAVE_DELAY_MS = 1000;
const LEFT_MESSAGE = 'The page tried to go to another address, which the preview never follows, so it was drawn again.';
const COPIED_MESSAGE = 'Copied from the page.';
const JAVASCRIPT_ADDRESS = /^javascript:/i;
const CONTROL_CHARACTERS = /[\t\n\r]/g;

// Shows an HTML file as a page in the extension's sandbox page, with its scripts running, its styles kept apart
// from the studio's, and its style sheets, scripts and images read from the workspace.
// The sandbox page has an origin of its own and a content security policy that allows no network,
// so the page reaches neither the studio, the workspace, the extension nor the web.
// Each drawing gets a new sandbox page, loaded beneath the shown one and swapped in once it has loaded,
// so the page's scripts start afresh and the page doesn't flash while it is drawn again.
export function mountHtmlPreview(pane: HTMLElement, text: string, options: HtmlPreviewOptions): HtmlPreviewHandle {
    const host = h('div', { class: 'html-preview-host' });
    pane.append(host);

    const resources = options.root != null && options.documentPath != null
        ? createDocumentResources(options.root, { unsavedText: options.unsavedText })
        : null;
    const context: LocalImageContext = { documentPath: options.documentPath, resources };
    const prefersReducedMotion = options.prefersReducedMotion ?? systemPrefersReducedMotion;
    let current = text;
    let generation = 0;
    let timer: number | null = null;
    let shown: PageFrame | null = null;
    let next: PageFrame | null = null;
    let scroll: ScrollPosition = { left: 0, top: 0 };
    let pendingFragment: string | null = null;
    // A page that moves its frame to another address is drawn again once per drawing from new text,
    // so one that moves away as it loads can't draw itself over and over.
    let hasDrawnAgain = false;
    let isDisposed = false;

    const send = (page: PageFrame, message: StudioMessage): void => {
        page.frame.contentWindow?.postMessage(message, '*');
    };

    const sendPage = (page: PageFrame): void => {
        send(page, {
            channel: SANDBOX_CHANNEL,
            type: 'render',
            html: page.html,
            scroll,
            fragment: pendingFragment,
            isSmooth: !prefersReducedMotion(),
        });
        page.isSent = true;
        pendingFragment = null;
    };

    const sendReveal = (page: PageFrame, fragment: string): void => {
        send(page, { channel: SANDBOX_CHANNEL, type: 'reveal', fragment, isSmooth: !prefersReducedMotion() });
    };

    const answerCopy = (page: PageFrame, id: number, error: string | null): void => {
        send(page, { channel: SANDBOX_CHANNEL, type: 'copied', id, error });
    };

    // Writes what the page asked for through the studio's own clipboard, which the sandbox frame has no access to,
    // and tells the page how it went, so its promise resolves or rejects as the browser's would.
    const copyForPageAsync = async (page: PageFrame, id: number, content: PageClipboardContent): Promise<void> => {
        try {
            await copyTypesAsync(content);
        }
        catch (error) {
            toast(copyFailureMessage(error), 'fail');
            answerCopy(page, id, errorMessage(error));

            return;
        }

        toast(COPIED_MESSAGE, 'ok');
        answerCopy(page, id, null);
    };

    const show = (page: PageFrame): void => {
        if (page !== next) {
            return;
        }

        clearTimers(page);

        if (shown != null) {
            clearTimers(shown);
            shown.frame.remove();
        }

        page.frame.removeAttribute('inert');
        shown = page;
        next = null;
    };

    const stage = (html: string): void => {
        if (next != null) {
            clearTimers(next);
            next.frame.remove();
        }

        const frame = h('iframe', {
            class: 'html-preview-frame',
            attrs: { title: `Preview of ${options.fileName}`, sandbox: SANDBOX_FLAGS, src: SANDBOX_PAGE, inert: true },
        });
        const page: PageFrame = { frame, html, isSent: false, showTimer: null, unansweredLoads: 0, leaveTimer: null };
        frame.addEventListener('load', () => {
            page.unansweredLoads += 1;
            clearTimers(page, 'leave');
            page.leaveTimer = window.setTimeout(() => {
                page.leaveTimer = null;

                if (page.unansweredLoads > 0) {
                    drawAgain(page);
                }
            }, LEAVE_DELAY_MS);
        });
        next = page;
        host.prepend(frame);
    };

    // A page that moves its frame to another address leaves the sandbox page: the studio's `frame-src 'self'`
    // stops a move to the web, and the frame shows an error page instead, so the page comes back as written, once.
    const drawAgain = (page: PageFrame): void => {
        if (page !== shown || next != null || hasDrawnAgain) {
            return;
        }

        hasDrawnAgain = true;
        toast(LEFT_MESSAGE, 'info');
        stage(page.html);
    };

    const linkOptions: WorkspaceLinkOptions = {
        documentPath: options.documentPath,
        onOpen: options.onOpenLink,
        onFragment: (fragment) => {
            if (shown != null) {
                sendReveal(shown, fragment);
            }
        },
    };

    const handlers: Readonly<Record<SandboxMessage['type'], (page: PageFrame, message: SandboxMessage) => void>> = {
        // A new sandbox page asks for its page; so does the shown one after the page reloads itself.
        ready: (page) => {
            answerLoad(page);
            sendPage(page);

            if (page === next) {
                page.showTimer = window.setTimeout(() => show(page), SHOW_DELAY_MS);
            }
        },
        rendered: (page) => {
            answerLoad(page);
            show(page);
        },
        // Only a click or a key press in the page follows a link, never its scripts by themselves.
        link: (page, message) => {
            if (page === shown && message.type === 'link' && isUserActive() && !isJavascriptAddress(message.href)) {
                followLink(message.href, linkOptions);
            }
        },
        save: (page) => {
            if (page === shown) {
                options.onSave?.();
            }
        },
        // Only a click or a key press in the shown page copies, as only one follows a link;
        // the sandbox page says whether one was behind the copy, and the studio's window must have seen it too.
        copy: (page, message) => {
            if (message.type !== 'copy') {
                return;
            }

            if (page !== shown || !message.isActive || !isUserActive()) {
                answerCopy(page, message.id, PAGE_COPY_NEEDS_GESTURE);

                return;
            }

            void copyForPageAsync(page, message.id, message.content);
        },
        scroll: (page, message) => {
            if (page === shown && message.type === 'scroll') {
                scroll = { left: message.left, top: message.top };
            }
        },
    };

    const onMessage = (event: MessageEvent): void => {
        const page = [next, shown].find((candidate) => candidate != null && event.source === candidate.frame.contentWindow);
        const message = readSandboxMessage(event.data);

        if (page == null || event.origin !== SANDBOX_ORIGIN || message == null) {
            return;
        }

        handlers[message.type](page, message);
    };
    window.addEventListener('message', onMessage);

    const renderAsync = async (): Promise<void> => {
        generation += 1;
        const run = generation;
        const built = await buildHtmlPreviewAsync(current, context);

        if (run !== generation || isDisposed) {
            return;
        }

        hasDrawnAgain = false;
        stage(built.html);
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
        host,
        update: (nextText) => {
            if (nextText === current) {
                return;
            }

            current = nextText;
            schedule();
        },
        // The page that shows next takes the fragment, once it has been sent its page.
        reveal: (fragment) => {
            const page = next ?? shown;

            if (page?.isSent === true) {
                sendReveal(page, fragment);

                return;
            }

            pendingFragment = fragment;
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

            for (const page of [shown, next]) {
                if (page != null) {
                    clearTimers(page);
                }
            }

            window.removeEventListener('message', onMessage);
            resources?.dispose();
        },
    };
}

// An answer may come before the frame's load event reaches the studio, so the count can go below zero for a moment.
function answerLoad(page: PageFrame): void {
    page.unansweredLoads -= 1;
}

function clearTimers(page: PageFrame, only: 'show' | 'leave' | null = null): void {
    if (page.showTimer != null && only !== 'leave') {
        window.clearTimeout(page.showTimer);
        page.showTimer = null;
    }

    if (page.leaveTimer != null && only !== 'show') {
        window.clearTimeout(page.leaveTimer);
        page.leaveTimer = null;
    }
}

// A click or key press in the frame activates the studio's window too;
// without the API, as in tests, it counts as active.
function isUserActive(): boolean {
    return navigator.userActivation?.isActive ?? true;
}

// A `javascript:` address runs in the page, never in the studio.
function isJavascriptAddress(href: string): boolean {
    return JAVASCRIPT_ADDRESS.test(href.replace(CONTROL_CHARACTERS, '').trim());
}
