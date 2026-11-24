import { basename } from '../../common/fs/fileEntry.js';
import { clear, focusedElement, h, returnFocus } from '../app/dom.js';
import { displayPath } from '../app/store.js';

export type CompareChoice =
    | { readonly source: 'open-tab'; readonly path: string }
    | { readonly source: 'file'; readonly path: string }
    | { readonly source: 'disk' }
    | { readonly source: 'clipboard' }
    | { readonly source: 'paste'; readonly text: string };

export interface CompareChooserOptions {
    readonly anchor: HTMLElement;
    readonly title?: string;
    // Paths of other open file tabs that compare with this file.
    readonly openTabs: ReadonlyArray<string>;
    // Workspace files of a comparable type.
    readonly listWorkspaceFilesAsync: () => Promise<ReadonlyArray<string>>;
    readonly clipboardAvailable: boolean;
}

const WORKSPACE_LIST_LIMIT = 200;

let closeOpenChooser: (() => void) | null = null;

// A popover under the anchor that asks where the other side comes from. Resolves null when dismissed.
export async function showCompareChooserAsync(options: CompareChooserOptions): Promise<CompareChoice | null> {
    closeOpenChooser?.();

    return await new Promise<CompareChoice | null>((resolve) => {
        // The focus goes back where it was before the chooser opened, such as an editor,
        // or else to the button that opened it.
        const focused = focusedElement();
        const popover = h('div', {
            class: 'compare-chooser',
            attrs: { role: 'dialog', 'aria-label': options.title ?? 'Compare with' },
        });
        let settled = false;

        const finish = (choice: CompareChoice | null): void => {
            if (settled) {
                return;
            }

            settled = true;
            closeOpenChooser = null;
            document.removeEventListener('pointerdown', onOutside, true);
            document.removeEventListener('keydown', onKey, true);
            dropSelectionWithin(popover);
            popover.remove();
            returnFocus(focused, options.anchor);
            resolve(choice);
        };
        const onOutside = (event: Event): void => {
            if (!popover.contains(event.target as Node | null) && event.target !== options.anchor) {
                finish(null);
            }
        };
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.preventDefault();
                finish(null);
            }
        };

        closeOpenChooser = () => finish(null);
        popover.append(...buildSections(options, finish));
        document.body.append(popover);
        place(popover, options.anchor);
        document.addEventListener('pointerdown', onOutside, true);
        document.addEventListener('keydown', onKey, true);
        popover.querySelector<HTMLInputElement>('.compare-chooser-search')?.focus();
    });
}

// A selection inside the popover would stay behind in the page as an invisible caret once it is gone,
// and Chrome aims Ctrl+V at the element after that caret.
function dropSelectionWithin(popover: HTMLElement): void {
    const selection = window.getSelection();

    if (selection != null && selection.rangeCount > 0 && popover.contains(selection.anchorNode)) {
        selection.removeAllRanges();
    }
}

function place(popover: HTMLElement, anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(420, window.innerWidth - margin * 2);
    popover.style.width = `${width}px`;
    popover.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))}px`;
    popover.style.top = `${rect.bottom + 4}px`;
}

function buildSections(options: CompareChooserOptions, finish: (choice: CompareChoice | null) => void): HTMLElement[] {
    const sections: HTMLElement[] = [
        h('div', { class: 'compare-chooser-title', text: options.title ?? 'Compare with…' }),
    ];

    if (options.openTabs.length > 0) {
        sections.push(h('section', {
            class: 'compare-chooser-section',
            dataset: { section: 'open-tabs' },
            children: [
                h('div', { class: 'compare-chooser-heading', text: 'Open tab' }),
                h('ul', {
                    class: 'compare-chooser-list',
                    children: options.openTabs.map((path) => choiceItem(path, () => finish({ source: 'open-tab', path }))),
                }),
            ],
        }));
    }

    sections.push(buildWorkspaceSection(options, finish));

    const pasteArea = h('textarea', {
        class: 'textarea textarea-mono compare-chooser-paste',
        attrs: { rows: '6', placeholder: 'Paste the text to compare with', 'aria-label': 'Text to compare with' },
    }) as HTMLTextAreaElement;
    const pasteConfirm = h('button', {
        class: 'button button-primary',
        dataset: { action: 'compare-pasted' },
        text: 'Compare',
        attrs: { type: 'button' },
        on: {
            click: () => {
                if (pasteArea.value !== '') {
                    finish({ source: 'paste', text: pasteArea.value });
                }
            },
        },
    });
    const pasteBox = h('div', { class: 'compare-chooser-paste-box', children: [pasteArea, pasteConfirm] });
    pasteBox.hidden = true;

    sections.push(h('section', {
        class: 'compare-chooser-section compare-chooser-actions',
        children: [
            h('button', {
                class: 'button',
                dataset: { action: 'disk' },
                text: 'File from disk…',
                attrs: { type: 'button' },
                on: { click: () => finish({ source: 'disk' }) },
            }),
            // Left out when the clipboard can't be read, as menus leave out what doesn't apply.
            options.clipboardAvailable
                ? h('button', {
                    class: 'button',
                    dataset: { action: 'clipboard' },
                    text: 'Clipboard',
                    attrs: { type: 'button' },
                    on: { click: () => finish({ source: 'clipboard' }) },
                })
                : null,
            h('button', {
                class: 'button',
                dataset: { action: 'paste' },
                text: 'Paste text…',
                attrs: { type: 'button' },
                on: {
                    click: () => {
                        pasteBox.hidden = false;
                        pasteArea.focus();
                    },
                },
            }),
        ],
    }), pasteBox);

    return sections;
}

function buildWorkspaceSection(options: CompareChooserOptions, finish: (choice: CompareChoice | null) => void): HTMLElement {
    const search = h('input', {
        class: 'input compare-chooser-search',
        attrs: { type: 'search', placeholder: 'Search workspace files', 'aria-label': 'Search workspace files', autocomplete: 'off' },
    }) as HTMLInputElement;
    const list = h('ul', { class: 'compare-chooser-list', dataset: { list: 'workspace' } });
    let files: ReadonlyArray<string> = [];

    const renderList = (): void => {
        clear(list);
        const query = search.value.trim().toLowerCase();
        const matches = filterWorkspaceFiles(files, query);

        if (matches.length === 0) {
            list.append(h('li', { class: 'compare-chooser-empty', text: files.length === 0 ? 'No comparable files.' : 'No match.' }));

            return;
        }

        for (const path of matches.slice(0, WORKSPACE_LIST_LIMIT)) {
            list.append(choiceItem(path, () => finish({ source: 'file', path })));
        }
    };

    list.append(h('li', { class: 'compare-chooser-empty', text: 'Loading…' }));
    search.addEventListener('input', renderList);
    search.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            list.querySelector<HTMLButtonElement>('button')?.click();
        }
    });
    const loadFilesAsync = async (): Promise<void> => {
        files = await options.listWorkspaceFilesAsync();
        renderList();
    };
    void loadFilesAsync();

    return h('section', {
        class: 'compare-chooser-section',
        dataset: { section: 'workspace' },
        children: [h('div', { class: 'compare-chooser-heading', text: 'Workspace file' }), search, list],
    });
}

// Workspace paths containing the query, sorted by path.
export function filterWorkspaceFiles(files: ReadonlyArray<string>, query: string): string[] {
    const needle = query.trim().toLowerCase();

    return files
        .filter((path) => needle === '' || path.toLowerCase().includes(needle))
        .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true }));
}

function choiceItem(path: string, onChoose: () => void): HTMLElement {
    return h('li', {
        children: [h('button', {
            class: 'compare-chooser-item',
            dataset: { path },
            attrs: { type: 'button', title: displayPath(path) },
            on: { click: onChoose },
            children: [
                h('span', { class: 'compare-chooser-name', text: basename(path) }),
                h('span', { class: 'compare-chooser-path', text: displayPath(path) }),
            ],
        })],
    });
}
