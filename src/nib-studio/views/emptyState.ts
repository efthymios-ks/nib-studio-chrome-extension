import { h } from '../app/dom.js';

export interface EmptyStateOptions {
    readonly title: string;
    readonly message: string;
}

export function emptyState(options: EmptyStateOptions): HTMLElement {
    return h('div', {
        class: 'editor-placeholder',
        children: [
            h('h2', { text: options.title }),
            h('p', { text: options.message }),
        ],
    });
}
