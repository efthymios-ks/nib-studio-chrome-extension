import { focusedElement, h, returnFocus } from './dom.js';

export type DialogKind =
    | { kind: 'yes-no' }
    | { kind: 'yes-no-cancel' }
    | { kind: 'two-button'; confirmLabel: string; cancelLabel: string; tone?: 'default' | 'danger' }
    | {
        kind: 'input';
        initialValue?: string;
        placeholder?: string;
        selectionRange?: 'all' | 'basename';
        validate?: (value: string) => string | null;
    }
    | {
        kind: 'input-ok';
        initialValue?: string;
        placeholder?: string;
        validate?: (value: string) => string | null;
    }
    | {
        kind: 'buttons';
        buttons: ReadonlyArray<DialogButton>;
    };

export interface DialogButton {
    readonly id: string;
    readonly label: string;
    readonly tone?: 'default' | 'primary' | 'danger';
    readonly primary?: boolean;
}

export interface DialogPath {
    readonly label: string;
    readonly path: string;
}

export interface DialogRequest {
    readonly title: string;
    readonly body?: string;
    readonly bodyNode?: HTMLElement;
    readonly kind: DialogKind;
    readonly tone?: 'default' | 'danger';
    readonly paths?: ReadonlyArray<DialogPath>;
}

export type DialogResult =
    | { outcome: 'yes' }
    | { outcome: 'no' }
    | { outcome: 'cancel' }
    | { outcome: 'input'; value: string }
    | { outcome: 'button'; id: string };

// Shared state machine for every dialog shape. The caller decides the shape
// via `kind`; everything else (focus trap, Esc, Enter, backdrop click,
// validation, paths block) is identical across callers.
export async function showDialogAsync(request: DialogRequest): Promise<DialogResult> {
    return await new Promise<DialogResult>((resolve) => {
        const context: DialogContext = {
            resolve,
            resolved: false,
            request,
        };

        render(context);
    });
}

interface DialogContext {
    readonly resolve: (result: DialogResult) => void;
    resolved: boolean;
    readonly request: DialogRequest;
    backdrop?: HTMLElement;
    errorLine?: HTMLElement;
    input?: HTMLInputElement;
    keyHandler?: (event: KeyboardEvent) => void;
    focusHandler?: (event: FocusEvent) => void;
    // Where the focus goes back when the dialog closes, such as a tree row, so its keys work at once;
    // a caller whose action moves the focus, such as opening a new file's editor, does so after that.
    returnFocus?: HTMLElement | null;
}

function render(context: DialogContext): void {
    const { request } = context;
    const titleId = `dialog-title-${Math.random().toString(36).slice(2, 10)}`;

    const bodyChildren: HTMLElement[] = [];

    if (request.body != null) {
        bodyChildren.push(h('p', { class: 'modal-hint', text: request.body }));
    }

    if (request.bodyNode != null) {
        bodyChildren.push(request.bodyNode);
    }

    if (request.paths != null && request.paths.length > 0) {
        bodyChildren.push(renderPathsBlock(request.paths));
    }

    const isInputKind = request.kind.kind === 'input' || request.kind.kind === 'input-ok';
    let inputElement: HTMLInputElement | null = null;
    const errorLine = h('p', { class: 'modal-error', attrs: { role: 'alert' } });
    errorLine.hidden = true;

    if (isInputKind) {
        const inputKind = request.kind as Extract<DialogKind, { kind: 'input' } | { kind: 'input-ok' }>;
        inputElement = h('input', {
            class: 'input',
            attrs: {
                type: 'text',
                autocomplete: 'off',
                spellcheck: 'false',
                placeholder: inputKind.placeholder ?? '',
            },
        });
        inputElement.value = inputKind.initialValue ?? '';
        bodyChildren.push(inputElement);
        bodyChildren.push(errorLine);
    }

    const footer = buildFooter(context, inputElement, errorLine);
    const closeButton = h('button', {
        class: 'modal-close',
        text: '×',
        attrs: { type: 'button', 'aria-label': 'Close' },
        on: { click: () => close(context, { outcome: 'cancel' }) },
    });
    const header = h('div', {
        class: 'modal-header',
        children: [
            h('h2', { attrs: { id: titleId }, text: request.title }),
            closeButton,
        ],
    });

    const modal = h('div', {
        class: 'modal',
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
        children: [
            header,
            h('div', { class: 'modal-body', children: bodyChildren }),
            footer,
        ],
    });

    const backdrop = h('div', {
        class: 'modal-backdrop',
        dataset: { open: 'true' },
        on: {
            click: (event) => {
                if (event.target === backdrop) {
                    close(context, { outcome: 'cancel' });
                }
            },
        },
        children: [modal],
    });

    context.backdrop = backdrop;
    context.errorLine = errorLine;
    context.input = inputElement ?? undefined;
    context.returnFocus = focusedElement();

    context.keyHandler = (event) => onKeyDown(event, context);
    document.addEventListener('keydown', context.keyHandler, true);

    // Focus trap: when focus escapes the backdrop pull it back.
    context.focusHandler = (event) => {
        if (context.backdrop == null) {
            return;
        }

        if (!context.backdrop.contains(event.target as Node | null)) {
            const focusable = focusableWithin(context.backdrop);
            focusable[0]?.focus();
        }
    };

    document.addEventListener('focusin', context.focusHandler, true);
    document.body.append(backdrop);

    requestAnimationFrame(() => {
        if (inputElement != null) {
            inputElement.focus();
            applyInitialSelection(inputElement, request.kind);
        }
        else {
            const primary = backdrop.querySelector<HTMLButtonElement>('[data-role="primary"]');
            primary?.focus();
        }
    });
}

function buildFooter(
    context: DialogContext,
    input: HTMLInputElement | null,
    errorLine: HTMLElement,
): HTMLElement {
    const { request } = context;
    const buttons: HTMLElement[] = [];
    const tone = request.tone ?? 'default';

    switch (request.kind.kind) {
        case 'yes-no': {
            buttons.push(makeButton('No', 'secondary', () => close(context, { outcome: 'no' })));
            buttons.push(makeButton('Yes', tone === 'danger' ? 'danger' : 'primary',
                () => close(context, { outcome: 'yes' }), true));
            break;
        }

        case 'yes-no-cancel': {
            buttons.push(makeButton('Cancel', 'secondary', () => close(context, { outcome: 'cancel' })));
            buttons.push(makeButton('No', 'secondary', () => close(context, { outcome: 'no' })));
            buttons.push(makeButton('Yes', tone === 'danger' ? 'danger' : 'primary',
                () => close(context, { outcome: 'yes' }), true));
            break;
        }

        case 'two-button': {
            const kind = request.kind;
            const buttonTone = kind.tone ?? tone;
            buttons.push(makeButton(kind.cancelLabel, 'secondary',
                () => close(context, { outcome: 'no' })));
            buttons.push(makeButton(kind.confirmLabel, buttonTone === 'danger' ? 'danger' : 'primary',
                () => close(context, { outcome: 'yes' }), true));
            break;
        }

        case 'input': {
            const kind = request.kind;
            buttons.push(makeButton('Cancel', 'secondary',
                () => close(context, { outcome: 'cancel' })));
            buttons.push(makeButton('OK', tone === 'danger' ? 'danger' : 'primary', () => {
                if (input == null) {
                    return;
                }

                submitInput(context, input, errorLine, kind.validate);
            }, true));
            break;
        }

        case 'input-ok': {
            const kind = request.kind;
            buttons.push(makeButton('OK', tone === 'danger' ? 'danger' : 'primary', () => {
                if (input == null) {
                    return;
                }

                submitInput(context, input, errorLine, kind.validate);
            }, true));
            break;
        }

        case 'buttons': {
            for (const button of request.kind.buttons) {
                const buttonTone = button.tone ?? 'default';
                const style = buttonTone === 'primary'
                    ? 'primary'
                    : buttonTone === 'danger'
                        ? 'danger'
                        : 'secondary';
                buttons.push(makeButton(button.label, style,
                    () => close(context, { outcome: 'button', id: button.id }), button.primary === true));
            }

            break;
        }
    }

    return h('div', { class: 'modal-footer', children: buttons });
}

function makeButton(
    label: string,
    tone: 'primary' | 'secondary' | 'danger',
    onClick: () => void,
    primary = false,
): HTMLElement {
    const className = tone === 'primary'
        ? 'button button-primary'
        : tone === 'danger'
            ? 'button button-danger'
            : 'button';
    const dataset: Record<string, string> = {};

    if (primary) {
        dataset['role'] = 'primary';
    }

    return h('button', {
        class: className,
        text: label,
        attrs: { type: 'button' },
        dataset,
        on: { click: onClick },
    });
}

function submitInput(
    context: DialogContext,
    input: HTMLInputElement,
    errorLine: HTMLElement,
    validate?: (value: string) => string | null,
): void {
    const value = input.value.trim();

    if (value === '') {
        showError(errorLine, input, 'Enter a value.');

        return;
    }

    const message = validate?.(value) ?? null;

    if (message != null) {
        showError(errorLine, input, message);

        return;
    }

    close(context, { outcome: 'input', value });
}

function showError(errorLine: HTMLElement, input: HTMLInputElement, message: string): void {
    errorLine.textContent = message;
    errorLine.hidden = false;
    input.focus();
    input.select();
}

function close(context: DialogContext, result: DialogResult): void {
    if (context.resolved) {
        return;
    }

    context.resolved = true;

    if (context.keyHandler != null) {
        document.removeEventListener('keydown', context.keyHandler, true);
    }

    if (context.focusHandler != null) {
        document.removeEventListener('focusin', context.focusHandler, true);
    }

    context.backdrop?.remove();
    returnFocus(context.returnFocus);
    context.resolve(result);
}

function onKeyDown(event: KeyboardEvent, context: DialogContext): void {
    if (event.key === 'Escape') {
        event.preventDefault();
        close(context, { outcome: 'cancel' });

        return;
    }

    if (event.key === 'Enter') {
        if (context.input != null && document.activeElement === context.input) {
            event.preventDefault();
            const kind = context.request.kind;

            if (kind.kind === 'input') {
                submitInput(context, context.input, context.errorLine!, kind.validate);
            }
            else if (kind.kind === 'input-ok') {
                submitInput(context, context.input, context.errorLine!, kind.validate);
            }

            return;
        }

        const active = document.activeElement;
        const tag = active?.tagName;

        if (tag === 'TEXTAREA' || tag === 'INPUT') {
            return;
        }

        // Buttons inside custom body content keep their own Enter behaviour.
        if (tag === 'BUTTON' && context.request.bodyNode?.contains(active ?? null) === true) {
            return;
        }

        event.preventDefault();
        const primary = context.backdrop?.querySelector<HTMLButtonElement>('[data-role="primary"]');
        primary?.click();
    }

    if (event.key === 'Tab') {
        trapTab(event, context);
    }
}

function trapTab(event: KeyboardEvent, context: DialogContext): void {
    if (context.backdrop != null) {
        trapTabWithin(event, context.backdrop);
    }
}

// Keeps Tab and Shift+Tab inside a modal: from its last focusable element to its first, and back.
export function trapTabWithin(event: KeyboardEvent, root: HTMLElement): void {
    const focusable = focusableWithin(root);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (first == null || last == null) {
        return;
    }

    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();

        return;
    }

    if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

// The elements Tab can reach, leaving out disabled ones and those inside a hidden part.
export function focusableWithin(root: HTMLElement): HTMLElement[] {
    const selector = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

    return Array.from(root.querySelectorAll<HTMLElement>(selector))
        .filter((element) => !element.hasAttribute('disabled') && element.closest('[hidden]') == null);
}

function applyInitialSelection(input: HTMLInputElement, kind: DialogKind): void {
    if (kind.kind !== 'input' && kind.kind !== 'input-ok') {
        return;
    }

    if (kind.kind === 'input' && kind.selectionRange === 'basename') {
        const value = input.value;
        const lastDot = value.lastIndexOf('.');

        if (lastDot <= 0) {
            input.select();

            return;
        }

        input.setSelectionRange(0, lastDot);

        return;
    }

    input.select();
}

function renderPathsBlock(paths: ReadonlyArray<DialogPath>): HTMLElement {
    const list = h('div', { class: 'dialog-paths' });

    for (const entry of paths) {
        list.append(h('div', {
            class: 'dialog-paths-row',
            children: [
                h('span', { class: 'dialog-paths-label', text: entry.label }),
                h('code', {
                    class: 'dialog-paths-path mono',
                    text: entry.path === '' ? '(workspace root)' : entry.path,
                }),
            ],
        }));
    }

    return list;
}

