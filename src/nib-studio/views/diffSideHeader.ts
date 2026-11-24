import type { DiffDocumentSide, DiffSourceKind } from '../../common/diff/diffDocument.js';
import { basename } from '../../common/fs/fileEntry.js';
import { h } from '../app/dom.js';
import type { DiffSide } from '../app/store.js';

export type DiffSideName = 'original' | 'modified';

export const SIDE_BADGES: Readonly<Record<DiffSideName, string>> = Object.freeze({
    original: 'Original',
    modified: 'Modified',
});

// Short name of a side: the file name, or "Clipboard" / "Pasted text" for text that has no file.
export function diffSideName(side: DiffSide | null): string {
    if (side == null) {
        return 'Not chosen';
    }

    if (side.source === 'clipboard') {
        return 'Clipboard';
    }

    if (side.source === 'paste') {
        return side.edited === true ? 'Edited text' : 'Pasted text';
    }

    return side.path == null ? side.label : basename(side.path);
}

// Local time of day, such as 14:32.
export function formatPastedTime(time: number): string {
    const date = new Date(time);

    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// Muted second line under the name: where the side comes from.
export function diffSideDetail(side: DiffSide | null): string {
    if (side == null) {
        return 'Drop, paste or pick the other side';
    }

    if (side.source === 'clipboard') {
        return 'Text read from the clipboard';
    }

    if (side.source === 'paste') {
        if (side.pastedAt == null) {
            return 'Text pasted into Nib Studio';
        }

        return `${side.edited === true ? 'Edited' : 'Pasted'} at ${formatPastedTime(side.pastedAt)}`;
    }

    if (side.source === 'disk') {
        return `${side.path ?? side.label} (from disk)`;
    }

    if (side.source === 'open-tab') {
        return `${side.path ?? side.label} (open tab)`;
    }

    return side.path ?? side.label;
}

// One full description of a side, for tooltips.
export function diffSideDescription(which: DiffSideName, side: DiffSide | null): string {
    return `${SIDE_BADGES[which]}: ${diffSideDetail(side)}`;
}

// A side as a diff document names it: its short name, where it came from and its path; never when it was pasted.
export function diffDocumentSide(side: DiffSide | null): DiffDocumentSide {
    if (side == null) {
        return { name: diffSideName(side), source: 'none' };
    }

    const source: DiffSourceKind = side.source === 'paste' ? (side.edited === true ? 'edited' : 'pasted') : side.source;
    const hasFile = source === 'file' || source === 'open-tab' || source === 'disk';

    return hasFile ? { name: diffSideName(side), source, path: side.path ?? side.label } : { name: diffSideName(side), source };
}

// Both sides as one key, so a cached diff document is built again once a side is renamed or replaced.
export function diffDocumentSidesKey(original: DiffSide | null, modified: DiffSide | null): string {
    return JSON.stringify([diffDocumentSide(original), diffDocumentSide(modified)]);
}

export type DiffSideAction = 'paste' | 'edit' | 'choose' | 'clear';

const SIDE_ACTIONS: ReadonlyArray<{ readonly action: DiffSideAction; readonly label: string; readonly title: string }> = [
    { action: 'paste', label: 'Paste', title: 'Replace this side with the text on the clipboard' },
    { action: 'edit', label: 'Edit', title: 'Type or change the text of this side' },
    { action: 'choose', label: 'Choose file…', title: 'Replace this side with a workspace file, an open tab or a file from disk' },
    { action: 'clear', label: 'Clear', title: 'Empty this side' },
];

// Header over one side of a diff: the Original / Modified badge, the name, the side's actions and the muted source.
// The diff tab handles the actions' clicks, so views only lay the header out.
export function buildDiffSideHeader(which: DiffSideName, side: DiffSide | null): HTMLElement {
    const actions = SIDE_ACTIONS
        .filter((entry) => entry.action !== 'clear' || side != null)
        .map((entry) => h('button', {
            class: 'diff-side-action',
            text: entry.label,
            dataset: { sideAction: entry.action },
            attrs: { type: 'button', title: entry.title },
        }));

    return h('div', {
        class: 'diff-side-header',
        dataset: side == null ? { side: which, empty: 'true' } : { side: which },
        attrs: { title: diffSideDescription(which, side) },
        children: [
            h('span', { class: 'diff-side-badge', text: SIDE_BADGES[which] }),
            h('span', { class: 'diff-side-name', text: diffSideName(side) }),
            h('span', { class: 'diff-side-actions', children: actions }),
            h('span', { class: 'diff-side-path', text: diffSideDetail(side) }),
        ],
    });
}

// Both headers in a row, for views that do not split into two panes such as inline text and Markdown.
export function buildDiffSidesBar(original: DiffSide | null, modified: DiffSide | null): HTMLElement {
    return h('div', {
        class: 'diff-sides-bar',
        children: [
            buildDiffSideHeader('original', original),
            h('span', { class: 'diff-sides-arrow', attrs: { 'aria-hidden': 'true' }, text: '↔' }),
            buildDiffSideHeader('modified', modified),
        ],
    });
}
