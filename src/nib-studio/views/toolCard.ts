import { describePosition, type CodecError } from '../../common/encoding/codecResult.js';
import { DIGEST_FORMATS, isDigestFormat, type DigestFormat } from '../../common/hash/digestFormat.js';
import { h } from '../app/dom.js';
import { shortcutLetter } from '../app/shortcutKey.js';
import type { HashSurfaceState, PaneMessage } from './hashSurfaceState.js';

// Building blocks the Hash & encode cards share: the card frame, Enter to run, Ctrl+C on a focused output,
// the output format picker and the list of digests.

export interface ToolCardContext {
    readonly state: HashSurfaceState;
    // Brings every card on screen up to date with the state; safe to call after an await.
    readonly refresh: () => void;
}

export interface ToolCard {
    readonly element: HTMLElement;
    // Redraws outputs and messages only, never what the user is typing.
    readonly update: () => void;
}

export interface ToolCardFrame {
    readonly id: string;
    readonly title: string;
    readonly tools?: ReadonlyArray<Node>;
    readonly children: ReadonlyArray<Node | null>;
}

export function toolId(card: string, part: string): string {
    return `hash-tool-${card}-${part}`;
}

export function buildToolCard(frame: ToolCardFrame): HTMLElement {
    const titleId = toolId(frame.id, 'title');

    return h('section', {
        class: 'tool-card',
        dataset: { card: frame.id },
        aria: { labelledby: titleId },
        children: [
            h('header', {
                class: 'tool-card-header',
                children: [
                    h('h2', { class: 'tool-card-title', text: frame.title, attrs: { id: titleId } }),
                    ...(frame.tools ?? []),
                ],
            }),
            ...frame.children,
        ],
    });
}

export function buildLabel(forId: string, text: string): HTMLLabelElement {
    return h('label', { class: 'tool-label', text, attrs: { for: forId } });
}

// The muted key hint, once per card; inputs point at it with aria-describedby.
export function buildHint(id: string, text: string): HTMLElement {
    return h('p', { class: 'tool-card-hint', text, attrs: { id } });
}

// A status line under an input; hidden while empty and announced when it changes.
export function buildMessage(): HTMLElement {
    return h('p', { class: 'tool-message', attrs: { 'role': 'status', 'aria-live': 'polite', 'hidden': true } });
}

export function showMessage(element: HTMLElement, message: PaneMessage | null): void {
    element.hidden = message == null;
    element.textContent = message?.text ?? '';

    if (message == null) {
        delete element.dataset['tone'];

        return;
    }

    element.dataset['tone'] = message.tone;
}

// "Invalid Base64 character '*' at position 5." from a codec error and the text it came from.
export function describeError(error: CodecError, text: string): string {
    if (error.position == null) {
        return `${error.message}.`;
    }

    return `${error.message} at ${describePosition(text, error.position)}.`;
}

// Selects the characters at fault so the place is visible as well as named.
export function selectError(field: HTMLInputElement | HTMLTextAreaElement, error: CodecError): void {
    if (error.position == null) {
        return;
    }

    field.setSelectionRange(error.position, error.position + Math.max(1, error.length));
}

// Enter runs the card, as does Ctrl+Enter; Shift+Enter keeps its new line in a text area.
export function runOnEnter(field: HTMLElement, run: () => void): void {
    field.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.isComposing) {
            return;
        }

        event.preventDefault();
        run();
    });
}

// Ctrl+C on a focused output with nothing selected in it selects all of its content first,
// so the browser copies the whole value, as if it had been selected by hand.
export function selectAllOnCopyKey(element: HTMLElement, content: HTMLElement = element): void {
    element.addEventListener('keydown', (event) => {
        const isCopyKey = (event.ctrlKey || event.metaKey) && shortcutLetter(event) === 'c';
        const selection = window.getSelection();

        if (!isCopyKey || selection == null) {
            return;
        }

        if (!selection.isCollapsed && content.contains(selection.anchorNode)) {
            return;
        }

        selection.selectAllChildren(content);
    });
}

export function buildFormatSelect(id: string, value: DigestFormat, onChange: (format: DigestFormat) => void): HTMLElement {
    const select = h('select', { class: 'input tool-select', attrs: { id } });

    for (const option of DIGEST_FORMATS) {
        select.append(h('option', { text: option.label, attrs: { value: option.id, selected: option.id === value } }));
    }

    select.value = value;
    select.addEventListener('change', () => {
        if (isDigestFormat(select.value)) {
            onChange(select.value);
        }
    });

    return h('span', {
        class: 'tool-inline',
        children: [h('label', { class: 'tool-label', text: 'Format', attrs: { for: id } }), select],
    });
}

export interface DigestListEntry {
    readonly key: string;
    readonly label: string;
}

export interface DigestListView {
    readonly element: HTMLElement;
    // Values by key, the keys that match the Verify card, and whether the values trail the input.
    readonly update: (values: ReadonlyMap<string, string> | null, matches: ReadonlySet<string>, isStale?: boolean) => void;
}

// One row per algorithm, its digest plain text to select; a row with a digest takes focus,
// and Ctrl+C there copies the whole digest.
export function buildDigestList(entries: ReadonlyArray<DigestListEntry>): DigestListView {
    const rows = entries.map((entry) => {
        const value = h('span', { class: 'digest-value' });
        const row = h('li', {
            class: 'digest-row',
            dataset: { key: entry.key },
            children: [h('span', { class: 'digest-name', text: entry.label }), value],
        });
        selectAllOnCopyKey(row, value);

        return { entry, row, value };
    });

    const list = h('ul', { class: 'digest-list', children: rows.map((row) => row.row) });

    return {
        element: list,
        update: (values, matches, isStale = false) => {
            list.dataset['stale'] = String(isStale);

            for (const row of rows) {
                const text = values?.get(row.entry.key) ?? '';
                row.value.textContent = text === '' ? '—' : text;
                row.row.dataset['empty'] = String(text === '');
                row.row.dataset['match'] = String(matches.has(row.entry.key));

                if (text === '') {
                    row.row.removeAttribute('tabindex');
                }
                else {
                    row.row.tabIndex = 0;
                }
            }
        },
    };
}
