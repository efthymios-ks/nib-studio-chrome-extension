// Below this width the Explorer leaves the grid and slides over the editor instead.
export const NARROW_LAYOUT_QUERY = '(max-width: 720px)';

export interface ExplorerDrawer {
    readonly open: () => void;
    readonly close: () => void;
    readonly toggle: () => void;
    readonly isOpen: () => boolean;
    readonly isNarrow: () => boolean;
    readonly dispose: () => void;
}

export interface ExplorerDrawerOptions {
    readonly sidebar: HTMLElement;
    readonly backdrop: HTMLElement;
    // The left-edge strip; a tap on it opens the drawer in the narrow layout only.
    readonly opener: HTMLElement;
    readonly media?: MediaQueryList | null;
}

function narrowLayoutQuery(): MediaQueryList | null {
    if (typeof window.matchMedia !== 'function') {
        return null;
    }

    return window.matchMedia(NARROW_LAYOUT_QUERY);
}

export function createExplorerDrawer(options: ExplorerDrawerOptions): ExplorerDrawer {
    const { sidebar, backdrop, opener } = options;
    const media = options.media === undefined ? narrowLayoutQuery() : options.media;

    const isOpen = (): boolean => document.body.dataset['explorerDrawer'] === 'open';

    const isNarrow = (): boolean => media?.matches === true;

    const open = (): void => {
        document.body.dataset['explorerDrawer'] = 'open';
        opener.setAttribute('aria-expanded', 'true');
        sidebar.querySelector<HTMLElement>('.tree')?.focus({ preventScroll: true });
    };

    const close = (): void => {
        if (!isOpen()) {
            return;
        }

        const focusWasInside = sidebar.contains(document.activeElement);
        delete document.body.dataset['explorerDrawer'];
        opener.setAttribute('aria-expanded', 'false');

        if (focusWasInside) {
            (document.activeElement as HTMLElement | null)?.blur();
        }
    };

    const toggle = (): void => {
        if (isOpen()) {
            close();
        }
        else {
            open();
        }
    };

    const onKeyDown = (event: KeyboardEvent): void => {
        // A dialog opened from the drawer handles its own Escape first.
        if (event.key !== 'Escape' || !isOpen() || document.querySelector('.modal-backdrop[data-open="true"]') != null) {
            return;
        }

        close();
    };

    const onOpenerClick = (): void => {
        if (isNarrow()) {
            toggle();
        }
    };

    const onMediaChange = (): void => {
        if (!isNarrow()) {
            close();
        }
    };

    opener.setAttribute('aria-controls', sidebar.id);
    opener.setAttribute('aria-expanded', 'false');
    opener.addEventListener('click', onOpenerClick);
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', onKeyDown);
    media?.addEventListener('change', onMediaChange);

    return {
        open,
        close,
        toggle,
        isOpen,
        isNarrow,
        dispose: () => {
            opener.removeEventListener('click', onOpenerClick);
            backdrop.removeEventListener('click', close);
            document.removeEventListener('keydown', onKeyDown);
            media?.removeEventListener('change', onMediaChange);
            delete document.body.dataset['explorerDrawer'];
        },
    };
}
