import { h } from './dom.js';

export type ToastTone = 'info' | 'ok' | 'warn' | 'fail';

// What a toast says, and in which tone.
export interface ToastMessage {
    readonly message: string;
    readonly tone: ToastTone;
}

const DEFAULT_DURATION_MS = 3600;

let stackElement: HTMLElement | null = null;

export function toast(message: string, tone: ToastTone = 'info'): void {
    const stack = ensureStack();
    const node = h('div', {
        class: 'toast',
        dataset: { tone },
        text: message,
    });

    stack.append(node);

    setTimeout(() => {
        node.remove();
    }, DEFAULT_DURATION_MS);
}

function ensureStack(): HTMLElement {
    if (stackElement != null && stackElement.isConnected) {
        return stackElement;
    }

    stackElement = h('div', { class: 'toast-stack', aria: { live: 'polite' } });
    document.body.append(stackElement);

    return stackElement;
}
