import { resolveWorkspaceReference } from '../../common/fs/workspaceReference.js';
import { LINK_SELECTOR } from '../../common/html/linkTitles.js';
import { toast } from '../app/toast.js';

export interface WorkspaceLinkTarget {
    // The path from the workspace folder, as written; the studio finds the file case-insensitively.
    readonly path: string;
    readonly fragment: string | null;
}

export type LinkAction =
    // A web, `mailto:` or `tel:` link opens in a new browser tab, so the studio's own tab stays.
    | { readonly kind: 'follow' }
    | { readonly kind: 'fragment'; readonly fragment: string }
    | { readonly kind: 'open'; readonly target: WorkspaceLinkTarget }
    | { readonly kind: 'refuse'; readonly message: string }
    // An empty address leads nowhere.
    | { readonly kind: 'ignore' };

export interface WorkspaceLinkOptions {
    // The document's workspace path; null for a file from outside the workspace.
    readonly documentPath: string | null;
    readonly onOpen: (target: WorkspaceLinkTarget) => void;
    // Takes web, `mailto:` and `tel:` links instead of a new browser tab.
    readonly onFollow?: (href: string) => void;
    // Takes in-page links instead of the browser.
    readonly onFragment?: (fragment: string) => void;
}

export const MIDDLE_BUTTON = 1;

// The link a click landed in, or null; a target in a frame's page is checked without `instanceof`.
export function closestLink(target: EventTarget | null): Element | null {
    const element = target as Element | null;

    return typeof element?.closest === 'function' ? element.closest(LINK_SELECTOR) : null;
}

// Opens a web, `mailto:` or `tel:` address in a new browser tab, which can't reach back to the studio.
// It runs in the studio's own window, so it works for a click in a sandboxed frame too.
export function openInNewTab(href: string): void {
    window.open(href, '_blank', 'noopener,noreferrer');
}

export function linkActionFor(href: string, documentPath: string | null): LinkAction {
    const resolved = resolveWorkspaceReference(href, documentPath ?? '');

    if (resolved.kind === 'empty') {
        return { kind: 'ignore' };
    }

    if (resolved.kind === 'fragment') {
        return { kind: 'fragment', fragment: resolved.fragment };
    }

    if (resolved.kind === 'web' || resolved.kind === 'inline') {
        return { kind: 'follow' };
    }

    const written = href.trim();

    if (documentPath == null) {
        return { kind: 'refuse', message: `${written} can't be opened from a file outside the workspace.` };
    }

    if (resolved.kind === 'outside') {
        return { kind: 'refuse', message: `${written} is outside the workspace.` };
    }

    return { kind: 'open', target: { path: resolved.path, fragment: resolved.fragment } };
}

// Handles a click on a link in a preview; a click elsewhere passes.
export function handleWorkspaceLinkClick(event: MouseEvent, options: WorkspaceLinkOptions): void {
    const link = closestLink(event.target);

    if (link == null) {
        return;
    }

    const action = linkActionFor(link.getAttribute('href') ?? '', options.documentPath);

    if (action.kind === 'follow') {
        event.preventDefault();
        (options.onFollow ?? openInNewTab)(link.getAttribute('href') ?? '');

        return;
    }

    if (action.kind === 'fragment') {
        if (options.onFragment != null) {
            event.preventDefault();
            options.onFragment(action.fragment);
        }

        return;
    }

    event.preventDefault();

    if (action.kind === 'refuse') {
        toast(action.message, 'warn');

        return;
    }

    if (action.kind === 'open') {
        options.onOpen(action.target);
    }
}

// Takes clicks on the links of a preview. A middle click on a workspace link opens it in the studio too,
// where the browser would open it as a page of the extension; one on a web link stays the browser's,
// which opens a new tab.
// Returns the function that lets go.
export function attachWorkspaceLinks(target: HTMLElement | Document, getOptions: () => WorkspaceLinkOptions): () => void {
    const onClick = (event: Event): void => handleWorkspaceLinkClick(event as MouseEvent, getOptions());
    const onAuxClick = (event: Event): void => {
        const pointer = event as MouseEvent;
        const link = closestLink(pointer.target);

        if (pointer.button !== MIDDLE_BUTTON || link == null) {
            return;
        }

        const options = getOptions();
        const kind = linkActionFor(link.getAttribute('href') ?? '', options.documentPath).kind;

        if (kind === 'open' || kind === 'refuse' || kind === 'ignore') {
            handleWorkspaceLinkClick(pointer, options);
        }
    };
    target.addEventListener('click', onClick);
    target.addEventListener('auxclick', onAuxClick);

    return () => {
        target.removeEventListener('click', onClick);
        target.removeEventListener('auxclick', onAuxClick);
    };
}
