import { basename } from '../../common/fs/fileEntry.js';
import { resolveFileType } from '../../common/fs/fileTypes.js';
import type { PersistedDiffTab } from '../../common/fs/workspaceConfig.js';
import { detectMode } from '../editor/editorHost.js';
import { diffSideDescription, diffSideName, type DiffSideName } from '../views/diffSideHeader.js';
import { createDiffViewState, swapSideMemory } from '../views/diffViewState.js';
import type { AppState, DiffKind, DiffSide, DiffTab } from './store.js';

let nextDiffTabNumber = 1;

// How a file of this name is compared: row diff for tables, a structural diff for JSON, YAML and XML,
// the rendered diff for Markdown and a line diff for everything else.
export function diffKindForPath(path: string): DiffKind {
    const type = resolveFileType(basename(path));

    if (type.id === 'csv' || type.id === 'excel') {
        return 'rows';
    }

    const mode = detectMode(basename(path));

    if (mode === 'json' || mode === 'yaml' || mode === 'xml' || mode === 'markdown') {
        return mode;
    }

    return 'text';
}

// The kind follows the first side that names a file; two text-only sides get a line diff.
function diffKindForSides(original: DiffSide | null, modified: DiffSide | null): DiffKind {
    const named = [original, modified].find((side) => side?.path != null && side.source !== 'clipboard' && side.source !== 'paste');

    return named?.path == null ? 'text' : diffKindForPath(named.path);
}

export function createDiffTab(original: DiffSide | null, modified: DiffSide | null, diffKind?: DiffKind): DiffTab {
    const id = `diff:${nextDiffTabNumber}`;
    nextDiffTabNumber += 1;

    return {
        id,
        kind: 'diff',
        diffKind: diffKind ?? diffKindForSides(original, modified),
        original,
        modified,
        state: createDiffViewState(),
    };
}

export const DIFF_KINDS: ReadonlyArray<DiffKind> = ['text', 'json', 'yaml', 'xml', 'markdown', 'rows'];

export const DIFF_KIND_LABELS: Readonly<Record<DiffKind, string>> = Object.freeze({
    text: 'Text',
    json: 'JSON',
    yaml: 'YAML',
    xml: 'XML',
    markdown: 'Markdown',
    rows: 'Table',
});

// Menu labels for choosing what a new compare holds; each starts with "Compare" so the menu says what it does.
export const DIFF_KIND_MENU_LABELS: Readonly<Record<DiffKind, string>> = Object.freeze({
    text: 'Compare text',
    json: 'Compare JSON',
    yaml: 'Compare YAML',
    xml: 'Compare XML',
    markdown: 'Compare Markdown',
    rows: 'Compare tables (CSV/TSV)',
});

// An empty compare of the chosen kind, numbered after the open compares of that kind.
export function createScratchDiffTab(tabs: ReadonlyArray<DiffTab>, diffKind: DiffKind): DiffTab {
    const taken = tabs
        .filter((tab) => tab.scratch != null && tab.diffKind === diffKind)
        .map((tab) => tab.scratch?.number ?? 0);
    const number = taken.length === 0 ? 1 : Math.max(...taken) + 1;

    return { ...createDiffTab(null, null, diffKind), scratch: { number } };
}

// The same tab compared as another kind.
export function setDiffTabKind(tab: DiffTab, diffKind: DiffKind): DiffTab {
    return tab.diffKind === diffKind ? tab : { ...tab, diffKind };
}

// Text pasted onto a side, stamped with the time it arrived.
export function pastedSide(text: string, options: { readonly time?: number; readonly edited?: boolean } = {}): DiffSide {
    return {
        label: options.edited === true ? 'Edited text' : 'Pasted text',
        source: 'paste',
        text,
        pastedAt: options.time ?? Date.now(),
        ...(options.edited === true ? { edited: true } : {}),
    };
}

// What makes two sides the same for de-duplication: the path of a file, or the text of clipboard and pasted sides.
function diffSideKey(side: DiffSide | null): string {
    if (side == null) {
        return 'empty';
    }

    if (side.source === 'file' || side.source === 'open-tab') {
        return `path:${side.path ?? side.label}`;
    }

    if (side.source === 'disk') {
        return `disk:${side.path ?? side.label}:${side.file?.lastModified ?? ''}:${side.text ?? ''}`;
    }

    return `${side.source}:${side.text ?? ''}`;
}

// An open diff tab that already compares this pair, in either order.
export function findDiffTab(
    tabs: ReadonlyArray<DiffTab>,
    original: DiffSide | null,
    modified: DiffSide | null,
): DiffTab | null {
    const wanted = [diffSideKey(original), diffSideKey(modified)].sort().join('\n');

    // New compares are edited in place, so a compare that happens to hold the same pair is not reused.
    return tabs.find((tab) => tab.scratch == null
        && [diffSideKey(tab.original), diffSideKey(tab.modified)].sort().join('\n') === wanted) ?? null;
}

export function diffTabTitle(tab: Pick<DiffTab, 'original' | 'modified'> & Partial<Pick<DiffTab, 'diffKind' | 'scratch'>>): string {
    if (tab.scratch != null && tab.diffKind != null) {
        const suffix = tab.scratch.number > 1 ? ` ${tab.scratch.number}` : '';

        return `${DIFF_KIND_LABELS[tab.diffKind]} compare${suffix}`;
    }

    return `${diffSideName(tab.original)} ↔ ${diffSideName(tab.modified)}`;
}

export function diffTabTooltip(tab: Pick<DiffTab, 'original' | 'modified'>): string {
    return `${diffSideDescription('original', tab.original)}\n${diffSideDescription('modified', tab.modified)}`;
}

// The same tab with its sides, labels and per-side memory swapped.
export function swapDiffTab(tab: DiffTab): DiffTab {
    swapSideMemory(tab.state);

    return { ...tab, original: tab.modified, modified: tab.original };
}

export function setDiffTabSide(tab: DiffTab, side: DiffSideName, value: DiffSide | null): DiffTab {
    return side === 'original' ? { ...tab, original: value } : { ...tab, modified: value };
}

export interface OpenDiffResult {
    readonly patch: Pick<AppState, 'diffTabs' | 'activePath'>;
    readonly tab: DiffTab;
    readonly existed: boolean;
}

// Opens a new diff tab for the pair, or focuses the one that already compares it. File tabs are left untouched.
export function openDiffTab(
    state: Pick<AppState, 'diffTabs'>,
    original: DiffSide | null,
    modified: DiffSide | null,
): OpenDiffResult {
    const existing = findDiffTab(state.diffTabs, original, modified);

    if (existing != null) {
        return { patch: { diffTabs: state.diffTabs, activePath: existing.id }, tab: existing, existed: true };
    }

    const tab = createDiffTab(original, modified);

    return { patch: { diffTabs: [...state.diffTabs, tab], activePath: tab.id }, tab, existed: false };
}

export function isWorkspaceFileSide(side: DiffSide | null): side is DiffSide & { path: string } {
    return side != null && side.path != null && (side.source === 'file' || side.source === 'open-tab');
}

// Diff tabs worth restoring: both sides are workspace files, which are read again on reopen.
// New compares and tabs with pasted or edited text last for the session only.
export function isPersistableDiffTab(tab: DiffTab): boolean {
    return tab.scratch == null && isWorkspaceFileSide(tab.original) && isWorkspaceFileSide(tab.modified);
}

export function persistableDiffTabs(state: Pick<AppState, 'diffTabs' | 'tabOrder'>): PersistedDiffTab[] {
    return state.diffTabs.flatMap((tab) => {
        if (!isPersistableDiffTab(tab) || !isWorkspaceFileSide(tab.original) || !isWorkspaceFileSide(tab.modified)) {
            return [];
        }

        return [{ original: tab.original.path, modified: tab.modified.path, position: Math.max(0, state.tabOrder.indexOf(tab.id)) }];
    });
}

export function workspaceFileSide(path: string, text: string, file: File | null): DiffSide {
    return { label: path, path, source: 'file', text, file };
}

// Points file sides at the new location of a moved or renamed entry.
export function remapDiffTab(tab: DiffTab, remap: (path: string) => string): DiffTab {
    const move = (side: DiffSide | null): DiffSide | null => {
        if (!isWorkspaceFileSide(side)) {
            return side;
        }

        const path = remap(side.path);

        return path === side.path ? side : { ...side, path, label: path };
    };
    const original = move(tab.original);
    const modified = move(tab.modified);

    return original === tab.original && modified === tab.modified ? tab : { ...tab, original, modified };
}
