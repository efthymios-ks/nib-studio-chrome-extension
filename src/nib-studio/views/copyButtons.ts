import { copyFailureMessage } from '../app/clipboard.js';
import { h } from '../app/dom.js';
import { toast, type ToastMessage } from '../app/toast.js';
import { showContextMenu } from '../explorer/contextMenu.js';

// Copy raw: the source text. Copy formatted: what the file renders as. Copy content: the text of a file that renders
// as nothing but itself.
export type CopyAction = 'raw' | 'formatted' | 'content';

export interface CopyButton {
    readonly action: CopyAction;
    // The tooltip, saying what this file's copy takes.
    readonly title: string;
    // Starts the clipboard write before its first wait, so it counts as part of the click that asked for it,
    // and says how the copy went, for its toast.
    readonly copyAsync: () => Promise<ToastMessage>;
}

const COPY_LABELS: Readonly<Record<CopyAction, string>> = Object.freeze({
    raw: 'Copy raw',
    formatted: 'Copy formatted',
    content: 'Copy content',
});

// The copy buttons of a toolbar: a button on its own, or two side by side as one group,
// which a narrow window folds into one Copy button with a menu of both. Null with no buttons.
export function buildCopyButtons(buttons: ReadonlyArray<CopyButton>): HTMLElement | null {
    const [first] = buttons;

    if (first == null) {
        return null;
    }

    if (buttons.length === 1) {
        return copyButtonElement(first);
    }

    const menuButton = h('button', {
        class: 'button copy-menu-button',
        dataset: { action: 'copy-menu' },
        attrs: {
            'type': 'button',
            'title': buttons.map((button) => COPY_LABELS[button.action]).join(' or '),
            'aria-haspopup': 'menu',
        },
        children: ['Copy', h('span', { class: 'copy-menu-chevron', text: '▾', attrs: { 'aria-hidden': 'true' } })],
        on: {
            mousedown: keepFocus,
            click: (event) => openCopyMenu(event as MouseEvent, buttons),
        },
    });

    return h('div', {
        class: 'copy-actions',
        attrs: { 'role': 'group', 'aria-label': 'Copy' },
        children: [h('span', { class: 'copy-buttons', children: buttons.map(copyButtonElement) }), menuButton],
    });
}

// Runs a copy and says how it went in a toast.
async function runCopyAsync(copyAsync: () => Promise<ToastMessage>): Promise<void> {
    try {
        const outcome = await copyAsync();
        toast(outcome.message, outcome.tone);
    }
    catch (error) {
        toast(copyFailureMessage(error), 'fail');
    }
}

function copyButtonElement(button: CopyButton): HTMLElement {
    return h('button', {
        class: 'button copy-action',
        text: COPY_LABELS[button.action],
        dataset: { action: `copy-${button.action}` },
        attrs: { type: 'button', title: button.title },
        on: {
            mousedown: keepFocus,
            click: () => {
                void runCopyAsync(button.copyAsync);
            },
        },
    });
}

// The menu opens under the button, wherever the click came from, the keyboard's included.
function openCopyMenu(event: MouseEvent, buttons: ReadonlyArray<CopyButton>): void {
    const anchor = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // The click would otherwise reach the page and close the menu it opened.
    event.stopPropagation();
    showContextMenu(new MouseEvent('click', { clientX: anchor.left, clientY: anchor.bottom + 4 }), [{
        items: buttons.map((button) => ({
            label: COPY_LABELS[button.action],
            onSelect: () => {
                void runCopyAsync(button.copyAsync);
            },
        })),
    }]);
}

// A pressed copy button doesn't take the focus, so the editor keeps it.
function keepFocus(event: Event): void {
    event.preventDefault();
}
