import { countLabel } from '../../common/paths/valueFormat.js';
import { VENDOR_LICENSES } from '../vendorLicenses.js';
import { trapTabWithin } from './dialog.js';
import { focusedElement, h, returnFocus } from './dom.js';

// The title of the dialog and of the status bar button that opens it.
export const ABOUT_TITLE = 'About & third-party licences';

// Closes the open About dialog, if any.
let closeOpenDialog: (() => void) | null = null;

// "Nib Studio ships with the following 118 third-party packages."
export function aboutIntro(count: number): string {
    return `Nib Studio ships with the following ${countLabel(count, 'third-party package')}. Each one keeps its original licence.`;
}

// A read-only modal listing every third-party package the build ships, by name and version,
// with its licence and full text. It is built when the status bar asks for it,
// so it costs nothing at startup.
// Focus moves into it and stays there until it closes, then goes back where it was.
export function showAboutDialog(): void {
    closeOpenDialog?.();
    const focused = focusedElement();

    const list = h('ul', { class: 'about-license-list' });

    for (const entry of VENDOR_LICENSES) {
        list.append(h('li', {
            class: 'about-license-item',
            children: [
                h('details', {
                    children: [
                        h('summary', {
                            class: 'about-license-summary',
                            children: [
                                h('span', { class: 'about-license-name', text: entry.name }),
                                h('span', { class: 'about-license-version', text: entry.version }),
                                h('span', { class: 'about-license-badge', text: entry.license }),
                            ],
                        }),
                        h('pre', { class: 'about-license-text', text: entry.text }),
                    ],
                }),
            ],
        }));
    }

    const close = (): void => {
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        closeOpenDialog = null;
        returnFocus(focused);
    };

    const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();

            return;
        }

        if (event.key === 'Tab') {
            trapTabWithin(event, modal);
        }
    };

    const modal = h('div', {
        class: 'modal about-modal',
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'about-title' },
        children: [
            h('div', {
                class: 'modal-header',
                children: [
                    h('h2', { attrs: { id: 'about-title' }, text: ABOUT_TITLE }),
                    h('button', {
                        class: 'modal-close',
                        text: '×',
                        attrs: { type: 'button', 'aria-label': 'Close' },
                        on: { click: close },
                    }),
                ],
            }),
            h('div', {
                class: 'modal-body about-modal-body',
                children: [
                    h('p', {
                        class: 'about-intro',
                        text: aboutIntro(VENDOR_LICENSES.length),
                    }),
                    list,
                ],
            }),
            h('div', {
                class: 'modal-footer',
                children: [
                    h('button', {
                        class: 'button button-primary',
                        text: 'Close',
                        dataset: { role: 'primary' },
                        attrs: { type: 'button' },
                        on: { click: close },
                    }),
                ],
            }),
        ],
    });

    const backdrop = h('div', {
        class: 'modal-backdrop',
        dataset: { open: 'true', role: 'about' },
        on: {
            click: (event) => {
                if (event.target === backdrop) {
                    close();
                }
            },
        },
        children: [modal],
    });

    document.body.append(backdrop);
    document.addEventListener('keydown', onKey, true);
    closeOpenDialog = close;
    modal.querySelector<HTMLElement>('[data-role="primary"]')?.focus();
}
