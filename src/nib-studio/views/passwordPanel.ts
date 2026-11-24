import { h } from '../app/dom.js';

// Why the password is asked for: the first time, or again after a wrong one.
export type PasswordReason = 'needed' | 'incorrect';

export interface PasswordForm {
    readonly element: HTMLElement;
    focus(): void;
}

const REASON_TEXT: Readonly<Record<PasswordReason, string>> = Object.freeze({
    needed: 'Enter its password to open it.',
    incorrect: 'That password is incorrect. Try again.',
});

// The title both password views open with, such as "This PDF is protected with a password",
// and the file it is about.
function passwordHeading(title: string, fileName: string): HTMLElement[] {
    return [
        h('h2', { class: 'password-panel-title', text: title }),
        h('p', { class: 'password-panel-file', text: fileName }),
    ];
}

// Asks for a locked file's password inside its view. The password goes to the caller,
// and the box is emptied as soon as it is sent, so the panel keeps no copy.
export function createPasswordForm(options: {
    readonly title: string;
    readonly fileName: string;
    readonly reason: PasswordReason;
    readonly onSubmit: (password: string) => void;
    readonly onCancel: () => void;
}): PasswordForm {
    const input = h('input', {
        class: 'password-panel-input',
        attrs: {
            type: 'password',
            autocomplete: 'off',
            spellcheck: 'false',
            'aria-label': 'Password',
            required: true,
        },
    });
    const message = h('p', {
        class: 'password-panel-message',
        text: REASON_TEXT[options.reason],
        attrs: {
            'role': options.reason === 'incorrect' ? 'alert' : null,
            'data-tone': options.reason === 'incorrect' ? 'fail' : null,
        },
    });
    const form = h('form', {
        class: 'password-panel',
        dataset: { reason: options.reason },
        attrs: { 'aria-label': `Password for ${options.fileName}`, novalidate: true },
        children: [
            ...passwordHeading(options.title, options.fileName),
            message,
            input,
            h('div', {
                class: 'password-panel-actions',
                children: [
                    h('button', {
                        class: 'button button-primary',
                        text: 'Open',
                        dataset: { action: 'password-open' },
                        attrs: { type: 'submit' },
                    }),
                    h('button', {
                        class: 'button',
                        text: 'Cancel',
                        dataset: { action: 'password-cancel' },
                        attrs: { type: 'button' },
                        on: { click: () => options.onCancel() },
                    }),
                ],
            }),
        ],
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const password = input.value;

        if (password === '') {
            input.focus();

            return;
        }

        input.value = '';
        options.onSubmit(password);
    });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            options.onCancel();
        }
    });

    return { element: form, focus: () => input.focus({ preventScroll: true }) };
}

// What shows after Cancel: the file stays closed, with a way back to the password box.
export function createPasswordCancelled(options: {
    readonly title: string;
    readonly fileName: string;
    readonly onRetry: () => void;
}): HTMLElement {
    return h('div', {
        class: 'password-panel',
        dataset: { reason: 'cancelled' },
        children: [
            ...passwordHeading(options.title, options.fileName),
            h('p', { class: 'password-panel-message', text: 'It stays closed until its password is entered.' }),
            h('div', {
                class: 'password-panel-actions',
                children: [
                    h('button', {
                        class: 'button button-primary',
                        text: 'Enter password',
                        dataset: { action: 'password-retry' },
                        attrs: { type: 'button' },
                        on: { click: () => options.onRetry() },
                    }),
                ],
            }),
        ],
    });
}
