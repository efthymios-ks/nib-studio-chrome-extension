import { LINK_SELECTOR } from '../common/html/linkTitles.js';
import {
    readStudioMessage,
    SANDBOX_CHANNEL,
    type SandboxMessage,
    type ScrollPosition,
} from '../common/html/sandboxMessages.js';
import { registerSaveShortcutGuard } from './app/saveShortcut.js';
import { guardPageWindow, type PageMarkup } from './sandboxGuard.js';
import { findTarget, scrollToTarget } from './views/fragmentScroll.js';

// The window a message goes to: the studio's, which is cross-origin from the sandbox page.
export interface MessageTarget {
    postMessage(message: unknown, targetOrigin: string): void;
}

export interface SandboxPageOptions {
    // The sandbox page's own window, which the HTML file's page replaces.
    readonly window: Window;
    // The studio's window: the only one a page is taken from, and the only one told about it.
    readonly studio: MessageTarget;
    readonly studioOrigin: string;
    // Writes the page over the sandbox page's document; `prepare` runs before the page's first script.
    readonly writePage?: (document: Document, html: string, prepare: () => void) => void;
}

interface PendingReveal {
    readonly fragment: string;
    readonly isSmooth: boolean;
}

const MIDDLE_BUTTON = 1;
const SCROLL_PAUSE_MS = 150;
// What a URL parser takes out of an address: tabs and newlines anywhere, and control characters or spaces
// at either end.
const CONTROL_CHARACTERS = /[\t\n\r]/g;
const EDGE_CONTROLS = /^[\u0000-\u0020]+|[\u0000-\u0020]+$/g;
const JAVASCRIPT_SCHEME = 'javascript:';
const PERCENT_ESCAPES = /(?:%[0-9a-f]{2})+/gi;

// Draws an HTML file's page inside the sandbox page, with its scripts, once the studio sends it.
// The page replaces this document but keeps its window, so the guard and the listeners here go on before
// its first script; see `sandboxGuard.ts` for what the guard keeps from it.
// Links leave through the studio, which opens them as a preview does;
// in-page and `javascript:` links stay the page's.
// A form's submission goes nowhere: its handlers run, and the page stays.
// Any other move of the frame to another address meets the studio's `frame-src 'self'`,
// so it never reaches the web.
export function startSandboxPage(options: SandboxPageOptions): void {
    const { window: page, studio, studioOrigin } = options;
    const toMarkup = guardPageWindow(page);
    const writePage = options.writePage ?? ((document, html, prepare) => writeDocument(document, toMarkup, html, prepare));
    let hasPage = false;
    let isLoaded = false;
    let scrollTimer: number | null = null;
    let scroll: ScrollPosition = { left: 0, top: 0 };
    let pendingReveal: PendingReveal | null = null;
    let removeSaveGuard: (() => void) | null = null;

    const post = (message: SandboxMessage): void => studio.postMessage(message, studioOrigin);

    const reveal = (target: PendingReveal): void => {
        const element = findTarget(page.document, target.fragment);

        if (element != null) {
            scrollToTarget(element, () => !target.isSmooth);
        }
    };

    const onLoad = (): void => {
        if (!hasPage) {
            post({ channel: SANDBOX_CHANNEL, type: 'ready' });

            return;
        }

        if (isLoaded) {
            return;
        }

        isLoaded = true;
        page.scrollTo(scroll.left, scroll.top);

        if (pendingReveal != null) {
            reveal(pendingReveal);
            pendingReveal = null;
        }

        post({ channel: SANDBOX_CHANNEL, type: 'rendered' });
    };

    const onClick = (event: MouseEvent): void => {
        const link = linkOf(event.target);

        if (event.defaultPrevented || link == null || isInPageLink(link)) {
            return;
        }

        event.preventDefault();
        const script = scriptOf(link);

        if (script == null) {
            post({ channel: SANDBOX_CHANNEL, type: 'link', href: link.getAttribute('href') ?? '' });

            return;
        }

        // Chrome runs no `javascript:` address in a frame like this one, so the page's window runs the script,
        // a moment later, as a browser runs one.
        page.setTimeout(() => runScript(page, script));
    };

    // A middle click on a link would open a new window, which the sandbox refuses with an error.
    const onAuxClick = (event: MouseEvent): void => {
        const link = linkOf(event.target);

        if (link == null) {
            return;
        }

        event.preventDefault();

        if (event.button === MIDDLE_BUTTON && !isPageOwnLink(link)) {
            post({ channel: SANDBOX_CHANNEL, type: 'link', href: link.getAttribute('href') ?? '' });
        }
    };

    // The studio keeps the scroll for the next drawing, so it hears of it once the scrolling pauses.
    const onScroll = (): void => {
        if (!isLoaded) {
            return;
        }

        if (scrollTimer != null) {
            page.clearTimeout(scrollTimer);
        }

        scrollTimer = page.setTimeout(() => {
            scrollTimer = null;
            post({ channel: SANDBOX_CHANNEL, type: 'scroll', left: page.scrollX, top: page.scrollY });
        }, SCROLL_PAUSE_MS);
    };

    // A file dropped on the page would replace it.
    const keepPage = (event: Event): void => event.preventDefault();

    // A submission would meet the sandbox's `form-action 'none'`, which leaves an error page in the frame,
    // so the page stays once its own handlers have run. A dialog's form still closes its dialog.
    const onSubmit = (event: SubmitEvent): void => {
        if (!isDialogSubmission(event)) {
            event.preventDefault();
        }
    };

    const onMessage = (event: MessageEvent): void => {
        if (event.source !== studio || event.origin !== studioOrigin) {
            return;
        }

        const message = readStudioMessage(event.data);

        if (message == null) {
            return;
        }

        if (message.type === 'reveal') {
            const target = { fragment: message.fragment, isSmooth: message.isSmooth };

            if (isLoaded) {
                reveal(target);
            }
            else {
                pendingReveal = target;
            }

            return;
        }

        // A sandbox page draws one page; the next one gets a sandbox page of its own.
        if (hasPage) {
            return;
        }

        hasPage = true;
        scroll = message.scroll;
        pendingReveal = message.fragment == null ? null : { fragment: message.fragment, isSmooth: message.isSmooth };
        writePage(page.document, message.html, listen);
    };

    // Writing the page takes every listener off the window and the document,
    // so they go on again before its scripts run.
    function listen(): void {
        page.addEventListener('message', onMessage);
        page.addEventListener('load', onLoad);
        page.addEventListener('click', onClick);
        page.addEventListener('auxclick', onAuxClick);
        page.addEventListener('submit', onSubmit);
        page.addEventListener('scroll', onScroll, { passive: true });
        page.addEventListener('dragover', keepPage);
        page.addEventListener('drop', keepPage);
        removeSaveGuard?.();
        removeSaveGuard = registerSaveShortcutGuard(page, () => post({ channel: SANDBOX_CHANNEL, type: 'save' }));
    }

    listen();

    if (page.document.readyState === 'complete') {
        onLoad();
    }
}

function writeDocument(document: Document, toMarkup: PageMarkup, html: string, prepare: () => void): void {
    document.open();
    prepare();
    // The markup may be a TrustedHTML object, which `write` takes as it takes text.
    Reflect.apply(document.write, document, [toMarkup(html)]);
    document.close();
}

// The link a click landed in, or null; a click on text lands in its element.
function linkOf(target: EventTarget | null): Element | null {
    const element = target as Element | null;

    return typeof element?.closest === 'function' ? element.closest(LINK_SELECTOR) : null;
}

// An in-page `#id` link moves within the page, and a `javascript:` link runs in it, as in a browser.
function isPageOwnLink(link: Element): boolean {
    return isInPageLink(link) || scriptOf(link) != null;
}

function isInPageLink(link: Element): boolean {
    return writtenAddress(link).startsWith('#');
}

// The script of a `javascript:` link, percent-decoded as a browser takes it from the address;
// null for any other link.
function scriptOf(link: Element): string | null {
    const address = writtenAddress(link);

    if (address.slice(0, JAVASCRIPT_SCHEME.length).toLowerCase() !== JAVASCRIPT_SCHEME) {
        return null;
    }

    // A run of escapes that isn't UTF-8 stays as written.
    return address.slice(JAVASCRIPT_SCHEME.length).replace(PERCENT_ESCAPES, (escapes) => {
        try {
            return decodeURIComponent(escapes);
        }
        catch {
            return escapes;
        }
    });
}

function writtenAddress(link: Element): string {
    return (link.getAttribute('href') ?? '').replace(CONTROL_CHARACTERS, '').replace(EDGE_CONTROLS, '');
}

// Runs a script at the top level of the page's window, as a `javascript:` address does.
// The value it ends with is dropped, where a browser would show a string as the page.
function runScript(page: Window, script: string): void {
    (page as unknown as { eval(source: string): unknown }).eval(script);
}

// A form of `method="dialog"`, or a button of `formmethod="dialog"`, closes its dialog as its submission.
function isDialogSubmission(event: SubmitEvent): boolean {
    const form = event.target as Element | null;
    const method = event.submitter?.getAttribute('formmethod') ?? form?.getAttribute('method') ?? '';

    return method.trim().toLowerCase() === 'dialog';
}
