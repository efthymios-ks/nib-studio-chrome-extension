import { h } from '../app/dom.js';
import { shortcutLetter } from '../app/shortcutKey.js';

// The Find box of the Word and PDF previews: Find in document…, ↑ and ↓, and a count such as "2 of 5".
// Enter and Shift+Enter step, Escape empties the box, and Ctrl+F in the preview comes to it.

export type FindState = 'idle' | 'searching' | 'none' | 'found';

export interface FindSummary {
    readonly text: string;
    readonly state: FindState;
}

// "1,204 of 3,310", "No matches", or nothing while the box is empty.
export function matchSummary(query: string, count: number, index: number): FindSummary {
    if (query.trim() === '') {
        return { text: '', state: 'idle' };
    }

    if (count === 0) {
        return { text: 'No matches', state: 'none' };
    }

    return { text: `${(index + 1).toLocaleString('en-US')} of ${count.toLocaleString('en-US')}`, state: 'found' };
}

export interface FindBoxOptions {
    // The preview whose Ctrl+F goes to the box rather than to the browser's own find.
    readonly shortcutScope: HTMLElement;
    // Called as the query is typed, and with '' when Escape empties the box.
    readonly onQuery: (query: string) => void;
    readonly onStep: (direction: 1 | -1) => void;
}

export interface FindBox {
    readonly element: HTMLElement;
    getQuery(): string;
    // Puts a query in the box without searching, such as one remembered for the tab.
    setQuery(query: string): void;
    setEnabled(isEnabled: boolean): void;
    // Shows the count, and whether ↑ and ↓ have matches to step through.
    show(summary: FindSummary, canStep: boolean): void;
    destroy(): void;
}

export function createFindBox(options: FindBoxOptions): FindBox {
    let isEnabled = false;
    let canStep = false;
    const input = h('input', {
        class: 'document-find-input',
        dataset: { action: 'find' },
        attrs: {
            'type': 'search',
            'placeholder': 'Find in document…',
            'aria-label': 'Find in document',
            'spellcheck': 'false',
            'autocomplete': 'off',
            'disabled': true,
        },
    });
    const stepButton = (step: { action: string; text: string; label: string; shortcut: string }): HTMLButtonElement => h('button', {
        class: 'button preview-zoom-button',
        text: step.text,
        dataset: { action: step.action },
        attrs: { 'type': 'button', 'title': `${step.label} (${step.shortcut})`, 'aria-label': step.label, 'disabled': true },
    });
    const previousButton = stepButton({ action: 'find-previous', text: '↑', label: 'Previous match', shortcut: 'Shift+Enter' });
    const nextButton = stepButton({ action: 'find-next', text: '↓', label: 'Next match', shortcut: 'Enter' });
    const count = h('output', { class: 'document-find-count', aria: { live: 'polite' } });
    const element = h('div', {
        class: 'document-find',
        attrs: { role: 'search' },
        children: [input, previousButton, nextButton, count],
    });

    const showEnabled = (): void => {
        input.disabled = !isEnabled;
        previousButton.disabled = !isEnabled || !canStep;
        nextButton.disabled = !isEnabled || !canStep;
    };

    input.addEventListener('input', () => options.onQuery(input.value));
    input.addEventListener('keydown', (event) => {
        // Enter that ends an IME composition only commits the text.
        if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            options.onStep(event.shiftKey ? -1 : 1);
        }

        if (event.key === 'Escape' && input.value !== '') {
            event.preventDefault();
            input.value = '';
            options.onQuery('');
        }
    });
    previousButton.addEventListener('click', () => options.onStep(-1));
    nextButton.addEventListener('click', () => options.onStep(1));

    // While a message or a panel such as a password form shows, the box is off and hidden,
    // and the shortcut does nothing.
    const onShortcut = (event: KeyboardEvent): void => {
        const isFindShortcut = (event.ctrlKey || event.metaKey)
            && !event.altKey
            && shortcutLetter(event) === 'f';
        const isShown = !input.disabled && element.closest('[hidden]') == null;

        if (isFindShortcut && isShown) {
            event.preventDefault();
            input.focus();
            input.select();
        }
    };
    options.shortcutScope.addEventListener('keydown', onShortcut);

    return {
        element,
        getQuery: () => input.value,
        setQuery: (query) => {
            input.value = query;
        },
        setEnabled: (enabled) => {
            isEnabled = enabled;
            showEnabled();
        },
        show: (summary, stepping) => {
            canStep = stepping;
            count.textContent = summary.text;
            element.dataset['state'] = summary.state;
            showEnabled();
        },
        destroy: () => options.shortcutScope.removeEventListener('keydown', onShortcut),
    };
}
