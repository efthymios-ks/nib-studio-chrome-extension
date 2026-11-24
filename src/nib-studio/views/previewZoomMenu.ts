import { clear, h } from '../app/dom.js';

// The zoom level as a button that opens a short menu of zooms, such as Fit page, Fit width and fixed steps.
// The menu closes on a choice, Escape, Tab, a click outside or a resize, and the arrow keys move through it.

export interface ZoomMenuItem {
    readonly label: string;
    // Names the item for tests and live checks, such as `zoom-fit-page`.
    readonly action: string;
    readonly isChecked: boolean;
    readonly onSelect: () => void;
}

// Null draws a line between two groups of items.
export type ZoomMenuEntry = ZoomMenuItem | null;

export interface ZoomMenu {
    readonly element: HTMLElement;
    // The button's text, such as "Fit page" or "125%", and its tooltip.
    setLabel(text: string, title: string): void;
    setEnabled(isEnabled: boolean): void;
    destroy(): void;
}

const MENU_GAP_PIXELS = 4;
const MENU_MARGIN_PIXELS = 8;

const STEP_KEYS: Readonly<Record<string, number>> = Object.freeze({
    ArrowDown: 1,
    ArrowUp: -1,
});

export function createZoomMenu(options: { readonly entries: () => ReadonlyArray<ZoomMenuEntry> }): ZoomMenu {
    const button = h('button', {
        class: 'button preview-zoom-level',
        text: '100%',
        dataset: { action: 'zoom-menu' },
        attrs: { 'type': 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'disabled': true },
    });
    const menu = h('div', {
        class: 'preview-zoom-menu',
        attrs: { 'role': 'menu', 'aria-label': 'Zoom', 'hidden': true },
    });
    const element = h('div', { class: 'preview-zoom-menu-anchor', children: [button, menu] });

    const items = (): HTMLButtonElement[] => [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];

    const focusItem = (index: number): void => {
        const all = items();
        all[(index + all.length) % all.length]?.focus();
    };

    const draw = (): void => {
        clear(menu);

        for (const entry of options.entries()) {
            if (entry == null) {
                menu.append(h('div', { class: 'preview-zoom-menu-separator', attrs: { role: 'separator' } }));

                continue;
            }

            menu.append(h('button', {
                class: 'preview-zoom-menu-item',
                text: entry.label,
                dataset: { action: entry.action },
                attrs: { 'type': 'button', 'role': 'menuitemradio', 'aria-checked': String(entry.isChecked), 'tabindex': '-1' },
                on: {
                    click: () => {
                        close(true);
                        entry.onSelect();
                    },
                },
            }));
        }
    };

    // Fixed under the button, so a toolbar that scrolls sideways on a narrow screen never clips it.
    const place = (): void => {
        const rect = button.getBoundingClientRect();
        const width = menu.offsetWidth;
        const left = Math.min(rect.left, window.innerWidth - width - MENU_MARGIN_PIXELS);
        menu.style.setProperty('--zoom-menu-left', `${Math.max(MENU_MARGIN_PIXELS, left)}px`);
        menu.style.setProperty('--zoom-menu-top', `${rect.bottom + MENU_GAP_PIXELS}px`);
    };

    const onOutside = (event: Event): void => {
        if (!element.contains(event.target as Node | null)) {
            close(false);
        }
    };

    // A resize, or a scroll of anything under it such as the narrow toolbar, would leave the menu behind.
    const onResize = (): void => close(false);

    // Escape closes the menu wherever the focus is, such as on the button after a click opened it,
    // and goes no further.
    const onEscape = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close(true);
        }
    };

    const open = (focusChecked: boolean): void => {
        draw();
        menu.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        place();
        document.addEventListener('pointerdown', onOutside, true);
        document.addEventListener('keydown', onEscape, true);
        document.addEventListener('scroll', onResize, true);
        window.addEventListener('resize', onResize);

        if (focusChecked) {
            const all = items();
            const checked = all.findIndex((item) => item.getAttribute('aria-checked') === 'true');
            focusItem(Math.max(0, checked));
        }
    };

    const close = (returnFocus: boolean): void => {
        if (menu.hidden) {
            return;
        }

        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', onOutside, true);
        document.removeEventListener('keydown', onEscape, true);
        document.removeEventListener('scroll', onResize, true);
        window.removeEventListener('resize', onResize);

        if (returnFocus) {
            button.focus();
        }
    };

    // A click from the keyboard, Enter or Space, takes focus into the menu;
    // a mouse click leaves it on the button.
    button.addEventListener('click', (event) => {
        if (menu.hidden) {
            open(event.detail === 0);

            return;
        }

        close(false);
    });
    button.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            open(true);
        }
    });
    menu.addEventListener('keydown', (event) => {
        const all = items();
        const index = all.indexOf(document.activeElement as HTMLButtonElement);
        const step = STEP_KEYS[event.key];

        if (step != null) {
            event.preventDefault();
            focusItem(index + step);

            return;
        }

        if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            focusItem(event.key === 'Home' ? 0 : -1);

            return;
        }

        if (event.key === 'Tab') {
            close(false);
        }
    });

    return {
        element,
        setLabel: (text, title) => {
            button.textContent = text;
            button.title = title;
        },
        setEnabled: (isEnabled) => {
            button.disabled = !isEnabled;

            if (!isEnabled) {
                close(false);
            }
        },
        destroy: () => close(false),
    };
}
