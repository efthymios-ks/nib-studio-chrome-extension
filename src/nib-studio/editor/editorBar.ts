import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { h } from '../app/dom.js';

export interface EditorBarButton {
    // Names the button in `data-command`.
    readonly id: string;
    readonly label: string;
    // Inline SVG markup drawn with currentColor.
    readonly glyph: string;
    // Shortcut as shown to the user, such as `Ctrl+B`.
    readonly shortcut?: string;
    readonly run?: (view: EditorView) => void;
    // When present, the button opens a dropdown of these choices instead of running `run`.
    readonly menu?: (state: EditorState) => ReadonlyArray<EditorBarChoice>;
    readonly isPressed?: (state: EditorState) => boolean;
    readonly isEnabled?: (state: EditorState) => boolean;
}

export interface EditorBarChoice {
    readonly id: string;
    readonly label: string;
    readonly isCurrent: boolean;
    readonly run: (view: EditorView) => void;
}

export interface EditorBarHandle {
    readonly element: HTMLElement;
    // Brings the pressed and disabled states in line with the editor.
    readonly refresh: (state: EditorState) => void;
    // Opens a button's dropdown under another element, such as a code block's language label.
    readonly openMenu: (id: string, anchor: HTMLElement) => void;
    readonly destroy: () => void;
}

interface MountedButton {
    readonly button: EditorBarButton;
    readonly element: HTMLButtonElement;
}

interface OpenMenu {
    readonly anchor: HTMLButtonElement;
    readonly close: () => void;
}

const UNDO_GLYPH = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3.5 6.5h7a3 3 0 0 1 0 6H7"/><path d="M6 4 3.5 6.5 6 9"/></svg>';
const REDO_GLYPH = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12.5 6.5h-7a3 3 0 0 0 0 6H9"/><path d="M10 4l2.5 2.5L10 9"/></svg>';

export const HISTORY_BUTTONS: ReadonlyArray<EditorBarButton> = [
    {
        id: 'undo',
        label: 'Undo',
        glyph: UNDO_GLYPH,
        shortcut: 'Ctrl+Z',
        run: (view) => {
            undo(view);
        },
        isEnabled: (state) => undoDepth(state) > 0,
    },
    {
        id: 'redo',
        label: 'Redo',
        glyph: REDO_GLYPH,
        shortcut: 'Ctrl+Y',
        run: (view) => {
            redo(view);
        },
        isEnabled: (state) => redoDepth(state) > 0,
    },
];

const ROVING_KEYS: Readonly<Record<string, (index: number, count: number) => number>> = Object.freeze({
    ArrowRight: (index: number, count: number) => (index + 1) % count,
    ArrowLeft: (index: number, count: number) => (index - 1 + count) % count,
    Home: () => 0,
    End: (_index: number, count: number) => count - 1,
});

const MENU_STEPS: Readonly<Record<string, number>> = Object.freeze({
    ArrowDown: 1,
    ArrowUp: -1,
});

// A slim bar docked above the editor; each group of buttons is set off from the next by a divider.
// Buttons act on the editor's selection and never take focus from it on a click.
export function mountEditorBar(
    slot: HTMLElement,
    view: EditorView,
    groups: ReadonlyArray<ReadonlyArray<EditorBarButton>>,
): EditorBarHandle {
    const mounted: MountedButton[] = [];
    const scroller = h('div', { class: 'editor-bar-buttons' });
    const menu = h('div', { class: 'editor-bar-menu', attrs: { role: 'menu', hidden: true } });
    const bar = h('div', {
        class: 'editor-bar',
        attrs: { role: 'toolbar', 'aria-label': 'Editor' },
        children: [scroller, menu],
    });
    let openMenu: OpenMenu | null = null;

    const closeMenu = (): void => {
        openMenu?.close();
    };

    const showMenu = (anchor: HTMLButtonElement, button: EditorBarButton, byKeyboard: boolean, placeUnder?: HTMLElement): void => {
        const choices = button.menu?.(view.state) ?? [];
        const items = choices.map((choice) => h('button', {
            class: 'editor-bar-menu-item',
            text: choice.label,
            dataset: { choice: choice.id },
            attrs: {
                type: 'button',
                tabindex: -1,
                role: 'menuitemradio',
                'aria-checked': String(choice.isCurrent),
            },
            on: {
                click: () => {
                    closeMenu();
                    runOnEditor(view, choice.run);
                },
            },
        }) as HTMLButtonElement);

        menu.replaceChildren(...items);
        menu.hidden = false;
        anchor.setAttribute('aria-expanded', 'true');
        menu.style.left = '0px';
        menu.style.top = '';

        if (placeUnder == null) {
            const left = anchor.offsetLeft - scroller.scrollLeft;
            menu.style.left = `${Math.max(0, Math.min(left, bar.clientWidth - menu.offsetWidth))}px`;
        }
        else {
            // Right-aligned under the element, in the bar's coordinates.
            const barRect = bar.getBoundingClientRect();
            const rect = placeUnder.getBoundingClientRect();
            const left = rect.right - barRect.left - menu.offsetWidth;
            menu.style.left = `${Math.max(0, Math.min(left, bar.clientWidth - menu.offsetWidth))}px`;
            menu.style.top = `${rect.bottom - barRect.top + 2}px`;
        }

        const current = items.find((item) => item.getAttribute('aria-checked') === 'true') ?? items[0];
        current?.scrollIntoView({ block: 'nearest' });

        if (byKeyboard) {
            current?.focus();
        }

        const onPointerDown = (event: MouseEvent): void => {
            const target = event.target as Node | null;

            if (target != null && (menu.contains(target) || anchor.contains(target))) {
                return;
            }

            closeMenu();
        };

        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                const hadFocus = menu.contains(document.activeElement);
                closeMenu();

                if (hadFocus) {
                    anchor.focus();
                }

                return;
            }

            if (!menu.contains(document.activeElement)) {
                return;
            }

            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            const step = MENU_STEPS[event.key];

            if (step != null && items.length > 0) {
                event.preventDefault();
                items[(index + step + items.length) % items.length]?.focus();
            }

            if (event.key === 'Tab') {
                closeMenu();
            }
        };

        document.addEventListener('mousedown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        scroller.addEventListener('scroll', closeMenu, { once: true });
        view.scrollDOM.addEventListener('scroll', closeMenu, { once: true });

        openMenu = {
            anchor,
            close: () => {
                document.removeEventListener('mousedown', onPointerDown, true);
                document.removeEventListener('keydown', onKeyDown, true);
                scroller.removeEventListener('scroll', closeMenu);
                view.scrollDOM.removeEventListener('scroll', closeMenu);
                anchor.setAttribute('aria-expanded', 'false');
                menu.hidden = true;
                menu.replaceChildren();
                openMenu = null;
            },
        };
    };

    groups.forEach((group, groupIndex) => {
        if (groupIndex > 0 && group.length > 0) {
            scroller.append(h('span', { class: 'editor-bar-separator', attrs: { 'aria-hidden': 'true' } }));
        }

        for (const button of group) {
            const element = createButton(button, (event) => {
                if (element.getAttribute('aria-disabled') === 'true') {
                    return;
                }

                if (button.menu == null) {
                    closeMenu();
                    runOnEditor(view, button.run);

                    return;
                }

                if (openMenu?.anchor === element) {
                    closeMenu();

                    return;
                }

                closeMenu();
                // A click from Enter or Space has no pointer position.
                showMenu(element, button, event.detail === 0);
            });
            mounted.push({ button, element });
            scroller.append(element);
        }
    });

    mounted[0]?.element.setAttribute('tabindex', '0');

    // Keeps focus and the selection in the editor while a button is pressed.
    bar.addEventListener('mousedown', (event) => {
        if ((event.target as Element | null)?.closest('button') != null) {
            event.preventDefault();
        }
    });

    scroller.addEventListener('keydown', (event) => {
        const elements = mounted.map((item) => item.element);
        const index = elements.indexOf(document.activeElement as HTMLButtonElement);
        const move = ROVING_KEYS[event.key];

        if (index < 0 || move == null) {
            return;
        }

        event.preventDefault();
        const next = elements[move(index, elements.length)];

        for (const element of elements) {
            element.setAttribute('tabindex', element === next ? '0' : '-1');
        }

        next?.focus();
    });

    const refresh = (state: EditorState): void => {
        for (const { button, element } of mounted) {
            const isEnabled = !state.readOnly && (button.isEnabled?.(state) ?? true);
            element.setAttribute('aria-disabled', String(!isEnabled));

            if (button.isPressed != null) {
                element.setAttribute('aria-pressed', String(button.isPressed(state)));
            }
        }
    };

    const openMenuUnder = (id: string, placeUnder: HTMLElement): void => {
        const found = mounted.find((item) => item.button.id === id && item.button.menu != null);

        if (found == null || view.state.readOnly) {
            return;
        }

        closeMenu();
        refresh(view.state);
        showMenu(found.element, found.button, false, placeUnder);
    };

    slot.replaceChildren(bar);
    refresh(view.state);

    return {
        element: bar,
        refresh,
        openMenu: openMenuUnder,
        destroy: () => {
            closeMenu();
            bar.remove();
        },
    };
}

function createButton(button: EditorBarButton, onClick: (event: MouseEvent) => void): HTMLButtonElement {
    const title = button.shortcut == null ? button.label : `${button.label} (${button.shortcut})`;

    return h('button', {
        class: 'editor-bar-button',
        html: button.glyph,
        dataset: { command: button.id },
        attrs: {
            type: 'button',
            tabindex: -1,
            title,
            'aria-label': button.label,
            'aria-keyshortcuts': button.shortcut ?? null,
            'aria-haspopup': button.menu == null ? null : 'menu',
            'aria-expanded': button.menu == null ? null : 'false',
        },
        on: { click: (event) => onClick(event as MouseEvent) },
    }) as HTMLButtonElement;
}

function runOnEditor(view: EditorView, run: ((view: EditorView) => void) | undefined): void {
    if (view.state.readOnly || run == null) {
        return;
    }

    run(view);
    view.focus();
}
