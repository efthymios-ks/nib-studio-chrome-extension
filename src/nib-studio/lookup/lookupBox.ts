import { resolveFileType } from '../../common/fs/fileTypes.js';
import type { LookupProgress } from '../../common/lookup/lookupIndex.js';
import type { TextRange } from '../../common/lookup/lookupMatcher.js';
import type { LookupResult, LookupResults } from '../../common/lookup/lookupResults.js';
import { countLabel } from '../../common/paths/valueFormat.js';
import { clear, h } from '../app/dom.js';
import { shortcutLetter } from '../app/shortcutKey.js';
import { NARROW_LAYOUT_QUERY } from '../app/explorerDrawer.js';
import type { LookupClient, LookupUpdate } from './lookupClient.js';

// Lookup's box at the top of the Explorer: typing in it looks up files by name and content, and the results show
// in a panel under it, the list with a preview beside it, reaching over the editor;
// in the narrow layout the panel takes the drawer's width, with the preview under the list.

export interface LookupBoxCallbacks {
    // The workspace's Lookup, started the first time the box takes focus; null while no workspace is open.
    readonly connect: () => LookupClient | null;
    readonly onOpen: (result: LookupResult, query: string) => void;
    readonly onReveal: (result: LookupResult) => void;
    // A second Escape leaves the box for the tree.
    readonly onLeave: () => void;
}

export interface LookupBox {
    readonly element: HTMLElement;
    // Shows the box while a workspace is open.
    setAvailable(isAvailable: boolean): void;
    // Empties the box for another workspace.
    reset(): void;
    dispose(): void;
}

const PANEL_GAP = 4;
const PANEL_MARGIN = 12;
const PANEL_MAX_WIDTH = 960;
const PANEL_MAX_HEIGHT = 560;
// While contents are read, the results are searched again at most this often.
const REFRESH_INTERVAL_MS = 250;
const FALLBACK_PAGE_ROWS = 10;
const LIST_ID = 'lookup-results';

// "3 matches", or "12 files" for the list of every file.
export function resultCountLabel(results: LookupResults): string {
    return results.query.trim() === '' ? countLabel(results.total, 'file') : countLabel(results.total, 'match', 'matches');
}

// "Reading contents… 120 of 480" while files wait to be read, and null once every file listed so far is,
// so listing the workspace again to look for changes shows nothing until a changed file waits.
export function progressLabel(progress: LookupProgress | null): string | null {
    if (progress == null || progress.isDone || progress.read >= progress.total) {
        return null;
    }

    return `Reading contents… ${progress.read.toLocaleString('en-US')} of ${progress.total.toLocaleString('en-US')}`;
}

// Text with its ranges as marks; ranges that overlap one marked before are cut to what is left of them.
function appendMarked(parent: HTMLElement, text: string, ranges: ReadonlyArray<TextRange>): void {
    let cursor = 0;

    for (const range of ranges) {
        const start = Math.max(range.start, cursor);
        const end = Math.min(range.end, text.length);

        if (end <= start) {
            continue;
        }

        if (start > cursor) {
            parent.append(text.slice(cursor, start));
        }

        parent.append(h('mark', { class: 'lookup-mark', text: text.slice(start, end) }));
        cursor = end;
    }

    if (cursor < text.length) {
        parent.append(text.slice(cursor));
    }
}

function fileIcon(name: string): HTMLElement {
    const type = resolveFileType(name);

    return h('span', {
        class: 'tree-icon lookup-icon',
        text: type.glyph,
        dataset: { type: type.id },
        attrs: { 'aria-hidden': 'true' },
    });
}

function isNarrowLayout(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia(NARROW_LAYOUT_QUERY).matches;
}

export function createLookupBox(callbacks: LookupBoxCallbacks): LookupBox {
    const input = h('input', {
        class: 'input lookup-input',
        attrs: {
            'type': 'text',
            'placeholder': 'Look up files…',
            'aria-label': 'Look up files by name or content',
            'role': 'combobox',
            'aria-autocomplete': 'list',
            'aria-expanded': 'false',
            'aria-controls': LIST_ID,
            'autocomplete': 'off',
            'spellcheck': 'false',
        },
    });
    // Hidden until a workspace is open.
    const element = h('div', { class: 'lookup-box', attrs: { role: 'search', hidden: true }, children: [input] });
    const list = h('ul', { class: 'lookup-list', attrs: { 'id': LIST_ID, 'role': 'listbox', 'aria-label': 'Files found' } });
    const preview = h('div', { class: 'lookup-preview' });
    const count = h('span', { class: 'lookup-count' });
    const progressLine = h('span', { class: 'lookup-progress' });
    const panel = h('div', {
        class: 'lookup-panel',
        children: [
            h('div', { class: 'lookup-results', children: [list, preview] }),
            h('div', {
                class: 'lookup-status',
                children: [
                    count,
                    progressLine,
                    h('span', { class: 'lookup-hint', text: 'Enter opens · Ctrl+E reveals · Esc clears' }),
                ],
            }),
        ],
    });
    let client: LookupClient | null = null;
    let unsubscribe: (() => void) | null = null;
    let results: LookupResults | null = null;
    let selected = 0;
    let isOpen = false;
    let searchFrame: number | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    // The read and total counts last searched again for, such as "120/480".
    let lastCounts = '';
    // A refresh as contents arrive keeps the selected file selected; a new query starts at the top.
    let keepsSelection = false;

    const query = (): string => input.value;

    const place = (): void => {
        const box = input.getBoundingClientRect();
        const sidebar = element.closest('.sidebar')?.getBoundingClientRect() ?? box;
        const isNarrow = isNarrowLayout();
        const top = box.bottom + PANEL_GAP;
        const left = isNarrow ? sidebar.left : box.left;
        const width = isNarrow ? sidebar.width : Math.min(PANEL_MAX_WIDTH, window.innerWidth - left - PANEL_MARGIN);
        panel.dataset['layout'] = isNarrow ? 'narrow' : 'wide';
        panel.style.top = `${top}px`;
        panel.style.left = `${left}px`;
        panel.style.width = `${Math.max(0, width)}px`;
        panel.style.maxHeight = `${Math.max(0, Math.min(PANEL_MAX_HEIGHT, window.innerHeight - top - PANEL_MARGIN))}px`;
    };

    const onOutside = (event: Event): void => {
        const target = event.target as Node | null;

        if (!panel.contains(target) && !element.contains(target)) {
            close();
        }
    };

    const open = (): void => {
        if (isOpen) {
            return;
        }

        isOpen = true;
        document.body.append(panel);
        place();
        input.setAttribute('aria-expanded', 'true');
        document.addEventListener('pointerdown', onOutside, true);
        window.addEventListener('resize', place);
    };

    const close = (): void => {
        if (!isOpen) {
            return;
        }

        isOpen = false;
        panel.remove();
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        document.removeEventListener('pointerdown', onOutside, true);
        window.removeEventListener('resize', place);
    };

    const search = (): void => {
        if (searchFrame != null) {
            return;
        }

        // Keys typed within one frame are searched together.
        searchFrame = requestAnimationFrame(() => {
            searchFrame = null;

            if (query().trim() !== '') {
                client?.search(query());
            }
        });
    };

    const selectedResult = (): LookupResult | null => results?.results[selected] ?? null;

    const renderPreview = (): void => {
        clear(preview);
        const result = selectedResult();
        preview.hidden = result == null;

        if (result == null) {
            return;
        }

        const name = h('span', { class: 'lookup-preview-name' });
        appendMarked(name, result.name, result.nameRanges);
        preview.append(h('div', { class: 'lookup-preview-title', children: [fileIcon(result.name), name] }));

        if (result.folder !== '') {
            preview.append(h('div', { class: 'lookup-preview-folder', text: result.folder }));
        }

        const snippet = result.preview;

        if (snippet == null) {
            return;
        }

        if (snippet.sheet != null) {
            preview.append(h('div', {
                class: 'lookup-preview-line',
                text: `${snippet.sheet.name} · row ${snippet.sheet.row.toLocaleString('en-US')}`,
            }));
        }
        else if (snippet.line != null) {
            preview.append(h('div', { class: 'lookup-preview-line', text: `Line ${snippet.line.toLocaleString('en-US')}` }));
        }

        const text = h('p', { class: 'lookup-preview-text' });

        if (snippet.hasLead) {
            text.append('…');
        }

        appendMarked(text, snippet.text, snippet.ranges);

        if (snippet.hasTail) {
            text.append('…');
        }

        preview.append(text);
    };

    // The keys scroll the selected row into view; a row picked by the pointer is already under it.
    const showSelection = (scroll = true): void => {
        for (const row of list.querySelectorAll<HTMLElement>('.lookup-row')) {
            const isSelected = Number(row.dataset['index']) === selected;
            row.setAttribute('aria-selected', String(isSelected));

            if (isSelected) {
                input.setAttribute('aria-activedescendant', row.id);

                if (scroll) {
                    row.scrollIntoView?.({ block: 'nearest' });
                }
            }
        }

        renderPreview();
    };

    const select = (index: number): void => {
        const total = results?.results.length ?? 0;

        if (total === 0) {
            return;
        }

        selected = Math.max(0, Math.min(total - 1, index));
        showSelection();
    };

    const pageRows = (): number => {
        const row = list.querySelector<HTMLElement>('.lookup-row');
        const height = row?.getBoundingClientRect().height ?? 0;

        return height > 0 ? Math.max(1, Math.floor(list.clientHeight / height)) : FALLBACK_PAGE_ROWS;
    };

    const renderList = (): void => {
        clear(list);
        input.removeAttribute('aria-activedescendant');

        if (results == null || results.results.length === 0) {
            list.append(h('li', { class: 'lookup-empty', text: results == null ? 'Looking up…' : 'No matches' }));
            count.textContent = '';
            renderPreview();

            return;
        }

        count.textContent = resultCountLabel(results);
        results.results.forEach((result, index) => {
            const name = h('span', { class: 'lookup-row-name' });
            appendMarked(name, result.name, result.nameRanges);
            list.append(h('li', {
                class: 'lookup-row',
                dataset: { index: String(index), path: result.path },
                attrs: { 'id': `lookup-row-${index}`, 'role': 'option', 'aria-selected': 'false', 'title': result.path },
                children: [
                    fileIcon(result.name),
                    name,
                    result.folder === '' ? null : h('span', { class: 'lookup-row-folder', text: result.folder }),
                ],
            }));
        });
        showSelection();
    };

    const showResults = (next: LookupResults): void => {
        if (next.query !== query() || query().trim() === '') {
            return;
        }

        const keptPath = keepsSelection ? selectedResult()?.path : null;
        keepsSelection = false;
        results = next;
        const kept = keptPath == null ? -1 : next.results.findIndex((result) => result.path === keptPath);
        selected = Math.max(0, kept);
        renderList();
    };

    const showProgress = (progress: LookupProgress | null): void => {
        const label = progressLabel(progress);
        progressLine.textContent = label ?? '';
        progressLine.hidden = label == null;
    };

    // More contents were read: the open results are searched again, at most every REFRESH_INTERVAL_MS.
    const refreshSoon = (progress: LookupProgress): void => {
        const counts = `${progress.read}/${progress.total}`;

        if (counts === lastCounts || refreshTimer != null) {
            return;
        }

        lastCounts = counts;
        refreshTimer = setTimeout(() => {
            refreshTimer = null;

            if (isOpen && query().trim() !== '') {
                keepsSelection = true;
                client?.search(query());
            }
        }, REFRESH_INTERVAL_MS);
    };

    const onUpdate = (update: LookupUpdate): void => {
        if (update.kind === 'results') {
            showResults(update.results);

            return;
        }

        showProgress(update.progress);
        refreshSoon(update.progress);
    };

    const connect = (): void => {
        const next = callbacks.connect();

        if (next === client) {
            return;
        }

        unsubscribe?.();
        client = next;
        unsubscribe = client?.subscribe(onUpdate) ?? null;
        showProgress(client?.progress() ?? null);
    };

    const openResult = (result: LookupResult | null): void => {
        if (result == null) {
            return;
        }

        close();
        callbacks.onOpen(result, query());
    };

    const showQuery = (): void => {
        if (query().trim() === '') {
            results = null;
            close();

            return;
        }

        if (!isOpen) {
            open();
            renderList();
        }

        search();
    };

    // Each key's action while the box has focus; the arrows move the selection, never the caret or the tree.
    const keyActions: ReadonlyArray<{ readonly matches: (event: KeyboardEvent) => boolean; readonly run: () => void }> = [
        { matches: (event) => event.key === 'ArrowDown', run: () => (isOpen ? select(selected + 1) : showQuery()) },
        { matches: (event) => event.key === 'ArrowUp', run: () => (isOpen ? select(selected - 1) : showQuery()) },
        { matches: (event) => event.key === 'PageDown', run: () => select(selected + pageRows()) },
        { matches: (event) => event.key === 'PageUp', run: () => select(selected - pageRows()) },
        {
            matches: (event) => event.key === 'Enter' && !event.isComposing,
            run: () => openResult(isOpen ? selectedResult() : null),
        },
        {
            matches: (event) => (event.ctrlKey || event.metaKey) && !event.altKey && shortcutLetter(event) === 'e',
            run: () => {
                const result = isOpen ? selectedResult() : null;

                if (result != null) {
                    close();
                    callbacks.onReveal(result);
                }
            },
        },
        {
            matches: (event) => event.key === 'Escape',
            run: () => {
                if (query() === '') {
                    close();
                    callbacks.onLeave();

                    return;
                }

                input.value = '';
                results = null;
                close();
            },
        },
    ];

    input.addEventListener('focus', () => {
        connect();

        if (query().trim() !== '') {
            showQuery();
        }
    });
    input.addEventListener('input', () => {
        keepsSelection = false;
        showQuery();
    });
    input.addEventListener('keydown', (event) => {
        const action = keyActions.find((candidate) => candidate.matches(event));

        if (action == null) {
            return;
        }

        event.preventDefault();

        // Escape belongs to the box, so it never also closes the Explorer drawer around it.
        if (event.key === 'Escape') {
            event.stopPropagation();
        }

        action.run();
    });
    input.addEventListener('blur', () => close());

    // A press in the panel leaves the keyboard in the box; a click on a row opens its file.
    panel.addEventListener('mousedown', (event) => event.preventDefault());
    list.addEventListener('click', (event) => {
        const row = (event.target as Element | null)?.closest<HTMLElement>('.lookup-row');

        if (row != null) {
            selected = Number(row.dataset['index']);
            openResult(selectedResult());
        }
    });

    // Moving the pointer over a row selects it, as the arrow keys do, so its preview shows.
    // Only a real move counts: rows redrawn under a still pointer, as results arrive, don't take the selection.
    let lastPointer = '';
    list.addEventListener('pointermove', (event) => {
        const position = `${event.clientX},${event.clientY}`;

        if (position === lastPointer) {
            return;
        }

        lastPointer = position;
        const row = (event.target as Element | null)?.closest<HTMLElement>('.lookup-row');
        const index = row == null ? Number.NaN : Number(row.dataset['index']);

        if (Number.isInteger(index) && index !== selected) {
            selected = index;
            showSelection(false);
        }
    });

    return {
        element,
        setAvailable: (isAvailable) => {
            element.hidden = !isAvailable;

            if (!isAvailable) {
                close();
            }
        },
        reset: () => {
            close();
            unsubscribe?.();
            unsubscribe = null;
            client = null;
            results = null;
            input.value = '';
            lastCounts = '';
            showProgress(null);
        },
        dispose: () => {
            close();
            unsubscribe?.();

            if (searchFrame != null) {
                cancelAnimationFrame(searchFrame);
            }

            if (refreshTimer != null) {
                clearTimeout(refreshTimer);
            }
        },
    };
}
